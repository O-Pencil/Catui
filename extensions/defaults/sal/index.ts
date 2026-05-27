/**
 * [WHO]: SAL extension entry - enabled by default, registers --nosal/--sal-ab/--sal-rebuild-terrain flags, /sal:coverage /sal:status /sal:setup commands, before_agent_start/tool_execution_start/tool_execution_end/agent_end hooks; runtime no-op when --nosal is set
 * [FROM]: Depends on core/extensions/types.ts (ToolExecutionStartEvent, ToolExecutionEndEvent), core/runtime/turn-context.ts (publishes structuralAnchor), extensions/defaults/sal/terrain.ts, anchors.ts, weights.ts, eval/index.ts (pluggable adapters)
 * [TO]: Loaded by builtin-extensions.ts as a default extension entry point
 * [HERE]: extensions/defaults/sal/index.ts - pluggable Structural Anchor Localization (SAL) extension; emits run_start/turn_anchor/tool_trace/run_end eval events with best-effort flush/close isolation; tool_trace captures per-turn tool usage profile (call counts, sequences, intent, errors) for self-awareness analytics
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createEvalEvent,
	createEvalSink,
	type EvalAdapterId,
	type EvalVariant,
} from "./eval/index.js";
import type {
	AgentEndEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ToolExecutionStartEvent,
	ToolExecutionEndEvent,
} from "../../../core/extensions/types.js";
import { getTurnContext, resetTurnContext, setTurnContext } from "../../../core/runtime/turn-context.js";
import { locateAction, locateTask, type AnchorResolution } from "./anchors.js";
import {
	buildTerrainIndex,
	checkDipCoverage,
	isSnapshotStale,
	type TerrainSnapshot,
} from "./terrain.js";
import { loadSalWeights, SAL_DEFAULT_WEIGHTS } from "./weights.js";
import {
	BUILD_META,
	EVAL_API_KEY_ENV,
	EVAL_API_KEY_HEADER_ENV,
	EVAL_ENDPOINT_ENV,
	EVAL_ENABLED_ENV,
	EVAL_HEADERS_JSON_ENV,
	EVAL_LEGACY_FILE_ENV,
	EVAL_RUN_ID_ENV,
	EVAL_STALE_CLEANUP_ENV,
	EVAL_VARIANT_ENV,
	isTruthy,
	normalizeExperimentId,
	parseHeadersJson,
	resolveEvalCredentials,
	resolveSalAbEnabled,
	resolveSalSidecarDir,
	resolveStaleCleanupEnabled,
} from "./sal-config.js";
import { buildContextInjection, persistTurnRecord } from "./sal-context.js";
import type { SalRuntime } from "./sal-runtime.js";
import { buildToolTracePayload, extractToolFilePaths, inferIntent } from "./sal-trace.js";

const NOSAL_FLAG = "nosal";
const SAL_AB_FLAG = "sal-ab";
const SAL_REBUILD_FLAG = "sal-rebuild-terrain";
const DIAGNOSTIC_EVENT_CHANNEL = "diagnostic:event";

async function ensureSnapshot(runtime: SalRuntime, forceRebuild: boolean): Promise<TerrainSnapshot | undefined> {
	if (runtime.snapshotErrored) return runtime.snapshot;
	// Fast path: fresh snapshot on disk and caller isn't forcing a rebuild.
	// Staleness probe is cheap (bounded readdir+stat) and yields the event loop.
	if (runtime.snapshot && !forceRebuild && !(await isSnapshotStale(runtime.snapshot))) {
		return runtime.snapshot;
	}
	// Dedup concurrent scans (prewarm vs first turn, two back-to-back turns, etc.).
	if (runtime.snapshotPromise) return runtime.snapshotPromise;
	runtime.snapshotPromise = (async () => {
		try {
			const snap = await buildTerrainIndex(runtime.workspaceRoot);
			runtime.snapshot = snap;
			return snap;
		} catch (err) {
			runtime.snapshotErrored = true;
			console.error("[sal] terrain index build failed:", (err as Error).message);
			return undefined;
		} finally {
			runtime.snapshotPromise = undefined;
		}
	})();
	return runtime.snapshotPromise;
}

async function formatCoverageReport(runtime: SalRuntime, modules: string[]): Promise<string> {
	const snapshot = await ensureSnapshot(runtime, false);
	if (!snapshot) return "[sal] terrain snapshot unavailable";
	const reports = checkDipCoverage(snapshot, modules);
	if (reports.length === 0) return "[sal] no modules matched the requested filter";
	const lines: string[] = ["[SAL DIP Coverage]"];
	for (const r of reports) {
		const gate = r.coveragePct >= 90 ? "PASS" : r.coveragePct >= 70 ? "WARN" : "FAIL";
		lines.push(
			`  ${gate}  ${r.module.padEnd(40)}  P3 ${r.filesWithP3}/${r.totalFiles}  (${r.coveragePct}%)  ` +
				`${r.hasP2 ? "P2:Y" : "P2:N"}  missingFields=${r.missingFields}`,
		);
	}
	lines.push("");
	lines.push("Gate: >=90% PASS, >=70% WARN, otherwise FAIL. Layer 1 experiments require PASS in target modules.");
	return lines.join("\n");
}

function resolveEvalVariant(runtime: SalRuntime, salEnabled: boolean): EvalVariant {
	if (runtime.evalVariantOverride) return runtime.evalVariantOverride;
	return salEnabled ? "sal" : "control";
}

async function emitEval(
	runtime: SalRuntime,
	eventType: Parameters<typeof createEvalEvent>[0],
	salEnabled: boolean,
	payload: Record<string, unknown>,
): Promise<void> {
	if (!runtime.evalEnabled) return;
	try {
		const event = createEvalEvent(
			eventType,
			runtime.evalRunId,
			resolveEvalVariant(runtime, salEnabled),
			payload,
			runtime.evalMetadata,
		);
		await runtime.evalSink.sendEvent(event);
	} catch (err) {
		runtime.reportDiagnostic({
			source: "sal.eval",
			severity: "error",
			category: "persistence",
			message: "SAL eval failed to enqueue an event.",
			detail: { eventType, error: (err as Error).message },
			fingerprint: `sal.eval:persistence:emit-${eventType}`,
		});
	}
}

async function evalBestEffort(runtime: SalRuntime, label: string, work: Promise<void>, timeoutMs = 6000): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			work,
			new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					runtime.reportDiagnostic({
						source: "sal.eval",
						severity: "warning",
						category: "extension_timeout",
						message: `SAL eval ${label} timed out; session shutdown continues.`,
						fingerprint: `sal.eval:extension_timeout:${label}`,
					});
					resolve();
				}, timeoutMs);
			}),
		]);
	} catch (err) {
		runtime.reportDiagnostic({
			source: "sal.eval",
			severity: "error",
			category: "persistence",
			message: `SAL eval ${label} failed.`,
			detail: { error: (err as Error).message },
			fingerprint: `sal.eval:persistence:${label}`,
		});
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Fire-and-forget PATCH to mark stale "running" eval runs as "abandoned".
 * Uses raw HTTP so it stays independent of the EvalSink batching pipeline.
 * Fully async — callers should void-call this and never await on the hot path.
 */
