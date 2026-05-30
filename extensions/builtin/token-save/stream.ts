/**
 * [WHO]: TokenSaveStreamAccumulator for bounded streaming-mode output collection
 * [FROM]: No runtime dependencies
 * [TO]: Consumed by extensions/builtin/token-save/runner.ts and tests
 * [HERE]: extensions/builtin/token-save/stream.ts - stream-mode raw capture guardrail
 */
export interface TokenSaveStreamSnapshot {
	text: string;
	totalBytes: number;
	truncated: boolean;
}

export class TokenSaveStreamAccumulator {
	private chunks: string[] = [];
	private bytes = 0;
	private truncated = false;

	constructor(private readonly maxBytes = 10 * 1024 * 1024) {}

	push(chunk: string): void {
		const chunkBytes = Buffer.byteLength(chunk, "utf8");
		this.bytes += chunkBytes;
		if (this.truncated) return;

		const currentText = this.chunks.join("");
		const currentBytes = Buffer.byteLength(currentText, "utf8");
		if (currentBytes + chunkBytes <= this.maxBytes) {
			this.chunks.push(chunk);
			return;
		}

		const remaining = Math.max(0, this.maxBytes - currentBytes);
		if (remaining > 0) {
			this.chunks.push(Buffer.from(chunk, "utf8").subarray(0, remaining).toString("utf8"));
		}
		this.truncated = true;
	}

	snapshot(): TokenSaveStreamSnapshot {
		return {
			text: this.chunks.join(""),
			totalBytes: this.bytes,
			truncated: this.truncated,
		};
	}
}
