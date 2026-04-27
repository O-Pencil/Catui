/**
 * [WHO]: Provides InsForgeEvalSink (PostgREST-backed adapter)
 * [FROM]: Depends on node:https, node:http, node:url; ./types.js for EvalSink/EvalEventEnvelope/CreateEvalSinkOptions
 * [TO]: Constructed by eval/index.ts factory when adapter resolves to "insforge"
 * [HERE]: extensions/defaults/sal/eval/insforge-sink.ts - InsForge-specific routing: run_start→eval_runs INSERT (merge-duplicates, includes pencil_version with legacy fallback), turn_anchor→eval_turns + eval_sal_anchors×2 with on_conflict-based upsert (suppresses benign 23505 retries) only after parent run confirmation, tool_trace→eval_tool_traces with legacy-schema fallback, memory_recalls→eval_memory_recalls, run_end→eval_runs PATCH
 *
 * Pluggable: nothing in this file may be imported from outside the eval/ directory.
 * To add a new backend, write a sibling file with the same EvalSink interface.
 */

import { request as httpRequest } from "node:http";
import { request } from "node:https";
import { URL } from "node:url";
import { isDevRuntime } from "../../../../utils/diagnostics.js";
import type { CreateEvalSinkOptions, EvalEventEnvelope, EvalSink } from "./types.js";

interface HttpJsonResult {
	ok: boolean;
	statusCode?: number;
	body?: string;
	errorCode?: string;
}

interface PostJsonOptions {
	prefer?: string;
	quietErrorCodes?: string[];
}

export class InsForgeEvalSink implements EvalSink {
	readonly enabled = true;

