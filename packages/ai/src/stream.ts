/**
 * [WHO]: getEnvApiKey, stream, streamSimple, RetryOptions
 * [FROM]: Depends on ./api-registry.js
 * [TO]: Consumed by packages/ai/src/index.ts
 * [HERE]: packages/ai/src/stream.ts -
 */

import "./providers/register-builtins.js";
import "./utils/http-proxy.js";

import { getApiProvider } from "./api-registry.js";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	ProviderStreamOptions,
	SimpleStreamOptions,
	StreamOptions,
	Usage,
} from "./types.js";
import { AssistantMessageEventStream } from "./utils/event-stream.js";
import { isContextOverflow } from "./utils/overflow.js";

export { getEnvApiKey } from "./env-api-keys.js";

// =============================================================================
// Retry Configuration
// =============================================================================

export interface RetryOptions {
	/** Maximum number of retry attempts (default: 3) */
	maxRetries?: number;
	/** Base delay in ms for exponential backoff (default: 1000) */
	baseDelayMs?: number;
	/** Maximum delay cap in ms (default: 30000) */
	maxDelayMs?: number;
	/** Whether to add jitter to avoid thundering herd (default: true) */
	jitter?: boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 30000,
	jitter: true,
};

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/** Status codes and patterns that indicate a retriable error */
const RETRIABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRIABLE_ERROR_PATTERNS = [
	/ECONNRESET/i,
	/ETIMEDOUT/i,
	/ECONNREFUSED/i,
	/socket hang up/i,
	/fetch failed/i,
	/network/i,
	/aborted/i,
];

/**
 * Check if an assistant message error is retriable.
 * Context overflow errors are NOT retriable — they need compaction.
 */
function isRetriableStreamError(message: AssistantMessage): boolean {
	if (message.stopReason !== "error" || !message.errorMessage) return false;

	// Context overflow is never retriable
	if (isContextOverflow(message)) return false;

	const errMsg = message.errorMessage;

	// Check for retriable status codes embedded in error messages
	const statusMatch = errMsg.match(/^([45]\d\d)\b/);
	if (statusMatch) {
		const statusCode = parseInt(statusMatch[1], 10);
		return RETRIABLE_STATUS_CODES.has(statusCode);
	}

	// Check for retriable error patterns
	return RETRIABLE_ERROR_PATTERNS.some((p) => p.test(errMsg));
}

/**
 * Calculate delay for retry attempt with exponential backoff + optional jitter.
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
	const exponentialDelay = options.baseDelayMs * Math.pow(2, attempt);
	const cappedDelay = Math.min(exponentialDelay, options.maxDelayMs);

	if (options.jitter) {
		// Full jitter: random between 0 and capped delay
		return Math.floor(Math.random() * cappedDelay);
	}
	return cappedDelay;
}

/**
 * Extract retry-after delay from a 429 error message, or return undefined.
 */
function extractRetryAfterMs(errorMessage: string): number | undefined {
	// Standard Retry-After header value
	const match = errorMessage.match(/retry[_-]after[:\s]+(\d+)/i);
	if (match) {
		return parseInt(match[1], 10) * 1000;
	}
	return undefined;
}

function getRetryDelayMs(
	message: AssistantMessage,
	attempt: number,
	retryOptions: Required<RetryOptions>,
): number | undefined {
	if (attempt >= retryOptions.maxRetries || !isRetriableStreamError(message)) {
		return undefined;
	}
	if (/^429\b/.test(message.errorMessage ?? "")) {
		return extractRetryAfterMs(message.errorMessage ?? "") ?? calculateDelay(attempt, retryOptions);
	}
	return calculateDelay(attempt, retryOptions);
}

// =============================================================================
// Provider Resolution
// =============================================================================

function resolveApiProvider(api: Api) {
	const provider = getApiProvider(api);
	if (!provider) {
		throw new Error(`No API provider registered for api: ${api}`);
	}
	return provider;
}

// =============================================================================
// Streaming with Retry
// =============================================================================

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);
	const retryOptions: Required<RetryOptions> = {
		...DEFAULT_RETRY_OPTIONS,
		...options?.retry,
	};
	return wrapWithRetry(
		model,
		() => provider.stream(model, context, options as StreamOptions),
		retryOptions,
		options?.signal,
	);
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): Promise<AssistantMessage> {
	const s = stream(model, context, options);
	return s.result();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);
	const retryOptions: Required<RetryOptions> = {
		...DEFAULT_RETRY_OPTIONS,
		...options?.retry,
	};
	return wrapWithRetry(
		model,
		() => provider.streamSimple(model, context, options),
		retryOptions,
		options?.signal,
	);
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const s = streamSimple(model, context, options);
	return s.result();
}

// =============================================================================
// Retry Wrapper
// =============================================================================

/**
 * Wraps a stream factory with automatic retry on retriable errors.
 * On retriable failure, creates a new stream and replays it transparently.
 */
function wrapWithRetry<TApi extends Api>(
	model: Pick<Model<TApi>, "api" | "provider" | "id">,
	createStream: () => AssistantMessageEventStream,
	retryOptions: Required<RetryOptions>,
	signal?: AbortSignal,
): AssistantMessageEventStream {
	const outerStream = new AssistantMessageEventStream();

	(async () => {
		let attempt = 0;

		while (attempt <= retryOptions.maxRetries) {
			if (signal?.aborted) {
				const errorMessage: AssistantMessage = {
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					stopReason: "error",
					errorMessage: "Request was aborted",
					usage: emptyUsage(),
					timestamp: Date.now(),
				};
				outerStream.push({ type: "error", reason: "error", error: errorMessage });
				return;
			}

			const innerStream = createStream();

			// Forward all events from inner to outer, but intercept the final result
			let lastMessage: AssistantMessage | null = null;

			for await (const event of innerStream) {
				if (event.type === "done") {
					lastMessage = event.message;
					outerStream.push(event);
					break;
				} else if (event.type === "error") {
					lastMessage = event.error;

					// Check if retriable
					const delayMs = getRetryDelayMs(lastMessage, attempt, retryOptions);
					if (delayMs !== undefined) {
						attempt++;
						await new Promise((resolve) => setTimeout(resolve, delayMs));
						break; // Break inner loop, retry outer loop
					}

					// Non-retriable or max retries exhausted — forward error
					outerStream.push(event);
					return;
				} else {
					// Forward all intermediate events on first attempt only
					// On retries, we don't replay partial events to avoid duplicates
					if (attempt === 0) {
						outerStream.push(event);
					}
				}
			}

			if (!lastMessage) {
				lastMessage = await innerStream.result();
				const delayMs = getRetryDelayMs(lastMessage, attempt, retryOptions);
				if (delayMs !== undefined) {
					attempt++;
					await new Promise((resolve) => setTimeout(resolve, delayMs));
					continue;
				}
				if (lastMessage.stopReason === "error" || lastMessage.stopReason === "aborted") {
					outerStream.push({ type: "error", reason: lastMessage.stopReason, error: lastMessage });
					return;
				}
				outerStream.push({ type: "done", reason: lastMessage.stopReason, message: lastMessage });
				return;
			}

			// If we got a done event, we're finished
			if (lastMessage && lastMessage.stopReason !== "error") {
				return;
			}
		}
	})();

	return outerStream;
}
