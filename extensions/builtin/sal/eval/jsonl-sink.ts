/**
 * [WHO]: Provides JsonlEvalSink (filesystem append-only adapter)
 * [FROM]: Depends on node:fs, node:path, node:url; ./types.js for EvalSink/EvalEventEnvelope/CreateEvalSinkOptions
 * [TO]: Constructed by eval/index.ts factory when adapter resolves to "jsonl"
 * [HERE]: extensions/builtin/sal/eval/jsonl-sink.ts - offline-friendly sink that appends one JSON object per line; useful for experiments that don't want a live backend, and for capturing replayable event traces
 *
 * Output schema: each line is a serialized EvalEventEnvelope. Downstream tools
 * (analysis scripts, bulk import to InsForge / Postgres / BigQuery) consume the
 * file directly. No transformation is applied — the file is the raw event log.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CreateEvalSinkOptions, EvalEventEnvelope, EvalSink } from "./types.js";

export class JsonlEvalSink implements EvalSink {
	readonly enabled = true;

	private filePath: string;
	private pending: EvalEventEnvelope[] = [];
	private batchIntervalMs: number;
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private closed = false;
	private onDiagnostic: CreateEvalSinkOptions["onDiagnostic"];

	constructor(options: CreateEvalSinkOptions) {
		this.filePath = resolveFilePath(options.endpoint!);
		this.batchIntervalMs = options.batchIntervalMs ?? 2000;
		this.onDiagnostic = options.onDiagnostic;
		const dir = dirname(this.filePath);
		if (!existsSync(dir)) {
			try {
				mkdirSync(dir, { recursive: true });
			} catch (err) {
				this.reportDiagnostic("SAL eval JSONL directory could not be created.", { dir, error: (err as Error).message }, "mkdir");
			}
		}
	}

	async sendEvent(event: EvalEventEnvelope): Promise<void> {
		if (this.closed) return;
		this.pending.push(event);
		this.scheduleFlush();
	}

	async flush(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
		const toFlush = this.pending.splice(0);
		if (toFlush.length === 0) return;
		this.writeLines(toFlush);
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.flush();
	}

	private scheduleFlush(): void {
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			const toFlush = this.pending.splice(0);
			if (toFlush.length > 0) this.writeLines(toFlush);
		}, this.batchIntervalMs);
	}

	private writeLines(events: EvalEventEnvelope[]): void {
		const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
		try {
			appendFileSync(this.filePath, lines, "utf-8");
		} catch (err) {
			this.reportDiagnostic("SAL eval JSONL append failed.", { filePath: this.filePath, error: (err as Error).message }, "append");
		}
	}

	private reportDiagnostic(message: string, detail: unknown, fingerprintSuffix: string): void {
		this.onDiagnostic?.({
			source: "sal.eval",
			severity: "error",
			category: "persistence",
			message,
			detail,
			fingerprint: `sal.eval:persistence:jsonl-${fingerprintSuffix}`,
			context: { adapter: "jsonl" },
		});
	}
}

/** Accept either a `file://` URL or a plain filesystem path. */
function resolveFilePath(endpoint: string): string {
	if (endpoint.startsWith("file://")) {
		return fileURLToPath(endpoint);
	}
	return endpoint;
}