async function cleanupStaleRuns(runtime: SalRuntime): Promise<void> {
	if (!runtime.evalEndpoint) return;
	const base = runtime.evalEndpoint.replace(/\/+$/, "");
	// Mark runs from this workspace that are still "running" (but not the current run)
	const url = `${base}/api/database/records/eval_runs?` +
		`status=eq.running&` +
		`workspace_root=eq.${encodeURIComponent(runtime.workspaceRoot)}&` +
		`run_id=neq.${encodeURIComponent(runtime.evalRunId)}`;

	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (runtime.evalAnonKey) {
		headers["apikey"] = runtime.evalAnonKey;
		headers["Authorization"] = `Bearer ${runtime.evalAnonKey}`;
	}
	if (runtime.evalApiKey) {
		headers[runtime.evalApiKeyHeader ?? "x-api-key"] = runtime.evalApiKey;
		if (!runtime.evalAnonKey) {
			headers["Authorization"] = `Bearer ${runtime.evalApiKey}`;
		}
	}
	Object.assign(headers, runtime.evalHeaders);

	const body = JSON.stringify({
		status: "abandoned",
		ended_at: new Date().toISOString(),
	});

	const { request: httpsRequest } = await import("node:https");
	const { request: httpRequest } = await import("node:http");
	const { URL } = await import("node:url");

	const parsed = new URL(url);
	const isHttps = parsed.protocol === "https:";
	const reqFn = isHttps ? httpsRequest : httpRequest;
	const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);

	return new Promise<void>((resolve) => {
		const req = reqFn(
			{
				hostname: parsed.hostname,
				port,
				path: parsed.pathname + parsed.search,
				method: "PATCH",
				headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
				timeout: 5000,
				...(isHttps && runtime.evalAllowSelfSigned ? { rejectUnauthorized: false } : {}),
			},
			(res) => {
				// Drain response body (required to free the socket)
				res.resume();
				res.on("end", () => resolve());
			},
		);
		req.on("error", () => resolve());
		req.on("timeout", () => { req.destroy(); resolve(); });
		req.write(body);
		req.end();
	});
}