	private base: string;
	private headers: Record<string, string>;
	private allowSelfSigned: boolean;
	private batchIntervalMs: number;
	private onDiagnostic: CreateEvalSinkOptions["onDiagnostic"];
	private pending: EvalEventEnvelope[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private flushInFlight: Promise<void> | undefined;
	private closed = false;
	private confirmedRuns = new Set<string>();
	private failedRuns = new Set<string>();

	constructor(options: CreateEvalSinkOptions) {
		this.base = options.endpoint!.replace(/\/+$/, "");
		this.batchIntervalMs = options.batchIntervalMs ?? 2000;
		this.onDiagnostic = options.onDiagnostic;
		this.allowSelfSigned = options.allowSelfSigned ?? false;
		if (this.allowSelfSigned && isDevRuntime()) {
			console.warn("[sal][eval] TLS certificate verification disabled (allowSelfSigned=true)");
		}

		const h: Record<string, string> = {
			"Content-Type": "application/json",
			...(options.headers ?? {}),
		};
		if (options.anonKey) {
			h["apikey"] = options.anonKey;
			h["Authorization"] = `Bearer ${options.anonKey}`;
		}
		if (options.apiKey) {
			h[options.apiKeyHeader ?? "x-api-key"] = options.apiKey;
			if (!options.anonKey) {
				h["Authorization"] = `Bearer ${options.apiKey}`;
			}
		}
		this.headers = h;
	}

	async sendEvent(event: EvalEventEnvelope): Promise<void> {
		if (this.closed) return;
		this.pending.push(event);
		this.scheduleFlush();
	}

	async flush(): Promise<void> {
		if (this.flushInFlight) {
			await this.flushInFlight.catch(() => {});
			return;
		}

		this.flushInFlight = this.doFlush();
		try {
			await this.flushInFlight;
		} catch (err) {
			this.reportDiagnostic("persistence", "SAL eval flush failed.", err, "flush");
		} finally {
			this.flushInFlight = undefined;
		}
	}

	private async doFlush(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		while (true) {
			const toFlush = this.pending.splice(0);
			if (toFlush.length === 0) break;
			for (const event of toFlush) {
				await this.routeEvent(event);
			}
		}
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.flush().catch((err) => {
			this.reportDiagnostic("persistence", "SAL eval close flush failed.", err, "close-flush");
		});
	}

	private scheduleFlush(): void {
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			void this.flush().catch(() => {});
		}, this.batchIntervalMs);
	}

	// ------------------------------------------------------------------
	// Routing
	// ------------------------------------------------------------------

	private async routeEvent(event: EvalEventEnvelope): Promise<void> {
		try {
			switch (event.event_type) {
				case "run_start":
					await this.handleRunStart(event);
					break;
				case "turn_anchor":
					if (await this.ensureRunExists(event)) await this.handleTurnAnchor(event);
					break;
				case "memory_recalls":
					if (await this.ensureRunExists(event)) await this.handleMemoryRecalls(event);
					break;
				case "tool_trace":
					if (await this.ensureRunExists(event)) await this.handleToolTrace(event);
					break;
				case "run_end":
					if (await this.ensureRunExists(event)) await this.handleRunEnd(event);
					break;
			}
		} catch (err) {
			this.reportDiagnostic("persistence", `SAL eval route ${event.event_type} failed.`, err, `route-${event.event_type}`);
		}
	}

	// INSERT into eval_runs (merge-duplicates so a later run_start can update model)
	private async handleRunStart(ev: EvalEventEnvelope): Promise<void> {
		const p = ev.payload;
		const row = {
			run_id:        ev.run_id,
			variant:       ev.variant,
			status:        "running",
			task_description: strOrNull(p.task_description),
			task_file:     strOrNull(p.task_file),
			model:         strOrNull(p.model),
			thinking:      p.thinking === true,
			pencil_version: strOrNull(p.pencil_version),
			commit_hash:   strOrNull(p.commit, "unknown"),
			branch_name:   strOrNull(p.branch, "unknown"),
			workspace_root: strOrNull(p.workspace_root),
			started_at:    ev.ts,
		};
		const url = `${this.base}/api/database/records/eval_runs`;
		const result = await this.postJson(url, [row], {
			prefer: "resolution=merge-duplicates",
			quietErrorCodes: ["PGRST204"],
		});
		if (result.ok) {
			this.confirmedRuns.add(ev.run_id);
			this.failedRuns.delete(ev.run_id);
			return;
		}

		const fallback = await this.postJson(url, [toLegacyRunStartRow(row)], {
			prefer: "resolution=merge-duplicates",
		});
		if (fallback.ok) {
			this.confirmedRuns.add(ev.run_id);
			this.failedRuns.delete(ev.run_id);
			return;
		}

		this.failedRuns.add(ev.run_id);
	}

	private async ensureRunExists(ev: EvalEventEnvelope): Promise<boolean> {
		if (this.confirmedRuns.has(ev.run_id)) return true;
		if (!this.failedRuns.has(ev.run_id)) {
			await this.handleRunStart({
				...ev,
				event_type: "run_start",
				payload: {
					task_description: strOrNull(ev.payload.prompt_summary),
					model: strOrNull(ev.metadata?.model) ?? "unknown",
					thinking: false,
					commit: "unknown",
					branch: "unknown",
					workspace_root: strOrNull(ev.metadata?.workspace_root),
				},
			});
			if (this.confirmedRuns.has(ev.run_id)) return true;
		}
		this.reportDiagnostic(
			"persistence",
			`SAL eval skipped ${ev.event_type} because the eval run row is unavailable.`,
			{ run_id: ev.run_id, event_type: ev.event_type },
			"missing-run",
		);
		return false;
	}

	// INSERT into eval_turns + eval_sal_anchors (task + action)
	private async handleTurnAnchor(ev: EvalEventEnvelope): Promise<void> {
		const p = ev.payload;
		const turnId    = p.turn_id as number;
		const durationMs = p.duration_ms as number | undefined;
		const endedAt   = ev.ts;
		const startedAt = durationMs != null
			? new Date(new Date(ev.ts).getTime() - durationMs).toISOString()
			: ev.ts;

		// Use merge-duplicates + on_conflict so the DB resolves the
		// UNIQUE(run_id, turn_id) collision via ON CONFLICT DO UPDATE
		// instead of returning 409/23505. ignore-duplicates only checks the
		// primary key, which is auto-uuid here, so it never sees the conflict.
		await this.postJson(`${this.base}/api/database/records/eval_turns?on_conflict=run_id,turn_id`, [{
			run_id:                   ev.run_id,
			turn_id:                  turnId,
			event_id:                 ev.event_id,
			user_prompt:              strOrNull(p.prompt_summary),
			duration_ms:              durationMs ?? null,
			started_at:               startedAt,
			ended_at:                 endedAt,
		}], { prefer: "resolution=merge-duplicates" });

		const taskAnchor = p.task_anchor as Record<string, unknown> | null;
		if (taskAnchor) {
			await this.postJson(`${this.base}/api/database/records/eval_sal_anchors?on_conflict=run_id,turn_id,anchor_type`, [{
				run_id:             ev.run_id,
				turn_id:            turnId,
				event_id:           `${ev.event_id}-task`,
				anchor_type:        "task",
				module_path:        strOrNull(taskAnchor.modulePath),
				file_path:          strOrNull(taskAnchor.filePath),
				confidence:         numOrNull(taskAnchor.confidence),
				candidates:         p.task_candidates ?? null,
				recorded_at:        ev.ts,
			}], { prefer: "resolution=merge-duplicates" });
		}

		const actionAnchor = p.action_anchor as Record<string, unknown> | null;
		await this.postJson(`${this.base}/api/database/records/eval_sal_anchors?on_conflict=run_id,turn_id,anchor_type`, [{
			run_id:             ev.run_id,
			turn_id:            turnId,
			event_id:           `${ev.event_id}-action`,
			anchor_type:        "action",
			module_path:        strOrNull(actionAnchor?.modulePath),
			file_path:          strOrNull(actionAnchor?.filePath),
			confidence:         numOrNull(actionAnchor?.confidence),
			touched_files:      p.action_files ?? null,
			recorded_at:        ev.ts,
		}], { prefer: "resolution=merge-duplicates" });
	}

	// PATCH eval_runs — set status + final stats
	private async handleRunEnd(ev: EvalEventEnvelope): Promise<void> {
		const p = ev.payload;
		const rawStatus = strOrNull(p.status);
		const normalizedStatus =
			rawStatus === "success" ? "completed"
			: rawStatus === "error" ? "failed"
			: rawStatus ?? "completed";
		await this.patchJson(
			`${this.base}/api/database/records/eval_runs?run_id=eq.${ev.run_id}`,
			{
				status:           normalizedStatus,
				turn_count:       numOrNull(p.turn_count),
				total_duration_ms: numOrNull(p.total_duration_ms),
				ended_at:         ev.ts,
			},
		);
	}

	// INSERT into eval_memory_recalls — one row per scored memory in this turn
	private async handleMemoryRecalls(ev: EvalEventEnvelope): Promise<void> {
		const recalls = ev.payload.recalls as Array<Record<string, unknown>> | undefined;
		if (!recalls || recalls.length === 0) return;
		const rows = recalls.map((r, idx) => ({
			run_id:            ev.run_id,
			turn_id:           ev.payload.turn_id as number,
			event_id:          `${ev.event_id}-${idx}`,
			memory_id:         r.memoryId,
			memory_kind:       strOrNull(r.memoryKind),
			score_breakdown_status: strOrNull(r.scoreBreakdownStatus),
			anchor_module:     strOrNull(r.anchorModule),
			anchor_file:       strOrNull(r.anchorFile),
			score_recency:     numOrNull(r.scoreRecency),
			score_importance:  numOrNull(r.scoreImportance),
			score_relevance:   numOrNull(r.scoreRelevance),
			score_structural:  numOrNull(r.scoreStructural),
			score_final:       numOrNull(r.scoreFinal),
			was_injected:      r.wasInjected === true,
			inject_rank:       numOrNull(r.injectRank),
			recorded_at:       ev.ts,
		}));
		await this.postJson(
			`${this.base}/api/database/records/eval_memory_recalls`,
			rows,
			{ prefer: "resolution=ignore-duplicates" },
		);
	}

	// INSERT into eval_tool_traces — one row per turn with tool usage summary
	// InsForge columns are all TEXT; JSONB fields must be serialized to strings.
	private async handleToolTrace(ev: EvalEventEnvelope): Promise<void> {
		const p = ev.payload;
		const taskSignals = p.task_signals as Record<string, unknown> | undefined;
		const row = {
			run_id:             ev.run_id,
			turn_id:            String(p.turn_id ?? 0),
			event_id:           ev.event_id,
			tool_calls:         p.tool_calls ? JSON.stringify(p.tool_calls) : null,
			tool_sequence:      p.tool_sequence ? JSON.stringify(p.tool_sequence) : null,
			intent:             strOrNull(taskSignals?.intent),
			prompt_length:      String(taskSignals?.prompt_length ?? 0),
			has_error_trace:    String(taskSignals?.has_error_trace === true),
			has_file_reference: String(taskSignals?.has_file_reference === true),
			has_tool_usage:     String(p.has_tool_usage === true),
			total_tool_calls:   String(p.total_tool_calls ?? 0),
			total_errors:       String(p.total_errors ?? 0),
			completed_tool_calls: String(p.completed_tool_calls ?? 0),
			truncated_tool_calls: String(p.truncated_tool_calls ?? 0),
			truncated_tool_summary: String(p.truncated_tool_summary ?? 0),
			duration_ms:        String(p.duration_ms ?? 0),
			recorded_at:        ev.ts,
		};
		const url = `${this.base}/api/database/records/eval_tool_traces`;
		const result = await this.postJson(url, [row], {
			prefer: "resolution=ignore-duplicates",
			quietErrorCodes: ["PGRST204"],
		});
		if (!result.ok && result.errorCode === "PGRST204") {
			await this.postJson(url, [toLegacyToolTraceRow(row)], { prefer: "resolution=ignore-duplicates" });
		}
	}

	// ------------------------------------------------------------------
	// HTTP helpers
	// ------------------------------------------------------------------

	private postJson(url: string, body: unknown, extra?: PostJsonOptions): Promise<HttpJsonResult> {
		const extraHeaders: Record<string, string> = {};
		if (extra?.prefer) extraHeaders["Prefer"] = extra.prefer;
		return this.httpJson("POST", url, body, extraHeaders, extra?.quietErrorCodes);
	}

	private patchJson(url: string, body: unknown): Promise<HttpJsonResult> {
		return this.httpJson("PATCH", url, body, {});
	}

	private httpJson(
		method: string,
		url: string,
		body: unknown,
		extraHeaders: Record<string, string>,
		quietErrorCodes: string[] = [],
	): Promise<HttpJsonResult> {
		return new Promise((resolve) => {
			const payload = JSON.stringify(body);
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				this.reportDiagnostic("config", "SAL eval endpoint URL is invalid.", { url }, "invalid-url");
				resolve({ ok: false });
				return;
			}
			const isHttps = parsed.protocol === "https:";
			const requestFn = isHttps ? request : httpRequest;
			const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);
			const req = requestFn(
				{
					hostname: parsed.hostname,
					port,
					path: parsed.pathname + parsed.search,
					method,
					headers: {
						...this.headers,
						...extraHeaders,
						"Content-Length": Buffer.byteLength(payload),
					},
					timeout: 5000,
					...(isHttps && this.allowSelfSigned ? { rejectUnauthorized: false } : {}),
				},
				(res) => {
					let rawBody = "";
					res.setEncoding("utf-8");
					res.on("data", (chunk) => { rawBody += chunk; });
					res.on("end", () => {
						const ok = res.statusCode !== undefined && res.statusCode < 300;
						const errorCode = parsePostgrestErrorCode(rawBody);
						if (!ok && !quietErrorCodes.includes(errorCode ?? "")) {
							this.reportDiagnostic(
								errorCode === "PGRST204" ? "schema" : "network",
								`SAL eval upload failed with HTTP ${res.statusCode}.`,
								{ method, path: parsed.pathname, statusCode: res.statusCode, body: rawBody.slice(0, 300), errorCode },
								`http-${res.statusCode ?? "unknown"}-${errorCode ?? "none"}`,
							);
						}
						resolve({ ok, statusCode: res.statusCode, body: rawBody, errorCode });
					});
				},
			);
			req.on("error", (err) => {
				this.reportDiagnostic(
					"network",
					"SAL eval upload is failing due to a network connection error.",
					{ host: parsed.hostname, error: err.message },
					"network-error",
				);
				if (isDevRuntime()) {
					console.error(`[sal][eval] network error → ${parsed.hostname}: ${err.message}`);
				}
				resolve({ ok: false });
			});
			req.on("timeout", () => {
				this.reportDiagnostic(
					"network",
					"SAL eval upload timed out.",
					{ method, path: parsed.pathname, host: parsed.hostname },
					"timeout",
				);
				if (isDevRuntime()) {
					console.error(`[sal][eval] timeout ${method} ${parsed.pathname}`);
				}
				req.destroy();
				resolve({ ok: false });
			});
			req.write(payload);
			req.end();
		});
	}

	private reportDiagnostic(
		category: "network" | "fallback" | "persistence" | "config" | "extension_timeout" | "schema" | "unknown",
		message: string,
		detail: unknown,
		fingerprintSuffix: string,
	): void {
		this.onDiagnostic?.({
			source: "sal.eval",
			severity: category === "config" ? "warning" : "error",
			category,
			message,
			detail,
			fingerprint: `sal.eval:${category}:${fingerprintSuffix}`,
			context: {
				adapter: "insforge",
				endpoint_host: safeHost(this.base),
			},
		});
	}
}

