/**
 * [WHO]: TeamTranscriptWriter
 * [FROM]: Depends on node:fs/promises, node:path
 * [TO]: Consumed by team-runtime.ts
 * [HERE]: extensions/builtin/team/team-transcript.ts - per-teammate JSONL transcripts
 *
 * Per refactor plan §B.7: each teammate keeps an independent transcript file
 * for offline observation and debugging. Format is JSONL — one entry per
 * line — under `<storageDir>/transcripts/<teammateId>.jsonl`.
 *
 * Writes are best-effort and never throw into the runtime hot path.
 */

import { mkdir, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";

export interface TranscriptEntry {
	timestamp: number;
	kind: "leader" | "teammate" | "event";
	content: string;
	meta?: Record<string, unknown>;
}

export class TeamTranscriptWriter {
	private readonly dir: string;
	private dirReady = false;

	constructor(storageDir: string) {
		this.dir = join(storageDir, "transcripts");
	}

	private async ensureDir(): Promise<void> {
		if (this.dirReady) return;
		try {
			await mkdir(this.dir, { recursive: true });
			this.dirReady = true;
		} catch {
			// Ignore — append() will retry next call.
		}
	}

	private fileFor(teammateId: string): string {
		return join(this.dir, `${teammateId}.jsonl`);
	}

	/** Append one entry to the teammate's transcript. Never throws. */
	async append(teammateId: string, entry: TranscriptEntry): Promise<void> {
		try {
			await this.ensureDir();
			await appendFile(this.fileFor(teammateId), `${JSON.stringify(entry)}\n`, "utf-8");
		} catch {
			// Best effort.
		}
	}

	/** Remove a teammate's transcript file (called on terminate). */
	async remove(teammateId: string): Promise<void> {
		try {
			await rm(this.fileFor(teammateId), { force: true });
		} catch {
			// ignore
		}
	}

	/** Storage directory used for transcripts. */
	get directory(): string {
		return this.dir;
	}
}