export default async function salExtension(api: ExtensionAPI) {
	api.registerFlag(NOSAL_FLAG, {
		type: "boolean",
		description: "Disable Structural Anchor Localization (SAL) - fall back to baseline memory mode",
		default: false,
	});
	api.registerFlag(SAL_AB_FLAG, {
		type: "boolean",
		description: "Enable SAL A/B experiment sidecar files under .memory-experiments",
		default: false,
	});
	api.registerFlag(SAL_REBUILD_FLAG, {
		type: "boolean",
		description: "Force SAL terrain index rebuild on next localization pass",
		default: false,
	});

	const workspaceRoot = api.cwd;
	const experimentId = process.env.NANOPENCIL_EXPERIMENT_ID;
	const sidecarDir = resolveSalSidecarDir(workspaceRoot, experimentId);
	const weightsDirCandidates = [workspaceRoot, join(workspaceRoot, ".memory-experiments", "sal")];
	const { weights, source: weightsSource } = loadSalWeights(weightsDirCandidates);
	const evalRunId =
		process.env[EVAL_RUN_ID_ENV] ??
		`np-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 8)}`;
	const reportDiagnostic: SalRuntime["reportDiagnostic"] = (event) => api.events.emit(DIAGNOSTIC_EVENT_CHANNEL, {
		...event,
		context: {
			...(event.context ?? {}),
			version: BUILD_META.version,
			commit_hash: BUILD_META.commitHash,
			session_id: evalRunId,
		},
	});

	const credentials = resolveEvalCredentials(workspaceRoot, reportDiagnostic);
	const evalEnabledByEnvRaw = process.env[EVAL_ENABLED_ENV];
	const evalEnabledByEnv = evalEnabledByEnvRaw !== undefined ? isTruthy(evalEnabledByEnvRaw) : undefined;
	const evalEndpoint = process.env[EVAL_ENDPOINT_ENV] ?? credentials?.insforge_url ?? credentials?.endpoint;
	const evalVariantEnv = process.env[EVAL_VARIANT_ENV];
	const evalVariantOverride =
		evalVariantEnv === "control"
		|| evalVariantEnv === "sal"
		|| evalVariantEnv === "baseline"
		|| evalVariantEnv === "self-diagnosis"
			? (evalVariantEnv as EvalVariant)
			: undefined;
	const evalApiKey = process.env[EVAL_API_KEY_ENV] ?? credentials?.api_key;
	const evalAnonKey = process.env["NANOPENCIL_EVAL_ANON_KEY"] ?? credentials?.anon_key;
	const evalApiKeyHeader = process.env[EVAL_API_KEY_HEADER_ENV] ?? credentials?.api_key_header;
	const evalAdapterEnv = process.env["NANOPENCIL_EVAL_ADAPTER"];
	const evalAdapter: EvalAdapterId | undefined =
		(evalAdapterEnv === "insforge" || evalAdapterEnv === "jsonl" || evalAdapterEnv === "noop")
			? evalAdapterEnv
			: credentials?.adapter;
	const evalHeaders = {
		...(credentials?.headers ?? {}),
		...parseHeadersJson(process.env[EVAL_HEADERS_JSON_ENV], reportDiagnostic),
	};

	// Activation: credentials with endpoint+api_key auto-enable (unless explicitly disabled).
	// Env var NANOPENCIL_EVAL_ENABLED can override either direction.
	const credHasConfig = !!(credentials?.endpoint ?? credentials?.insforge_url) && !!credentials?.api_key;
	const evalEnabledByCreds = credHasConfig && credentials?.enabled !== false;
	const evalCollectionEnabled =
		evalEnabledByEnv === false ? false : evalEnabledByCreds || evalEnabledByEnv === true;

	if (evalCollectionEnabled && !evalEndpoint) {
		api.events.emit(DIAGNOSTIC_EVENT_CHANNEL, {
			source: "sal.eval",
			severity: "warning",
			category: "config",
			message: "SAL eval is enabled but no endpoint was found; eval upload is disabled.",
			fingerprint: "sal.eval:config:missing-endpoint",
			context: {
				version: BUILD_META.version,
				commit_hash: BUILD_META.commitHash,
				session_id: evalRunId,
			},
		});
	}

	const evalAllowSelfSigned =
		isTruthy(process.env["NANOPENCIL_EVAL_ALLOW_SELF_SIGNED"]) ||
		(credentials?.allow_self_signed ?? false);
	const allowStaleCleanup = resolveStaleCleanupEnabled(
		process.env[EVAL_STALE_CLEANUP_ENV],
		credentials,
	);

	const evalSink = createEvalSink({
		enabled: evalCollectionEnabled && !!evalEndpoint,
		adapter: evalAdapter,
		endpoint: evalEndpoint,
		runId: evalRunId,
		headers: evalHeaders,
		apiKey: evalApiKey,
		anonKey: evalAnonKey,
		apiKeyHeader: evalApiKeyHeader,
		allowSelfSigned: evalAllowSelfSigned,
		onDiagnostic: reportDiagnostic,
	});

	const runtime: SalRuntime = {
		workspaceRoot,
		weights,
		weightsSource,
		turn: { turnId: 0, startedAtMs: Date.now(), touchedFiles: new Set<string>(), toolCalls: [] },
		sidecarDir,
		evalSink,
		evalAdapter,
		evalEndpoint,
		evalApiKey,
		evalAnonKey,
		evalApiKeyHeader,
		evalHeaders,
		evalAllowSelfSigned,
		evalEnabled: evalSink.enabled,
		evalRunId,
		evalVariantOverride,
		evalStartedAtMs: Date.now(),
		evalRunStarted: false,
		turnCounter: 0,
		allowStaleCleanup,
		evalMetadata: {
			workspace_root: workspaceRoot,
			session_id: evalRunId,
		},
		buildMeta: BUILD_META,
		staleCleanupDone: false,
		pendingRebuild: false,
		reportDiagnostic,
	};

	const isEnabled = (): boolean => !api.getFlag(NOSAL_FLAG);
	const isSalAbEnabled = (): boolean => resolveSalAbEnabled(api.getFlag(SAL_AB_FLAG));

	api.registerCommand("sal:coverage", {
		description: "Report DIP P3 coverage for SAL prerequisite gating. Usage: /sal:coverage [module1 module2 ...]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const modules = (args ?? "")
				.trim()
				.split(/\s+/)
				.filter((s) => s.length > 0);
			const report = await formatCoverageReport(runtime, modules);
			ctx.ui.notify(report, "info");
			api.sendMessage({
				customType: "sal_coverage_report",
				content: report,
				display: true,
				details: { modules, weightsSource: runtime.weightsSource },
			});
		},
	});

	api.registerCommand("sal:setup", {
		description:
			"Configure SAL eval credentials. " +
			"Usage: /sal:setup <endpoint> [api_key] [anon_key]  — adapter inferred from endpoint scheme " +
			"(http/https → InsForge backend; file path or file:// → local JSONL log).",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const tokens = (args ?? "").trim().split(/\s+/).filter((t) => t.length > 0);
			const endpoint = tokens[0];
			const apiKey = tokens[1];
			const anonKey = tokens[2];

			if (!endpoint) {
				ctx.ui.notify(
					"[SAL Setup] Usage: /sal:setup <endpoint> [api_key] [anon_key]\n" +
					"  - InsForge: /sal:setup https://app.region.insforge.app ik_xxx [anon_jwt]\n" +
					"  - Local JSONL: /sal:setup /path/to/eval-events.jsonl",
					"error",
				);
				return;
			}

			// Infer adapter from endpoint scheme; jsonl needs no api_key
			const inferredAdapter: EvalAdapterId =
				/^https?:\/\//i.test(endpoint) ? "insforge"
				: (endpoint.startsWith("file://") || endpoint.startsWith("/") || endpoint.startsWith("./") || endpoint.startsWith("../")) ? "jsonl"
				: "insforge";

			if (inferredAdapter === "insforge" && !apiKey) {
				ctx.ui.notify("[SAL Setup] InsForge adapter requires <api_key>", "error");
				return;
			}

			const credDir = join(homedir(), ".memory-experiments");
			const credPath = join(credDir, "credentials.json");
			try {
				if (!existsSync(credDir)) mkdirSync(credDir, { recursive: true });
				const creds: Record<string, unknown> = {
					adapter: inferredAdapter,
					endpoint,
					enabled: true,
				};
				if (apiKey) creds.api_key = apiKey;
				if (anonKey) creds.anon_key = anonKey;
				if (inferredAdapter === "insforge") creds.allow_self_signed = true;
				writeFileSync(credPath, JSON.stringify(creds, null, 2), "utf-8");
			} catch (err) {
				ctx.ui.notify(`[SAL Setup] Failed to write credentials: ${(err as Error).message}`, "error");
				return;
			}
			// Activate sink immediately without restart
			runtime.evalAdapter = inferredAdapter;
			runtime.evalEndpoint = endpoint;
			runtime.evalApiKey = apiKey;
			runtime.evalAnonKey = anonKey;
			const newSink = createEvalSink({
				enabled: true,
				adapter: inferredAdapter,
				endpoint,
				runId: runtime.evalRunId,
				headers: runtime.evalHeaders,
				apiKey,
				anonKey,
				apiKeyHeader: runtime.evalApiKeyHeader,
				allowSelfSigned: inferredAdapter === "insforge",
			});
			runtime.evalSink = newSink;
			runtime.evalEnabled = true;

			// Connectivity check: send a probe event and flush immediately
			ctx.ui.notify(`[SAL Setup] Testing ${inferredAdapter} sink…`, "info");
			const probeEvent = createEvalEvent("run_start", runtime.evalRunId, "sal", {
				_probe: true,
				workspace_root: runtime.workspaceRoot,
				model: "unknown",
				thinking: false,
				commit: "unknown",
				branch: "unknown",
			}, runtime.evalMetadata);
			await newSink.sendEvent(probeEvent);
			await newSink.flush();
			// Do NOT set evalRunStarted=true here — let before_agent_start emit the real
			// run_start with the actual model name, which will upsert (merge-duplicates)
			// and overwrite the probe's model=unknown placeholder.

			ctx.ui.notify(
				`[SAL Setup] Credentials saved to ${credPath}\n` +
				`Eval collection active. run_id: ${runtime.evalRunId}\n` +
				`Check terminal output for any HTTP errors from the probe request.`,
				"info",
			);
		},
	});

	api.registerCommand("sal:status", {
		description: "Show current SAL configuration and snapshot status",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const flagOn = isEnabled();
			const snapshot = runtime.snapshot;
			const endpointDisplay = runtime.evalEndpoint
				? runtime.evalEndpoint.replace(/^(https?:\/\/[^/]{0,20}).*/, "$1…")
				: "(not configured — use /sal:setup <endpoint> <api_key>)";
			const lines = [
				"[SAL Status]",
				`  SAL: ${flagOn ? "ON (default)" : "OFF (--nosal)"}`,
				`  SAL A/B sidecar: ${isSalAbEnabled() ? "ON (--sal-ab)" : "OFF"}`,
				`  eval: ${runtime.evalEnabled ? "ON" : "OFF"}`,
				`  adapter: ${runtime.evalAdapter ?? "(inferred at sink creation)"}`,
				`  endpoint: ${endpointDisplay}`,
				`  run_id: ${runtime.evalRunId}`,
				`  workspaceRoot: ${runtime.workspaceRoot}`,
				`  weightsSource: ${runtime.weightsSource}`,
				`  snapshotGeneratedAt: ${snapshot ? new Date(snapshot.generatedAt).toISOString() : "(not built)"}`,
				`  nodes: ${snapshot?.nodes.length ?? 0}`,
				`  sidecarDir: ${isSalAbEnabled() ? runtime.sidecarDir : "(disabled; use --sal-ab)"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

		api.on(
			"before_agent_start",
			async (event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<BeforeAgentStartEventResult | undefined> => {
				// ---------------------------------------------------------------
				// ZERO-I/O CONTRACT: this handler must NEVER await filesystem work.
				// runner.ts enforces a 1500ms timeout on before_agent_start; any
				// I/O (terrain build, staleness probe, HTTP) risks timeout which
				// silently drops SAL's appendSystemPrompt injection.
				//
				// All terrain building and refresh happens in the background:
				//   1. Extension load → setImmediate prewarm
				//   2. agent_end     → async staleness check + rebuild
				//   3. --sal-rebuild-terrain → flag read here, rebuild in agent_end
				//
				// This handler only reads runtime.snapshot (in-memory) and runs
				// locateTask() (pure computation, <5ms).
				// ---------------------------------------------------------------

				// Yield once so any UI frame queued via process.nextTick right before
				// session.prompt() (notably the user-message bubble) flushes to stdout.
				// Without this, GPU block terminals (Warp) coalesce the whole turn's
				// render into one block that only paints when the turn ends.
				await new Promise<void>((resolve) => setImmediate(resolve));

				resetTurnContext();

				runtime.turnCounter += 1;
				runtime.turn = {
					turnId: runtime.turnCounter,
					startedAtMs: Date.now(),
					touchedFiles: new Set<string>(),
					toolCalls: [],
					prompt: event.prompt,
				};

				if (!runtime.evalRunStarted && runtime.evalEnabled) {
					runtime.evalRunStarted = true;
					runtime.evalMetadata.model = runtime.evalMetadata.model ?? (ctx.model as any)?.id ?? (ctx.model as any)?.name;
					// emitEval pushes to a batching queue; does NOT await HTTP.
					void emitEval(runtime, "run_start", isEnabled(), {
						task_description: (event.prompt ?? "").slice(0, 500),
						task_file: process.env.NANOPENCIL_EXPERIMENT_TASK_FILE,
						model: runtime.evalMetadata.model ?? "unknown",
						thinking: false,
						pencil_version: runtime.buildMeta.version,
						commit: process.env.NANOPENCIL_EVAL_COMMIT ?? runtime.buildMeta.commitHash ?? "unknown",
						branch: process.env.NANOPENCIL_EVAL_BRANCH ?? runtime.buildMeta.branch ?? "unknown",
						workspace_root: runtime.workspaceRoot,
					});
					// Strategy B: optional fire-and-forget stale run cleanup.
					scheduleStaleCleanup();
				}

				if (!isEnabled()) return undefined;

				// Skip SAL localization for trivially short prompts (e.g. print-mode
				// startup word "print") — they carry no structural signal and inflate
				// the zero-hit rate in eval data.
				const prompt = (event.prompt ?? "").trim();
				if (prompt.length < 12) return undefined;

				// Pure memory read — if prewarm hasn't finished yet, snapshot is
				// undefined and we gracefully skip SAL for this turn.
				const snapshot = runtime.snapshot;
				if (!snapshot) return undefined;

				// Record if user wants a rebuild; agent_end will act on it.
				if (api.getFlag(SAL_REBUILD_FLAG)) {
					runtime.pendingRebuild = true;
				}

				const resolution = locateTask({
					prompt,
					cwd: runtime.workspaceRoot,
					snapshot,
					weights: runtime.weights,
				});
				runtime.turn.taskResolution = resolution;

				const selectedAnchor = resolution.selected;
				const candidatePaths = resolution.candidates
					.slice(0, 4)
					.flatMap((c) => [c.anchor.modulePath, c.anchor.filePath].filter(Boolean) as string[]);
				if (selectedAnchor || candidatePaths.length > 0) {
					setTurnContext("structuralAnchor", {
						modulePath: selectedAnchor?.modulePath,
						filePath: selectedAnchor?.filePath,
						candidatePaths,
					});
				}

				const injection = buildContextInjection(resolution, snapshot);
				if (!injection) return undefined;
				return { appendSystemPrompt: injection };
			},
		);

	api.on("tool_execution_start", async (event: ToolExecutionStartEvent, _ctx: ExtensionContext) => {
		const paths = extractToolFilePaths(event.toolName, event.args, runtime.workspaceRoot);
		for (const p of paths) runtime.turn.touchedFiles.add(p);
		runtime.turn.toolCalls.push({
			toolCallId: event.toolCallId,
			tool: event.toolName,
			startMs: Date.now(),
		});
	});

	api.on("tool_execution_end", async (event: ToolExecutionEndEvent, _ctx: ExtensionContext) => {
		const record = runtime.turn.toolCalls.find((tc) => tc.toolCallId === event.toolCallId);
		if (record) {
			record.endMs = Date.now();
			record.isError = event.isError;
		}
	});

	api.on("agent_end", async (_event: AgentEndEvent, _ctx: ExtensionContext) => {
		const turnDuration = Math.max(0, Date.now() - runtime.turn.startedAtMs);
		const taskRes = runtime.turn.taskResolution;

		const snapshot = runtime.snapshot;
		let actionRes: AnchorResolution | undefined;
		if (isEnabled() && snapshot) {
			actionRes = locateAction({
				touchedFiles: Array.from(runtime.turn.touchedFiles),
				snapshot,
			});
		}

		// hit = SAL predicted the right module where the agent actually worked
		const taskModule = taskRes?.selected?.modulePath ?? taskRes?.selected?.filePath ?? null;
		const actionModule = actionRes?.selected?.modulePath ?? actionRes?.selected?.filePath ?? null;
		const hit = !!(taskModule && actionModule && taskModule === actionModule);

		await emitEval(runtime, "turn_anchor", isEnabled(), {
			turn_id: runtime.turn.turnId,
			prompt_summary: (runtime.turn.prompt ?? "").slice(0, 200),
			task_anchor: taskRes?.selected ?? null,
			task_candidates: (taskRes?.candidates ?? []).slice(0, 3).map(
				(c) => c.anchor.modulePath ?? c.anchor.filePath ?? null,
			),
			action_files: Array.from(runtime.turn.touchedFiles).slice(0, 10),
			action_anchor: actionRes?.selected ?? null,
			hit,
			sal_enabled: isEnabled(),
			duration_ms: turnDuration,
		});

		// Emit memory recall snapshot (written by mem-core during before_agent_start).
		// Skip for trivially short prompts (internal probes, print-mode startup)
		// to avoid duplicate records for the same memories.
		const turnPrompt = (runtime.turn.prompt ?? "").trim();
		if (turnPrompt.length >= 12) {
			const recallSnapshot = getTurnContext("memoryRecallSnapshot");
			if (recallSnapshot && recallSnapshot.length > 0) {
				await emitEval(runtime, "memory_recalls", isEnabled(), {
					turn_id: runtime.turn.turnId,
					recalls: recallSnapshot,
				});
			}
		}

		// Emit tool usage trace for self-awareness analytics.
		// Always emit a bounded summary, including no-tool turns.
		await emitEval(runtime, "tool_trace", isEnabled(), buildToolTracePayload(runtime.turn, turnDuration));

		if (isSalAbEnabled() && actionRes) {
			persistTurnRecord(runtime, taskRes, actionRes);
		}

		runtime.turn = {
			turnId: runtime.turn.turnId,
			startedAtMs: Date.now(),
			touchedFiles: new Set<string>(),
			toolCalls: [],
		};

		// ---------------------------------------------------------------
		// Background terrain refresh — runs AFTER the turn is done.
		// agent_end has no timeout, so async I/O is safe here.
		// This keeps the snapshot fresh for the NEXT before_agent_start
		// without ever blocking the hook that has the 1500ms deadline.
		// ---------------------------------------------------------------
		if (isEnabled()) {
			const wantRebuild = runtime.pendingRebuild;
			runtime.pendingRebuild = false;
			// Fire-and-forget: don't block agent_end from finishing.
			void (async () => {
				try {
					if (wantRebuild) {
						await ensureSnapshot(runtime, true);
					} else if (runtime.snapshot && await isSnapshotStale(runtime.snapshot)) {
						await ensureSnapshot(runtime, true);
					}
				} catch {
					// Non-fatal; snapshotErrored flag is set inside ensureSnapshot.
				}
			})();
		}
	});

		api.on("session_shutdown", async () => {
			process.off("beforeExit", emergencyFlush);
			process.off("SIGHUP", signalFlush);
			process.off("SIGTERM", signalFlush);
			if (!runtime.evalEnabled) return;
			await emitEval(runtime, "run_end", isEnabled(), {
				status: "completed",
				turn_count: runtime.turnCounter,
				total_duration_ms: Math.max(0, Date.now() - runtime.evalStartedAtMs),
			});
			await evalBestEffort(runtime, "flush", runtime.evalSink.flush());
			await evalBestEffort(runtime, "close", runtime.evalSink.close());
		});

	// ------------------------------------------------------------------
	// Strategy A: Emergency flush on abnormal exit.
	// Best-effort — these may not complete if the process is killed hard,
	// but they cover uncaught exceptions and natural event-loop drain.
	// IMPORTANT: no sync I/O — all async, fire-and-forget.
	// ------------------------------------------------------------------
	let emergencyFlushed = false;
	const emergencyFlush = (): void => {
		if (emergencyFlushed || !runtime.evalEnabled || !runtime.evalRunStarted) return;
		emergencyFlushed = true;
		void emitEval(runtime, "run_end", isEnabled(), {
			status: "interrupted",
			turn_count: runtime.turnCounter,
			total_duration_ms: Math.max(0, Date.now() - runtime.evalStartedAtMs),
		})
			.then(() => evalBestEffort(runtime, "emergency flush", runtime.evalSink.flush()))
			.catch(() => {});
	};
	process.on("beforeExit", emergencyFlush);
	// SIGINT is already handled by interactive-mode (double Ctrl+C → shutdown).
	// We only add SIGHUP/SIGTERM as secondary safety nets; they do not replace
	// the primary session_shutdown flow.
	const signalFlush = () => { emergencyFlush(); };
	process.on("SIGHUP", signalFlush);
	process.on("SIGTERM", signalFlush);

	// ------------------------------------------------------------------
	// Strategy B: Opt-in stale run cleanup on first turn.
	// Disabled by default because workspace_root alone cannot distinguish
	// a dead run from another live nanoPencil instance in the same repo.
	// Operators may re-enable it explicitly in single-run environments.
	//
	// When enabled, on the first before_agent_start, fire-and-forget a PATCH
	// to mark stale "running" runs from the same workspace as "abandoned".
	// Runs fully async — does NOT block the before_agent_start return,
	// so the TUI renders the user's message immediately in GPU block
	// terminals (Warp, etc.).
	// ------------------------------------------------------------------
	function scheduleStaleCleanup(): void {
		if (
			runtime.staleCleanupDone ||
			!runtime.evalEnabled ||
			!runtime.evalEndpoint ||
			!runtime.allowStaleCleanup
		) return;
		runtime.staleCleanupDone = true;
		// Defer to next tick so the current hook returns instantly.
		setImmediate(() => {
			void cleanupStaleRuns(runtime).catch(() => {});
		});
	}

	// Background prewarm: start the first terrain build as soon as the TUI has
	// painted the initial frame. setImmediate defers it past the current stack
	// and any process.nextTick callbacks, so startup rendering is untouched.
	// On the first turn, ensureSnapshot reuses the in-flight promise (no
	// redundant scan), and the user's message bubble is never gated on a
	// cold-disk workspace walk.
	setImmediate(() => {
		if (!isEnabled()) return;
		void ensureSnapshot(runtime, false).catch(() => {
			// Errors are already captured into runtime.snapshotErrored.
		});
	});
}

export {
	SAL_DEFAULT_WEIGHTS,
	buildToolTracePayload,
	inferIntent,
	normalizeExperimentId,
	resolveSalSidecarDir,
	resolveSalAbEnabled,
	resolveStaleCleanupEnabled,
};