// ----------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------

function strOrNull(v: unknown, skipValue?: string): string | null {
	if (v == null || v === "" || v === skipValue) return null;
	return String(v);
}

function numOrNull(v: unknown): number | null {
	if (v == null) return null;
	const n = Number(v);
	return isNaN(n) ? null : n;
}

function parsePostgrestErrorCode(rawBody: string): string | undefined {
	try {
		const parsed = JSON.parse(rawBody);
		return typeof parsed?.code === "string" ? parsed.code : undefined;
	} catch {
		return undefined;
	}
}

function safeHost(value: string): string | undefined {
	try {
		return new URL(value).hostname;
	} catch {
		return undefined;
	}
}

function toLegacyRunStartRow(row: Record<string, unknown>): Record<string, unknown> {
	const {
		pencil_version: _pencilVersion,
		commit_hash: _commitHash,
		branch_name: _branchName,
		workspace_root: _workspaceRoot,
		...legacyRow
	} = row;
	return legacyRow;
}

function toLegacyToolTraceRow(row: Record<string, unknown>): Record<string, unknown> {
	const {
		has_tool_usage: _hasToolUsage,
		completed_tool_calls: _completedToolCalls,
		truncated_tool_calls: _truncatedToolCalls,
		truncated_tool_summary: _truncatedToolSummary,
		...legacyRow
	} = row;
	return legacyRow;
}
