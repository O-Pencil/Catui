/**
 * [WHO]: Issue-reporting end-to-end smoke (manual runner, not a unit test)
 * [FROM]: Reads .memory-experiments/credentials.json; uses extensions/builtin/diagnostics/reporter
 * [TO]: Run with `npx tsx test/diagnostics-issue-smoke.ts` to confirm pencil_issue_events ingest works
 * [HERE]: test/diagnostics-issue-smoke.ts - sends a synthetic diagnostic report through reportDiagnostics() and reads it back via ik_
 *
 * Exit 0 = report landed; non-zero = something is broken.
 */
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { URL } from "node:url";
import { join } from "node:path";
import { reportDiagnostics } from "../extensions/builtin/diagnostics/reporter.js";
import type { DiagnosticRecord } from "../extensions/builtin/diagnostics/types.js";

interface Creds {
	endpoint: string;
	api_key?: string;
	anon_key?: string;
	allow_self_signed?: boolean;
}

function loadCreds(): Creds {
	const path = process.env.SAL_CREDENTIALS_PATH
		?? join(process.cwd(), ".memory-experiments", "credentials.json");
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	if (!parsed.endpoint) throw new Error(`endpoint missing in ${path}`);
	return parsed;
}

async function getJson(url: string, headers: Record<string, string>, allowSelfSigned: boolean) {
	const u = new URL(url);
	return new Promise<{ status: number; body: string }>((resolve, reject) => {
		const req = request({
			method: "GET",
			hostname: u.hostname,
			port: u.port || 443,
			path: u.pathname + u.search,
			headers,
			rejectUnauthorized: !allowSelfSigned,
		}, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
		});
		req.on("error", reject);
		req.end();
	});
}

async function main(): Promise<void> {
	const creds = loadCreds();
	const fingerprint = `smoke.issue:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	const now = new Date().toISOString();

	const record: DiagnosticRecord = {
		source: "smoke.issue",
		severity: "warning",
		category: "fallback",
		message: "synthetic issue smoke",
		detail: { reason: "verifying pencil_issue_events ingest path" },
		fingerprint,
		first_seen_at: now,
		last_seen_at: now,
		occurrence_count: 1,
		prompted: false,
		reported: false,
		context: { mode: "smoke" },
	};

	const ctx = {
		model: { provider: "smoke-provider", id: "smoke-model" },
		sessionManager: { getSessionId: () => "smoke-session" },
	} as unknown as Parameters<typeof reportDiagnostics>[2];

	console.log(`[issue-smoke] endpoint = ${creds.endpoint}`);
	console.log(`[issue-smoke] fingerprint = ${fingerprint}`);

	const result = await reportDiagnostics([record], "smoke note", ctx);
	console.log(`[issue-smoke] reporter result: ok=${result.ok} configured=${result.configured} status=${result.statusCode ?? "-"} msg=${result.message}`);

	if (!result.ok) {
		console.error("[issue-smoke] FAIL — reporter did not return ok");
		process.exit(1);
	}

	// Verify the row landed (ik_ to bypass RLS on freshly-created tables)
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (creds.api_key) {
		headers["x-api-key"] = creds.api_key;
		headers["Authorization"] = `Bearer ${creds.api_key}`;
	} else if (creds.anon_key) {
		headers["apikey"] = creds.anon_key;
		headers["Authorization"] = `Bearer ${creds.anon_key}`;
	}

	const verifyUrl = `${creds.endpoint.replace(/\/+$/, "")}/api/database/records/pencil_issue_events?fingerprint=eq.${encodeURIComponent(fingerprint)}`;
	const verify = await getJson(verifyUrl, headers, creds.allow_self_signed ?? false);
	if (verify.status !== 200) {
		console.error(`[issue-smoke] FAIL — verify HTTP ${verify.status}: ${verify.body.slice(0, 200)}`);
		process.exit(1);
	}
	let rows: Array<Record<string, unknown>> = [];
	try { rows = JSON.parse(verify.body); } catch { /* empty */ }
	if (!Array.isArray(rows) || rows.length === 0) {
		console.error("[issue-smoke] FAIL — fingerprint not found in pencil_issue_events");
		process.exit(1);
	}

	const row = rows[0];
	console.log(`[issue-smoke] PASS — row id=${row.id} occurrence_count=${row.occurrence_count} severity=${row.severity}`);
	if (typeof row.diagnostics === "string" && row.diagnostics.includes(fingerprint)) {
		console.log("[issue-smoke] diagnostics column round-tripped fingerprint");
	}
}

main().catch((err) => {
	console.error("[issue-smoke] unhandled error:", err);
	process.exit(2);
});
