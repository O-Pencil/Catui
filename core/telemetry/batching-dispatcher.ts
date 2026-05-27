/**
 * [WHO]: Provides BatchingDispatcher<T> — generic event-buffering with deferred-flush timer, reentrancy protection, and close-time drain
 * [FROM]: Depends on ./types for DiagnosticHandler; sink-agnostic — no HTTP, no insforge, no SAL semantics
 * [TO]: Consumed by extensions/defaults/sal/eval/insforge-sink.ts via composition; future ext-telemetry sink reuses the same machinery
 * [HERE]: core/telemetry/batching-dispatcher.ts - factored out of SAL's eval sink: SAL's scheduleFlush/doFlush/flush/close logic was inherently generic, now reusable
 */
import type { DiagnosticHandler } from "./types.js";

export interface BatchingDispatcherOptions<T> {
	/** Per-event work. Errors are caught and reported via onDiagnostic. */
	handler: (event: T) => Promise<void>;
	/** Flush timer interval in ms. Default 2000ms. */
	intervalMs?: number;
	/** Diagnostic source used in fingerprints. e.g. "sal.eval". */
	source: string;
	onDiagnostic?: DiagnosticHandler;
}

/**
 * Generic buffer-then-drain dispatcher. Consumers call enqueue() to add work;
 * a debounced flush timer drains the queue serially through the handler.
 * close() drains synchronously (best-effort) before letting the process exit.
 *
 * Reentrancy: doFlush() loops over splice()'d batches so events arriving while
 * a flush is in flight are picked up by the same flush cycle.
 */
export class BatchingDispatcher<T> {
	private pending: T[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private flushInFlight: Promise<void> | undefined;
	private closed = false;
	private handler: BatchingDispatcherOptions<T>["handler"];
	private intervalMs: number;
	private source: string;
	private onDiagnostic?: DiagnosticHandler;

	constructor(options: BatchingDispatcherOptions<T>) {
		this.handler = options.handler;
		this.intervalMs = options.intervalMs ?? 2000;
		this.source = options.source;
		this.onDiagnostic = options.onDiagnostic;
	}

	enqueue(event: T): void {
		if (this.closed) return;
		this.pending.push(event);
		this.scheduleFlush();
	}

	async flush(): Promise<void> {
		if (this.flushInFlight) {
			await this.flushInFlight.catch(() => {});
			return;
		}
		this.flushInFlight = this.doFlush();
		try {
			await this.flushInFlight;
		} catch (err) {
			this.reportFlushFailure(err, "flush");
		} finally {
			this.flushInFlight = undefined;
		}
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.flush().catch((err) => {
			this.reportFlushFailure(err, "close-flush");
		});
	}

	private scheduleFlush(): void {
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			void this.flush().catch(() => {});
		}, this.intervalMs);
	}

	private async doFlush(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		while (true) {
			const toFlush = this.pending.splice(0);
			if (toFlush.length === 0) break;
			for (const event of toFlush) {
				try {
					await this.handler(event);
				} catch (err) {
					this.reportFlushFailure(err, "handler");
				}
			}
		}
	}

	private reportFlushFailure(err: unknown, fingerprintSuffix: string): void {
		this.onDiagnostic?.({
			source: this.source,
			severity: "error",
			category: "persistence",
			message: "Telemetry flush failed.",
			detail: err instanceof Error ? { error: err.message } : err,
			fingerprint: `${this.source}:persistence:${fingerprintSuffix}`,
		});
	}
}
