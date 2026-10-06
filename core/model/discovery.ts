/**
 * [WHO]: discoverModels(), discoverOpenAIModels(), inspectOpenAIModels(), normalizeOpenAIBaseUrl(), discovery types
 * [FROM]: Depends on platform URL, fetch and AbortController APIs
 * [TO]: Consumed by core/model-registry.ts, core/model/discovery-cache.ts and interactive provider setup
 * [HERE]: core/model/discovery.ts - remote model discovery engine
 *
 * Fetches model lists from provider /models endpoints (OpenAI-compatible protocol).
 * All failures are graceful — returns empty results instead of throwing.
 */

/**
 * A model discovered from a remote /models endpoint.
 */
export interface DiscoveredModel {
	/** Model identifier (same format as used in API requests). */
	id: string;
	/** Human-readable display name, if provided by the endpoint. */
	name?: string;
	/** Organization or entity that owns the model. */
	ownedBy?: string;
	/** Deployment limits, only when explicitly returned by the server. */
	contextWindow?: number;
	maxTokens?: number;
}

export interface OpenAIModelInspection {
	models: DiscoveredModel[];
	status?: number;
	error?: string;
}

/** Accept a server origin or an explicit OpenAI API prefix/completion URL. */
export function normalizeOpenAIBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error("Enter a valid HTTP or HTTPS server URL.");
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error("Use an HTTP or HTTPS URL without credentials, query parameters or fragments.");
	}
	let path = url.pathname.replace(/\/+$/, "");
	path = path.replace(/\/(?:chat\/completions|responses|models)$/, "");
	url.pathname = path || "/v1";
	return url.toString().replace(/\/+$/, "");
}

function positiveLimit(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Result of a discovery operation for a single provider.
 */
export interface DiscoveryResult {
	/** Provider name this result belongs to. */
	provider: string;
	/** Discovered models (may be empty on failure or unsupported protocol). */
	models: DiscoveredModel[];
	/** Epoch milliseconds when this result was fetched. */
	fetchedAt: number;
	/** Cache time-to-live in seconds. */
	ttl: number;
	/** Non-fatal error message (e.g., "unsupported protocol" or network error details). */
	error?: string;
}

/**
 * Discovery protocol supported by a provider's API type.
 * - "openai-models": GET {baseUrl}/models (OpenAI-compatible standard)
 * - "unsupported": API type does not expose a model listing endpoint
 */
export type DiscoveryProtocol = "openai-models" | "unsupported";

/** Default cache TTL: 24 hours. */
export const DEFAULT_DISCOVERY_TTL_SECONDS = 86400;

/** Default fetch timeout: 5 seconds. */
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 5000;

/**
 * Determine which discovery protocol a provider supports based on its API type.
 *
 * OpenAI-compatible APIs (completions, responses) implement the standard
 * `GET /v1/models` endpoint. Anthropic Messages API does not expose one.
 */
export function getDiscoveryProtocol(api: string): DiscoveryProtocol {
	switch (api) {
		case "openai-completions":
		case "openai-responses":
		case "openai-codex-responses":
		case "azure-openai-responses":
			return "openai-models";
		default:
			return "unsupported";
	}
}

/**
 * Fetch model list from an OpenAI-compatible /models endpoint.
 *
 * Expects response format: `{ data: [{ id: string, name?: string, owned_by?: string }, ...] }`
 *
 * Returns empty array on any failure:
 * - Network errors / timeouts
 * - Non-200 HTTP responses (401, 403, 500, etc.)
 * - Malformed response bodies
 *
 * @param baseUrl  Provider base URL (trailing slashes are stripped)
 * @param apiKey   Optional API key for Authorization header
 * @param options  Optional timeout and abort signal
 */
export async function discoverOpenAIModels(
	baseUrl: string,
	apiKey: string | undefined,
	options?: {
		timeoutMs?: number;
		signal?: AbortSignal;
	},
): Promise<DiscoveredModel[]> {
	return (await inspectOpenAIModels(baseUrl, apiKey, options)).models;
}

/** Discovery with HTTP/error details for interactive setup; never throws. */
export async function inspectOpenAIModels(
	baseUrl: string,
	apiKey?: string,
	options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<OpenAIModelInspection> {
	const timeout = options?.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
	const url = `${baseUrl.replace(/\/+$/, "")}/models`;

	const headers: Record<string, string> = {};
	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	const signal = options?.signal
		? combineAbortSignals(options.signal, controller.signal)
		: controller.signal;

	try {
		const res = await fetch(url, { headers, signal });

		if (!res.ok) {
			return { models: [], status: res.status, error: `Model discovery returned HTTP ${res.status}.` };
		}

		const data = (await res.json()) as { data?: unknown };
		if (!Array.isArray(data?.data)) {
			return { models: [], status: res.status, error: "The server did not return an OpenAI model list." };
		}
		const items = data.data;

		const models = items
			.filter((m: unknown) => m != null && typeof m === "object" && typeof (m as Record<string, unknown>).id === "string" && String((m as Record<string, unknown>).id).trim())
			.map((m: Record<string, unknown>) => {
				const top = m.top_provider as Record<string, unknown> | undefined;
				const contextWindow = positiveLimit(m.context_length) ?? positiveLimit(m.max_context_length)
					?? positiveLimit(m.max_model_len) ?? positiveLimit(top?.context_length);
				const maxTokens = positiveLimit(m.max_output_tokens) ?? positiveLimit(m.max_tokens)
					?? positiveLimit(top?.max_completion_tokens);
				return {
					id: m.id as string,
					name: typeof m.name === "string" ? m.name : undefined,
					ownedBy: typeof m.owned_by === "string" ? m.owned_by : undefined,
					...(contextWindow !== undefined ? { contextWindow } : {}),
					...(maxTokens !== undefined ? { maxTokens } : {}),
				};
			});
		return { models, status: res.status };
	} catch (error) {
		return { models: [], error: controller.signal.aborted ? "Model discovery timed out." :
			`Model discovery failed: ${error instanceof Error ? error.message : String(error)}` };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Top-level discover function: routes to the correct protocol handler.
 *
 * Returns a DiscoveryResult with metadata (timestamps, TTL, error info).
 * Never throws — all errors are captured in the result.
 */
export async function discoverModels(
	providerName: string,
	baseUrl: string,
	api: string,
	apiKey: string | undefined,
	options?: { timeoutMs?: number },
): Promise<DiscoveryResult> {
	const protocol = getDiscoveryProtocol(api);
	const now = Date.now();

	if (protocol === "unsupported") {
		return {
			provider: providerName,
			models: [],
			fetchedAt: now,
			ttl: 0,
			error: `Discovery not supported for API type "${api}"`,
		};
	}

	try {
		const models = await discoverOpenAIModels(baseUrl, apiKey, options);
		return {
			provider: providerName,
			models,
			fetchedAt: now,
			ttl: DEFAULT_DISCOVERY_TTL_SECONDS,
		};
	} catch (error) {
		return {
			provider: providerName,
			models: [],
			fetchedAt: now,
			ttl: DEFAULT_DISCOVERY_TTL_SECONDS,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Combine two AbortSignals into one that aborts when either fires.
 */
function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if (a.aborted || b.aborted) {
		controller.abort();
		return controller.signal;
	}
	a.addEventListener("abort", onAbort, { once: true });
	b.addEventListener("abort", onAbort, { once: true });
	return controller.signal;
}
