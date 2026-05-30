#!/usr/bin/env tsx
/**
 * [WHO]: Provides smokeExtTelemetryCli() — maintainer-invoked smoke test for the P0-P3 extension telemetry pipeline; queries ext_command_events / ext_llm_calls / ext_hook_events and reports whether rows landed
 * [FROM]: Depends on core/platform/telemetry (loadInsforgeCredentials), node:https / node:http / node:url / node:os; no MCP, no pencil runtime
 * [TO]: Invoked manually by maintainers after exercising a pencil session, e.g. `npx tsx scripts/smoke-ext-telemetry.ts --since=5m`; documented in .dev-docs/self-awareness/extension-telemetry.md
 * [HERE]: scripts/smoke-ext-telemetry.ts - read-only verifier; does not write to the backend, does not spawn pencil, does not auto-load into user sessions
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import { URL } from "node:url";
import { loadInsforgeCredentials } from "../core/platform/telemetry/index.js";

interface SmokeArgs {
	sinceMinutes: number;
	sessionId?: string;
	endpointOverride?: string;
}

interface CommandRow {
	extension_name?: string;
	command_name?: string;
	args_signature?: string;
	outcome?: string;
	duration_ms?: number;
	error_code?: string | null;
	started_at?: string;
	session_id?: string | null;
}

interface LlmRow {
	extension_name?: string;
	caller_context?: string;
	is_user_initiated?: boolean;
	model_id?: string | null;
	tokens_in?: number | null;
	tokens_out?: number | null;
	cost_total?: number | null;
	duration_ms?: number;
	ok?: boolean;
	started_at?: string;
}

interface HookRow {
	extension_name?: string;
	hook_name?: string;
	duration_ms?: number;
	ok?: boolean;
	sample_rate?: number;
	recorded_at?: string;
}

function parseArgs(argv: string[]): SmokeArgs {
	const args: SmokeArgs = { sinceMinutes: 5 };
	for (const arg of argv) {
		if (arg.startsWith("--since=")) {
			const value = arg.slice("--since=".length);
			const m = value.match(/^(\d+)(m|h|d|min|hr|hour|day)?$/i);
			if (m) {
				const n = parseInt(m[1], 10);
				const unit = (m[2] ?? "m").toLowerCase();
				if (unit === "d" || unit === "day") args.sinceMinutes = n * 60 * 24;
				else if (unit === "h" || unit === "hr" || unit === "hour") args.sinceMinutes = n * 60;
				else args.sinceMinutes = n;
			}
		} else if (arg.startsWith("--session=")) {
			args.sessionId = arg.slice("--session=".length);
		} else if (arg.startsWith("--endpoint=")) {
			args.endpointOverride = arg.slice("--endpoint=".length);
		} else if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
	}
	return args;
}

function printHelp(): void {
	process.stdout.write(
		[
			"smoke-ext-telemetry — verify P0-P3 extension telemetry pipeline",
			"",
			"Usage:",
			"  npx tsx scripts/smoke-ext-telemetry.ts [--since=5m] [--session=<id>] [--endpoint=<url>]",
			"",
			"Flags:",
			"  --since=<duration>   Time window. e.g. 5m, 30m, 2h. Default: 5m.",
			"  --session=<id>       Filter to a specific session_id.",
			"  --endpoint=<url>     Override insforge endpoint (credentials.json otherwise).",
			"",
			"Behaviour:",
			"  Reads ~/.memory-experiments/credentials.json (or workspace fallback).",
			"  Queries ext_command_events / ext_llm_calls / ext_hook_events for rows in the window.",
			"  Prints counts + top 5 samples + flags any is_user_initiated=false LLM calls.",
			"  Read-only: does not insert, does not spawn pencil, does not write to user state.",
			"",
		].join("\n"),
	);
}

async function httpGet<T>(url: string, headers: Record<string, string>): Promise<T> {
	return new Promise((resolve, reject) => {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch (err) {
			reject(new Error(`Invalid URL: ${url}`));
			return;
		}
		const requestFn = parsed.protocol === "https:" ? httpsRequest : httpRequest;
		const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
		const req = requestFn(
			{
				hostname: parsed.hostname,
				port,
				path: parsed.pathname + parsed.search,
				method: "GET",
				headers,
				timeout: 10_000,
			},
			(res) => {
				let body = "";
				res.setEncoding("utf-8");
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => {
					if (res.statusCode === undefined || res.statusCode >= 300) {
						reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
						return;
					}
					try {
						resolve(JSON.parse(body) as T);
					} catch (err) {
						reject(new Error(`Failed to parse JSON: ${(err as Error).message}`));
					}
				});
			},
		);
		req.on("error", reject);
		req.on("timeout", () => {
			req.destroy();
			reject(new Error(`Request timed out after 10s: ${url}`));
		});
		req.end();
	});
}

function fmtRow(row: Record<string, unknown>, columns: Array<{ key: string; width: number }>): string {
	return columns
		.map(({ key, width }) => {
			const raw = row[key];
			const str = raw === undefined || raw === null ? "—" : String(raw);
			return str.length > width ? str.slice(0, width - 1) + "…" : str.padEnd(width);
		})
		.join("  ");
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	const workspaceRoot = process.cwd();
	const creds = loadInsforgeCredentials(workspaceRoot, "smoke-ext-telemetry");
	const endpoint = args.endpointOverride ?? creds?.endpoint ?? creds?.insforge_url;

	if (!endpoint) {
		process.stderr.write(
			[
				"No insforge endpoint configured. Looked in:",
				`  ${workspaceRoot}/.memory-experiments/credentials.json`,
				`  ${homedir()}/.memory-experiments/credentials.json`,
				"",
				"Without credentials, the telemetry sink is noop and there is nothing to query.",
				"If you have an endpoint, pass --endpoint=<url>.",
				"",
			].join("\n"),
		);
		return 2;
	}
	if (!creds?.api_key && !args.endpointOverride) {
		process.stderr.write("Credentials file has no api_key. Telemetry sink would be noop.\n");
		return 2;
	}

	const base = endpoint.replace(/\/+$/, "");
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	const tokenForAuth = creds?.anon_key ?? creds?.api_key;
	if (tokenForAuth) {
		headers.apikey = tokenForAuth;
		headers.Authorization = `Bearer ${tokenForAuth}`;
	}
	if (creds?.api_key) {
		headers[creds.api_key_header ?? "x-api-key"] = creds.api_key;
	}

	const sinceIso = new Date(Date.now() - args.sinceMinutes * 60_000).toISOString();
	const sessionFilter = args.sessionId ? `&session_id=eq.${encodeURIComponent(args.sessionId)}` : "";

	process.stdout.write(`endpoint:   ${new URL(base).hostname}\n`);
	process.stdout.write(`window:     since ${sinceIso}  (last ${args.sinceMinutes}m)\n`);
	if (args.sessionId) process.stdout.write(`session_id: ${args.sessionId}\n`);
	process.stdout.write("\n");

	let exitCode = 0;
	try {
		const commands = await httpGet<CommandRow[]>(
			`${base}/api/database/records/ext_command_events?started_at=gte.${sinceIso}${sessionFilter}&order=started_at.desc&limit=100`,
			headers,
		);
		process.stdout.write(`── ext_command_events ── ${commands.length} rows\n`);
		if (commands.length === 0) {
			process.stdout.write("  (no rows; the sink may be noop, or your window is too short, or the 2s batch hasn't flushed yet)\n");
		} else {
			const cols = [
				{ key: "extension_name", width: 18 },
				{ key: "command_name", width: 18 },
				{ key: "args_signature", width: 14 },
				{ key: "outcome", width: 10 },
				{ key: "duration_ms", width: 8 },
			];
			process.stdout.write(`  ${fmtRow(Object.fromEntries(cols.map((c) => [c.key, c.key])), cols)}\n`);
			for (const row of commands.slice(0, 5)) {
				process.stdout.write(`  ${fmtRow(row as Record<string, unknown>, cols)}\n`);
			}
			if (commands.length > 5) process.stdout.write(`  … ${commands.length - 5} more\n`);
		}
		process.stdout.write("\n");

		const llmCalls = await httpGet<LlmRow[]>(
			`${base}/api/database/records/ext_llm_calls?started_at=gte.${sinceIso}${sessionFilter}&order=started_at.desc&limit=100`,
			headers,
		);
		const autoFiredCalls = llmCalls.filter((r) => r.is_user_initiated === false);
		process.stdout.write(`── ext_llm_calls ── ${llmCalls.length} rows  (${autoFiredCalls.length} auto-fired = is_user_initiated=false)\n`);
		if (llmCalls.length === 0) {
			process.stdout.write("  (no LLM calls; expected if you didn't run /recap --smart, /btw, or anything else that calls completeSimple)\n");
		} else {
			const cols = [
				{ key: "extension_name", width: 14 },
				{ key: "caller_context", width: 30 },
				{ key: "is_user_initiated", width: 5 },
				{ key: "tokens_in", width: 8 },
				{ key: "tokens_out", width: 8 },
				{ key: "duration_ms", width: 8 },
			];
			process.stdout.write(`  ${fmtRow(Object.fromEntries(cols.map((c) => [c.key, c.key])), cols)}\n`);
			for (const row of llmCalls.slice(0, 5)) {
				process.stdout.write(`  ${fmtRow(row as Record<string, unknown>, cols)}\n`);
			}
			if (llmCalls.length > 5) process.stdout.write(`  … ${llmCalls.length - 5} more\n`);
			if (autoFiredCalls.length > 0) {
				process.stdout.write("\n  ⚠ Idle-thinking probe: auto-fired LLM calls detected.\n");
				for (const row of autoFiredCalls.slice(0, 5)) {
					const ext = row.extension_name ?? "unknown";
					const caller = row.caller_context ?? "unknown";
					const tokens = (row.tokens_in ?? 0) + (row.tokens_out ?? 0);
					process.stdout.write(`    ${ext} via ${caller} → ${tokens} tokens\n`);
				}
				if (autoFiredCalls.length > 0) exitCode = 1;
			}
		}
		process.stdout.write("\n");

		const hooks = await httpGet<HookRow[]>(
			`${base}/api/database/records/ext_hook_events?recorded_at=gte.${sinceIso}${sessionFilter}&order=recorded_at.desc&limit=200`,
			headers,
		);
		const hookErrors = hooks.filter((r) => r.ok === false);
		process.stdout.write(`── ext_hook_events ── ${hooks.length} sampled rows  (${hookErrors.length} errors)\n`);
		if (hooks.length === 0) {
			process.stdout.write("  (no hook events; this is the strongest signal that the sink is noop or pencil never ran)\n");
		} else {
			const grouped = new Map<string, { count: number; errors: number; totalMs: number; sampleRate: number }>();
			for (const r of hooks) {
				const key = `${r.extension_name ?? "?"} · ${r.hook_name ?? "?"}`;
				const entry = grouped.get(key) ?? { count: 0, errors: 0, totalMs: 0, sampleRate: r.sample_rate ?? 1 };
				entry.count += 1;
				entry.totalMs += r.duration_ms ?? 0;
				if (r.ok === false) entry.errors += 1;
				entry.sampleRate = r.sample_rate ?? entry.sampleRate;
				grouped.set(key, entry);
			}
			const sorted = [...grouped.entries()].sort((a, b) => b[1].count - a[1].count);
			process.stdout.write("  extension · hook                          count  est_real  avg_ms  errors\n");
			for (const [key, stats] of sorted.slice(0, 10)) {
				const estReal = stats.sampleRate > 0 ? Math.round(stats.count / stats.sampleRate) : stats.count;
				const avgMs = Math.round(stats.totalMs / stats.count);
				process.stdout.write(
					`  ${key.padEnd(42)}  ${String(stats.count).padStart(5)}  ${String(estReal).padStart(8)}  ${String(avgMs).padStart(6)}  ${String(stats.errors).padStart(6)}\n`,
				);
			}
			if (sorted.length > 10) process.stdout.write(`  … ${sorted.length - 10} more (extension, hook) combos\n`);
		}
		process.stdout.write("\n");

		// Verdict
		const hasAnyData = commands.length + llmCalls.length + hooks.length > 0;
		if (!hasAnyData) {
			process.stdout.write("verdict:    NO DATA in window. Pipeline may be noop, or you haven't exercised pencil yet.\n");
			exitCode = 1;
		} else if (autoFiredCalls.length > 0) {
			process.stdout.write("verdict:    DATA PRESENT, but idle-thinking probe triggered — see auto-fired LLM calls above.\n");
		} else {
			process.stdout.write("verdict:    DATA PRESENT, no auto-fired LLM calls. Pipeline healthy.\n");
		}
	} catch (err) {
		process.stderr.write(`query failed: ${(err as Error).message}\n`);
		return 3;
	}
	return exitCode;
}

main().then((code) => process.exit(code));
