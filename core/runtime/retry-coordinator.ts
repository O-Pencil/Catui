/**
 * [WHO]: RetryCoordinator class, auto-retry with exponential backoff, in-loop retry preparation
 * [FROM]: Depends on agent-core (AssistantMessage), ai (isContextOverflow), core/runtime/utils/sleep
 * [TO]: Consumed by core/runtime/agent-session.ts
 * [HERE]: core/runtime/retry-coordinator.ts - retry orchestration extracted from AgentSession
 */
import type { AssistantMessage } from "@pencil-agent/ai/types";
import { isContextOverflow } from "@pencil-agent/ai/overflow";
import { sleep } from "../platform/utils/sleep.js";

/** Retry settings from SettingsManager */
export interface RetrySettings {
	enabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
}

/** Callbacks the coordinator needs from its host */
export interface RetryCoordinatorHost {
	/** Get current model's context window (for overflow detection) */
	getContextWindow(): number;
	/** Get current retry settings */
	getRetrySettings(): RetrySettings;
	/** Remove the last message from agent state (error cleanup) */
	removeLastAssistantMessage(): void;
	/** Trigger agent.continue() for retry */
	triggerContinue(): void;
	/** Emit a session event */
	emitEvent(event: RetrySessionEvent): void;
}

/** Events emitted by RetryCoordinator (subset of AgentSessionEvent) */
export type RetrySessionEvent =
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };

/**
 * RetryCoordinator — manages auto-retry with exponential backoff.
 * Extracted from AgentSession to isolate retry state and logic.
 */
export class RetryCoordinator {
	private _host: RetryCoordinatorHost;
	private _retryAbortController: AbortController | undefined = undefined;
	private _retryAttempt = 0;
	private _retryPromise: Promise<void> | undefined = undefined;
	private _retryResolve: (() => void) | undefined = undefined;

	constructor(host: RetryCoordinatorHost) {
		this._host = host;
	}

	/** Current retry attempt (0 if not retrying) */
	get attempt(): number {
		return this._retryAttempt;
	}

	/** Whether a retry is currently in progress */
	get isActive(): boolean {
		return this._retryPromise !== undefined;
	}

	/**
	 * Check if an assistant message represents a retryable error.
	 * Context overflow errors are NOT retryable (handled by compaction).
	 */
	isRetryableError(message: AssistantMessage): boolean {
		if (message.stopReason !== "error" || !message.errorMessage) return false;

		const contextWindow = this._host.getContextWindow();
		if (isContextOverflow(message, contextWindow)) return false;

		const err = message.errorMessage;
		// Non-retryable: billing, auth, model-not-found errors
		if (
			/insufficient.?balance|insufficient.?quota|quota.?exceeded|credit.?balance|billing|payment required|invalid api key|incorrect api key|unauthorized|unauthenticated|authentication|forbidden|permission denied|access denied|model_not_found|model not found/i.test(
				err,
			)
		) {
			return false;
		}
		// Retryable: overloaded, rate limit, server errors, connection failures
		return /overloaded|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error|connection.?error|connection.?refused|other side closed|fetch failed|upstream.?connect|reset before headers|terminated|retry delay/i.test(
			err,
		);
	}

	/**
	 * Handle a retryable error with exponential backoff.
	 * @returns true if retry was initiated, false if max retries exceeded or disabled
	 */
	async handleError(message: AssistantMessage): Promise<boolean> {
		const shouldRetry = await this._prepareRetry(message);
		if (!shouldRetry) return false;

		// Remove error message from agent state
		this._host.removeLastAssistantMessage();

		// Trigger retry via continue()
		this._host.triggerContinue();
		return true;
	}

	/**
	 * Handle a retryable error inside an active agent loop.
	 *
	 * Unlike handleError(), this does not mutate host messages and does not
	 * schedule agent.continue(); the caller remains responsible for replacing
	 * loop context and continuing in-place.
	 */
	async handleErrorInLoop(message: AssistantMessage): Promise<boolean> {
		return this._prepareRetry(message);
	}

	private async _prepareRetry(message: AssistantMessage): Promise<boolean> {
		const settings = this._host.getRetrySettings();
		if (!settings.enabled) return false;

		this._retryAttempt++;

		// Create retry promise on first attempt so waitForIdle() can await it
		if (this._retryAttempt === 1 && !this._retryPromise) {
			this._retryPromise = new Promise((resolve) => {
				this._retryResolve = resolve;
			});
		}

		if (this._retryAttempt > settings.maxRetries) {
			this._host.emitEvent({
				type: "auto_retry_end",
				success: false,
				attempt: this._retryAttempt - 1,
				finalError: message.errorMessage,
			});
			this._retryAttempt = 0;
			this._resolveRetry();
			return false;
		}

		const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);

		this._host.emitEvent({
			type: "auto_retry_start",
			attempt: this._retryAttempt,
			maxAttempts: settings.maxRetries,
			delayMs,
			errorMessage: message.errorMessage || "Unknown error",
		});

		// Wait with exponential backoff (abortable)
		this._retryAbortController = new AbortController();
		try {
			await sleep(delayMs, this._retryAbortController.signal);
		} catch {
			const attempt = this._retryAttempt;
			this._retryAttempt = 0;
			this._retryAbortController = undefined;
			this._host.emitEvent({
				type: "auto_retry_end",
				success: false,
				attempt,
				finalError: "Retry cancelled",
			});
			this._resolveRetry();
			return false;
		}
		this._retryAbortController = undefined;
		return true;
	}

	/**
	 * Called when an assistant response succeeds — resets retry counter
	 * and resolves the pending retry promise.
	 */
	onSuccess(): void {
		if (this._retryAttempt > 0) {
			this._host.emitEvent({
				type: "auto_retry_end",
				success: true,
				attempt: this._retryAttempt,
			});
			this._retryAttempt = 0;
			this._resolveRetry();
		}
	}

	/** Abort in-progress retry. */
	abort(): void {
		this._retryAbortController?.abort();
		this._retryAttempt = 0;
		this._resolveRetry();
	}

	/** Wait for any in-progress retry to complete. */
	async waitForCompletion(): Promise<void> {
		if (this._retryPromise) {
			await this._retryPromise;
		}
	}

	private _resolveRetry(): void {
		if (this._retryResolve) {
			this._retryResolve();
			this._retryResolve = undefined;
			this._retryPromise = undefined;
		}
	}
}
