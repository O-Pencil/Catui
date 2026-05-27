/**
 * [WHO]: Provides InsforgeHttpClient class + parsePostgrestErrorCode/safeHost helpers — generic insforge PostgREST transport
 * [FROM]: Depends on node:http (httpRequest), node:https (request), node:url (URL); ./types for DiagnosticHandler / InsforgeHttpResult / PostJsonOptions
 * [TO]: Consumed by extensions/defaults/sal/eval/insforge-sink.ts (SAL-specific routing); future extensions/<ext>/telemetry sinks reuse the same client
 * [HERE]: core/telemetry/insforge-base.ts - factored out of SAL's eval/insforge-sink.ts; HTTP/transport-only, no event semantics, no batching (those live in batching-dispatcher.ts)
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { isDevRuntime } from "../../utils/diagnostics.js";
import type { DiagnosticHandler, InsforgeHttpResult, PostJsonOptions } from "./types.js";

export interface InsforgeHttpClientOptions {
	endpoint: string;
	apiKey?: string;
	anonKey?: string;
	apiKeyHeader?: string;
	extraHeaders?: Record<string, string>;
	allowSelfSigned?: boolean;
	timeoutMs?: number;
	/** Used as diagnostic source + fingerprint scope. e.g. "sal.eval", "ext.telemetry". */
	source: string;
	onDiagnostic?: DiagnosticHandler;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Thin PostgREST HTTP client. Strictly transport: no routing, no batching, no
 * upsert semantics — those belong to the consumer (e.g. SAL's InsForgeEvalSink).
 *
 * Sinks construct one of these per options.endpoint, then call postJson /
 * patchJson with the full record URL. Diagnostics emit through
 * options.onDiagnostic with `source:category:fingerprint` keying so multiple
 * sinks can share an emit channel without collisions.
 */
export class InsforgeHttpClient {
	readonly base: string;
	private headers: Record<string, string>;
	private allowSelfSigned: boolean;
	private timeoutMs: number;
	private source: string;
	private onDiagnostic?: DiagnosticHandler;

	constructor(options: InsforgeHttpClientOptions) {
		this.base = options.endpoint.replace(/\/+$/, "");
		this.allowSelfSigned = options.allowSelfSigned ?? false;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.source = options.source;
		this.onDiagnostic = options.onDiagnostic;

		if (this.allowSelfSigned && isDevRuntime()) {
			console.warn(`[${this.source}] TLS certificate verification disabled (allowSelfSigned=true)`);
		}

		const h: Record<string, string> = {
			"Content-Type": "application/json",
			...(options.extraHeaders ?? {}),
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

	postJson(url: string, body: unknown, extra?: PostJsonOptions): Promise<InsforgeHttpResult> {
		const extraHeaders: Record<string, string> = {};
		if (extra?.prefer) extraHeaders["Prefer"] = extra.prefer;
		return this.httpJson("POST", url, body, extraHeaders, extra?.quietErrorCodes);
	}

	patchJson(url: string, body: unknown): Promise<InsforgeHttpResult> {
		return this.httpJson("PATCH", url, body, {});
	}

	private httpJson(
		method: string,
		url: string,
		body: unknown,
		extraHeaders: Record<string, string>,
		quietErrorCodes: string[] = [],
	): Promise<InsforgeHttpResult> {
		return new Promise((resolve) => {
			const payload = JSON.stringify(body);
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				this.reportDiagnostic("config", "Insforge endpoint URL is invalid.", { url }, "invalid-url");
				resolve({ ok: false });
				return;
			}
			const isHttps = parsed.protocol === "https:";
			const requestFn = isHttps ? httpsRequest : httpRequest;
			const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;
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
					timeout: this.timeoutMs,
					...(isHttps && this.allowSelfSigned ? { rejectUnauthorized: false } : {}),
				},
				(res) => {
					let rawBody = "";
					res.setEncoding("utf-8");
					res.on("data", (chunk) => {
						rawBody += chunk;
					});
					res.on("end", () => {
						const ok = res.statusCode !== undefined && res.statusCode < 300;
						const errorCode = parsePostgrestErrorCode(rawBody);
						if (!ok && !quietErrorCodes.includes(errorCode ?? "")) {
							this.reportDiagnostic(
								errorCode === "PGRST204" ? "schema" : "network",
								`Insforge upload failed with HTTP ${res.statusCode}.`,
								{
									method,
									path: parsed.pathname,
									statusCode: res.statusCode,
									body: rawBody.slice(0, 300),
									errorCode,
								},
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
					"Insforge upload is failing due to a network connection error.",
					{ host: parsed.hostname, error: err.message },
					"network-error",
				);
				if (isDevRuntime()) {
					console.error(`[${this.source}] network error → ${parsed.hostname}: ${err.message}`);
				}
				resolve({ ok: false });
			});
			req.on("timeout", () => {
				this.reportDiagnostic(
					"network",
					"Insforge upload timed out.",
					{ method, path: parsed.pathname, host: parsed.hostname },
					"timeout",
				);
				if (isDevRuntime()) {
					console.error(`[${this.source}] timeout ${method} ${parsed.pathname}`);
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
			source: this.source,
			severity: category === "config" ? "warning" : "error",
			category,
			message,
			detail,
			fingerprint: `${this.source}:${category}:${fingerprintSuffix}`,
			context: {
				adapter: "insforge",
				endpoint_host: safeHost(this.base),
			},
		});
	}
}

export function parsePostgrestErrorCode(rawBody: string): string | undefined {
	try {
		const parsed = JSON.parse(rawBody);
		return typeof parsed?.code === "string" ? parsed.code : undefined;
	} catch {
		return undefined;
	}
}

export function safeHost(value: string): string | undefined {
	try {
		return new URL(value).hostname;
	} catch {
		return undefined;
	}
}
