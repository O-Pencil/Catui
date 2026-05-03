/**
 * [WHO]: reportDiagnostics(), buildReportPayload()
 * [FROM]: Depends on node:http, node:https, node:fs, node:os, node:path, node:crypto, core extension context types, ./types.js, ./redaction.js
 * [TO]: Consumed by extensions/defaults/diagnostics/index.ts for silent auto-upload + /report-issue manual bundles
 * [HERE]: extensions/defaults/diagnostics/reporter.ts - InsForge pencil_issue_events adapter; reads NANOPENCIL_ISSUE_* env first, falls back to <workspace>/.memory-experiments/credentials.json then ~/.memory-experiments/credentials.json (shared with SAL eval) so issue reporting "just works" once SAL is set up
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { VERSION } from "../../../config.js";
import type { ExtensionContext } from "../../../core/extensions/types.js";
import type { DiagnosticRecord, DiagnosticReportPayload } from "./types.js";
import { sanitizeDiagnosticValue } from "./redaction.js";

const ISSUE_ENDPOINT_ENV = "NANOPENCIL_ISSUE_ENDPOINT";
const ISSUE_API_KEY_ENV = "NANOPENCIL_ISSUE_API_KEY";
const ISSUE_ANON_KEY_ENV = "NANOPENCIL_ISSUE_ANON_KEY";
const ISSUE_API_KEY_HEADER_ENV = "NANOPENCIL_ISSUE_API_KEY_HEADER";

interface ReporterCreds {
	endpoint: string;
	apiKey?: string;
	anonKey?: string;
	apiKeyHeader?: string;
	allowSelfSigned?: boolean;
}

interface ReportResult {
	ok: boolean;
	configured: boolean;
	statusCode?: number;
	message: string;
}

export async function reportDiagnostics(
	records: DiagnosticRecord[],
	userNote: string | undefined,
	ctx: ExtensionContext,
): Promise<ReportResult> {
	const creds = resolveReporterCreds();
	if (!creds) {
		return {
			ok: false,
			configured: false,
			message: `Issue reporting is not configured. Set ${ISSUE_ENDPOINT_ENV} or run /sal:setup to populate .memory-experiments/credentials.json.`,
		};
	}

	const payload = buildReportPayload(records, userNote, ctx);
	const row = serializeRow(payload);
	const url = `${creds.endpoint}/api/database/records/pencil_issue_events`;
	return postJson(url, [row], creds);
}

export function buildReportPayload(
	records: DiagnosticRecord[],
	userNote: string | undefined,
	ctx: ExtensionContext,
): DiagnosticReportPayload {
	const primary = records[0];
	const model = ctx.model as { provider?: string; id?: string; model?: string; name?: string } | undefined;
	const sessionId = safeCall(() => ctx.sessionManager.getSessionId());
	const diagnostics = sanitizeDiagnosticValue(records) as DiagnosticRecord[];
	const context = primary?.context ?? {};
	return {
		session_id: str(context.session_id) ?? sessionId,
		version: str(context.version) ?? VERSION,
		commit_hash: str(context.commit_hash),
		mode: str(context.mode),
		source: primary?.source,
		severity: primary?.severity,
		category: primary?.category,
		message: primary?.message,
		fingerprint: primary?.fingerprint,
		provider: str(context.provider) ?? model?.provider,
		model_id: str(context.model_id) ?? model?.id ?? model?.model ?? model?.name,
		thinking: str(context.thinking),
		tool_summary: context.tool_summary ?? null,
		diagnostics,
		user_note: userNote ? String(sanitizeDiagnosticValue(userNote)) : undefined,
		user_approved: true,
		occurrence_count: records.reduce((sum, record) => sum + record.occurrence_count, 0),
		first_seen_at: records.reduce<string | undefined>((min, record) =>
			!min || record.first_seen_at < min ? record.first_seen_at : min, undefined),
		last_seen_at: records.reduce<string | undefined>((max, record) =>
			!max || record.last_seen_at > max ? record.last_seen_at : max, undefined),
		client_report_id: randomUUID(),
		created_at: new Date().toISOString(),
	};
}

// InsForge columns are all TEXT and id/created_at/updated_at are auto-managed.
// Coerce every value to string-or-null and JSON-stringify nested fields so the
// PostgREST insert matches the schema we created.
function serializeRow(payload: DiagnosticReportPayload): Record<string, string | null> {
	const recordedAt = payload.created_at;
	const row: Record<string, string | null> = {
		client_report_id: payload.client_report_id,
		session_id: strOrNull(payload.session_id),
		version: strOrNull(payload.version),
		commit_hash: strOrNull(payload.commit_hash),
		mode: strOrNull(payload.mode),
		source: strOrNull(payload.source),
		severity: strOrNull(payload.severity),
		category: strOrNull(payload.category),
		message: strOrNull(payload.message),
		fingerprint: strOrNull(payload.fingerprint),
		provider: strOrNull(payload.provider),
		model_id: strOrNull(payload.model_id),
		thinking: strOrNull(payload.thinking),
		tool_summary: payload.tool_summary == null ? null : JSON.stringify(payload.tool_summary),
		diagnostics: payload.diagnostics ? JSON.stringify(payload.diagnostics) : null,
		user_note: strOrNull(payload.user_note),
		user_approved: String(payload.user_approved === true),
		occurrence_count: String(payload.occurrence_count ?? 0),
		first_seen_at: strOrNull(payload.first_seen_at),
		last_seen_at: strOrNull(payload.last_seen_at),
		recorded_at: recordedAt,
	};
	return row;
}

function resolveReporterCreds(): ReporterCreds | undefined {
	const envEndpoint = process.env[ISSUE_ENDPOINT_ENV]?.replace(/\/+$/, "");
	if (envEndpoint) {
		return {
			endpoint: envEndpoint,
			apiKey: process.env[ISSUE_API_KEY_ENV],
			anonKey: process.env[ISSUE_ANON_KEY_ENV],
			apiKeyHeader: process.env[ISSUE_API_KEY_HEADER_ENV],
		};
	}

	const candidates = [
		join(process.cwd(), ".memory-experiments", "credentials.json"),
		join(homedir(), ".memory-experiments", "credentials.json"),
	];
	for (const path of candidates) {
		if (!existsSync(path)) continue;
		try {
			const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
			const endpoint = typeof parsed.endpoint === "string" ? parsed.endpoint.replace(/\/+$/, "") : undefined;
			if (!endpoint) continue;
			return {
				endpoint,
				apiKey: typeof parsed.api_key === "string" ? parsed.api_key : undefined,
				anonKey: typeof parsed.anon_key === "string" ? parsed.anon_key : undefined,
				allowSelfSigned: parsed.allow_self_signed === true,
			};
		} catch {
			// next candidate
		}
	}
	return undefined;
}

function postJson(url: string, body: unknown, creds: ReporterCreds): Promise<ReportResult> {
	return new Promise((resolve) => {
		const payload = JSON.stringify(body);
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			resolve({ ok: false, configured: true, message: "Invalid issue endpoint URL." });
			return;
		}
		const isHttps = parsed.protocol === "https:";
		const requestFn = isHttps ? httpsRequest : httpRequest;
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"Content-Length": String(Buffer.byteLength(payload)),
		};
		if (creds.anonKey) {
			headers.apikey = creds.anonKey;
			headers.Authorization = `Bearer ${creds.anonKey}`;
		}
		if (creds.apiKey) {
			headers[creds.apiKeyHeader ?? "x-api-key"] = creds.apiKey;
			// Newly-created InsForge tables apply project_admin RLS by default,
			// so anon writes are denied. ik_ via the gateway elevates to service
			// role — prefer it for Bearer when both keys are present.
			headers.Authorization = `Bearer ${creds.apiKey}`;
		}

		const req = requestFn(
			{
				hostname: parsed.hostname,
				port: parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80),
				path: parsed.pathname + parsed.search,
				method: "POST",
				headers,
				timeout: 5000,
				...(isHttps && creds.allowSelfSigned ? { rejectUnauthorized: false } : {}),
			},
			(res) => {
				let rawBody = "";
				res.setEncoding("utf-8");
				res.on("data", (chunk) => { rawBody += chunk; });
				res.on("end", () => {
					const ok = res.statusCode !== undefined && res.statusCode < 300;
					resolve({
						ok,
						configured: true,
						statusCode: res.statusCode,
						message: ok ? "Diagnostic report uploaded." : `Issue upload failed: HTTP ${res.statusCode} ${rawBody.slice(0, 160)}`,
					});
				});
			},
		);
		req.on("error", (err) => resolve({ ok: false, configured: true, message: `Issue upload failed: ${err.message}` }));
		req.on("timeout", () => {
			req.destroy();
			resolve({ ok: false, configured: true, message: "Issue upload timed out." });
		});
		req.write(payload);
		req.end();
	});
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function strOrNull(value: unknown): string | null {
	if (value == null) return null;
	const s = String(value);
	return s.length === 0 ? null : s;
}

function safeCall<T>(fn: () => T): T | undefined {
	try {
		return fn();
	} catch {
		return undefined;
	}
}
