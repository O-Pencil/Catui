/**
 * [WHO]: SAL → InsForge end-to-end smoke check (manual runner, not a unit test)
 * [FROM]: Reads .memory-experiments/credentials.json; uses InsForgeEvalSink
 * [TO]: Run with `npx tsx test/sal-insforge-smoke.ts` to confirm tool_trace lands in InsForge
 * [HERE]: test/sal-insforge-smoke.ts - exercises the same sink path SAL uses at runtime
 *
 * Usage:
 *   npx tsx test/sal-insforge-smoke.ts
 *
 * Exit code 0 = all events landed; non-zero = something is broken.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:https";
import { URL } from "node:url";
import { InsForgeEvalSink } from "../extensions/defaults/sal/eval/insforge-sink.js";
import type { EvalEventEnvelope } from "../extensions/defaults/sal/eval/types.js";

interface Creds {
	endpoint: string;
	api_key?: string;
	anon_key?: string;
	allow_self_signed?: boolean;
}

function loadCreds(): Creds {
	const path = process.env.SAL_CREDENTIALS_PATH
		?? join(process.cwd(), ".memory-experiments", "credentials.json");
	const raw = readFileSync(path, "utf8");
	const parsed = JSON.parse(raw);
	if (!parsed.endpoint) throw new Error(`endpoint missing in ${path}`);
	return parsed;
}

function ts(): string {
	return new Date().toISOString();
}

function makeRunId(): string {
	return `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getJson(url: string, headers: Record<string, string>, allowSelfSigned: boolean): Promise<{ status: number; body: string }> {
	const u = new URL(url);
	return new Promise((resolve, reject) => {
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
	const runId = makeRunId();
	const eventBase = { run_id: runId, variant: "sal" as const, ts: ts() };

	console.log(`[smoke] endpoint = ${creds.endpoint}`);
	console.log(`[smoke] run_id   = ${runId}`);

	const sink = new InsForgeEvalSink({
		enabled: true,
		endpoint: creds.endpoint,
		runId,
		apiKey: creds.api_key,
		anonKey: creds.anon_key,
		allowSelfSigned: creds.allow_self_signed ?? false,
		batchIntervalMs: 200,
	});

	const runStart: EvalEventEnvelope = {
		...eventBase,
		event_id: `${runId}-run-start`,
		event_type: "run_start",
		payload: {
			task_description: "[smoke] tool_trace pipeline check",
			model: "smoke-model",
			thinking: false,
			pencil_version: "smoke-test",
			commit: "smoke",
			branch: "smoke",
			workspace_root: process.cwd(),
		},
	};

	const toolTrace: EvalEventEnvelope = {
		...eventBase,
		event_id: `${runId}-tool-trace-1`,
		event_type: "tool_trace",
		payload: {
			turn_id: 1,
			tool_calls: [{ tool: "read", count: 2, errors: 0, avg_ms: 12, completed_calls: 2 }],
			tool_sequence: ["read", "grep"],
			task_signals: {
				intent: "explore",
				prompt_length: 42,
				has_error_trace: false,
				has_file_reference: true,
			},
			has_tool_usage: true,
			total_tool_calls: 2,
			total_errors: 0,
			completed_tool_calls: 2,
			truncated_tool_calls: 0,
			truncated_tool_summary: 0,
			duration_ms: 321,
		},
	};

	const runEnd: EvalEventEnvelope = {
		...eventBase,
		event_id: `${runId}-run-end`,
		event_type: "run_end",
		ts: ts(),
		payload: { status: "completed", turn_count: 1, total_duration_ms: 321 },
	};

	console.log("[smoke] sending run_start ...");
	await sink.sendEvent(runStart);
	await sink.flush();

	console.log("[smoke] sending tool_trace ...");
	await sink.sendEvent(toolTrace);
	await sink.flush();

	console.log("[smoke] sending run_end ...");
	await sink.sendEvent(runEnd);
	await sink.flush();
	await sink.close();

	// Verify using ik_ (service role): anon SELECT may be blocked by RLS on
	// freshly-created tables, while writes still land via the x-api-key gateway.
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (creds.api_key) {
		headers["x-api-key"] = creds.api_key;
		headers["Authorization"] = `Bearer ${creds.api_key}`;
	} else if (creds.anon_key) {
		headers["apikey"] = creds.anon_key;
		headers["Authorization"] = `Bearer ${creds.anon_key}`;
	}

	const allowSelfSigned = creds.allow_self_signed ?? false;
	const checks: Array<{ table: string; expected: number }> = [
		{ table: "eval_runs", expected: 1 },
		{ table: "eval_tool_traces", expected: 1 },
	];

	let failures = 0;
	for (const c of checks) {
		const url = `${creds.endpoint.replace(/\/+$/, "")}/api/database/records/${c.table}?run_id=eq.${encodeURIComponent(runId)}`;
		const r = await getJson(url, headers, allowSelfSigned);
		if (r.status !== 200) {
			console.error(`[smoke] FAIL ${c.table}: HTTP ${r.status} body=${r.body.slice(0, 200)}`);
			failures += 1;
			continue;
		}
		let rows: unknown[] = [];
		try { rows = JSON.parse(r.body); } catch { /* empty */ }
		const ok = Array.isArray(rows) && rows.length >= c.expected;
		console.log(`[smoke] ${ok ? "PASS" : "FAIL"} ${c.table}: ${Array.isArray(rows) ? rows.length : 0} rows (expected ≥ ${c.expected})`);
		if (!ok) {
			failures += 1;
			console.error(`        body: ${r.body.slice(0, 400)}`);
		}
	}

	if (failures > 0) {
		console.error(`[smoke] ${failures} check(s) failed`);
		process.exit(1);
	}
	console.log(`[smoke] all good — search InsForge for run_id=${runId} to confirm visually`);
}

main().catch((err) => {
	console.error("[smoke] unhandled error:", err);
	process.exit(2);
});
