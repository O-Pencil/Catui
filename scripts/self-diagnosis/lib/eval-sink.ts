/**
 * [WHO]: Provides writeSelfDiagnosisMetric() — one-shot POST to InsForge eval_metric_results; VARIANT constant for callers that need to assert the run originated from this script
 * [FROM]: Depends on node:fs / node:path / node:os / node:http / node:https / node:url via dynamic import (kept lazy to avoid pre-bundle cost for non-runtime callers)
 * [TO]: Consumed by ../run.ts after a reflexive task completes; never imported from extensions/ or core/
 * [HERE]: scripts/self-diagnosis/lib/eval-sink.ts — isolated write path. Variant tagging on eval_runs is done at run_start by the SAL extension via NANOPENCIL_EVAL_VARIANT env var (extensions/defaults/sal/index.ts:755 accepts "self-diagnosis" after the 2026-05-18 whitelist extension), so this module no longer needs a post-exit PATCH; it only writes the metric row.
 */

import type { IncomingMessage } from "node:http";

export const VARIANT = "self-diagnosis" as const;

export interface MetricRow {
	runId: string;
	metricName: string;
	metricCategory: "self-trace" | "memory-recall" | "diagnostic-synthesis" | "tool-economy";
	score: number;
	scoreNormalized?: number;
	details: Record<string, unknown>;
	computedAt: string; // ISO timestamp
	computationMethod: string; // e.g. "archetype-A v1"
}

interface LoadedCredentials {
	endpoint?: string;
	apiKey?: string;
	anonKey?: string;
}

interface PostResult {
	ok: boolean;
	statusCode?: number;
	body?: string;
}

/**
 * Write one eval_metric_results row to InsForge.
 *
 * `eval_metric_results` has no `variant` column — the variant tag lives on the
 * parent `eval_runs.run_id`, written by SAL at run_start (NANOPENCIL_EVAL_VARIANT).
 * If the POST fails, the row is dumped to `scripts/self-diagnosis/runs/<date>/metric-pending-<ts>.json`
 * so the analysis isn't lost.
 */
export async function writeSelfDiagnosisMetric(row: MetricRow): Promise<{ ok: boolean; reason?: string }> {
	try {
		const credentials = await loadCredentials();
		if (!credentials.endpoint) {
			return { ok: false, reason: "No InsForge endpoint configured" };
		}

		const body = JSON.stringify(serializeRow(row));
		const url = `${credentials.endpoint}/api/database/records/eval_metric_results`;
		const response = await postJson(url, body, credentials);

		if (!response.ok) {
			await writeFallback(body);
			return { ok: false, reason: `HTTP ${response.statusCode}: ${response.body}` };
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, reason: (err as Error).message };
	}
}

function serializeRow(row: MetricRow): Record<string, unknown> {
	return {
		run_id: row.runId,
		metric_name: row.metricName,
		metric_category: row.metricCategory,
		score: row.score,
		score_normalized: row.scoreNormalized,
		details: row.details,
		computed_at: row.computedAt,
		computation_method: row.computationMethod,
	};
}

async function writeFallback(body: string): Promise<void> {
	const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const date = new Date().toISOString().split("T")[0];
	const fallbackDir = join("scripts", "self-diagnosis", "runs", date);
	if (!existsSync(fallbackDir)) {
		mkdirSync(fallbackDir, { recursive: true });
	}
	writeFileSync(join(fallbackDir, `metric-pending-${Date.now()}.json`), body, "utf-8");
}

async function loadCredentials(): Promise<LoadedCredentials> {
	const { homedir } = await import("node:os");
	const { join } = await import("node:path");
	const { existsSync, readFileSync } = await import("node:fs");

	const candidates = [
		process.env.NANOPENCIL_EVAL_CREDENTIALS_FILE,
		join(process.cwd(), ".memory-experiments", "credentials.json"),
		join(homedir(), ".memory-experiments", "credentials.json"),
	].filter(Boolean) as string[];

	for (const path of candidates) {
		if (existsSync(path)) {
			try {
				const raw = readFileSync(path, "utf-8");
				const parsed = JSON.parse(raw);
				return {
					endpoint: process.env.NANOPENCIL_EVAL_ENDPOINT ?? parsed.endpoint ?? parsed.insforge_url,
					apiKey: process.env.NANOPENCIL_EVAL_API_KEY ?? parsed.api_key ?? parsed.apiKey,
					anonKey: process.env.NANOPENCIL_EVAL_ANON_KEY ?? parsed.anon_key,
				};
			} catch {
				continue;
			}
		}
	}
	return {
		endpoint: process.env.NANOPENCIL_EVAL_ENDPOINT,
		apiKey: process.env.NANOPENCIL_EVAL_API_KEY,
		anonKey: process.env.NANOPENCIL_EVAL_ANON_KEY,
	};
}

async function postJson(url: string, body: string, creds: LoadedCredentials): Promise<PostResult> {
	const { request: httpsRequest } = await import("node:https");
	const { request: httpRequest } = await import("node:http");
	const { URL } = await import("node:url");

	const parsed = new URL(url);
	const isHttps = parsed.protocol === "https:";
	const reqFn = isHttps ? httpsRequest : httpRequest;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"Content-Length": String(Buffer.byteLength(body)),
	};
	if (creds.anonKey) {
		headers["apikey"] = creds.anonKey;
		headers["Authorization"] = `Bearer ${creds.anonKey}`;
	}
	if (creds.apiKey) {
		headers["x-api-key"] = creds.apiKey;
		if (!creds.anonKey) {
			headers["Authorization"] = `Bearer ${creds.apiKey}`;
		}
	}

	return new Promise<PostResult>((resolve) => {
		let settled = false;
		const settle = (r: PostResult) => {
			if (settled) return;
			settled = true;
			resolve(r);
		};

		const req = reqFn(
			{
				hostname: parsed.hostname,
				port: parsed.port || (isHttps ? 443 : 80),
				path: parsed.pathname + parsed.search,
				method: "POST",
				headers,
				timeout: 10000,
			},
			(res: IncomingMessage) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					settle({
						ok: !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
						statusCode: res.statusCode,
						body: data,
					});
				});
			},
		);
		req.on("timeout", () => {
			req.destroy();
			settle({ ok: false, body: "request timed out after 10s" });
		});
		req.on("error", (err) => settle({ ok: false, body: err.message }));
		req.write(body);
		req.end();
	});
}
