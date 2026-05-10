/**
 * [WHO]: TokenSave tracking helpers and in-memory aggregate store
 * [FROM]: Depends on node:fs/promises and node:path for JSONL persistence
 * [TO]: Consumed by extensions/defaults/token-save/index.ts
 * [HERE]: extensions/defaults/token-save/tracking.ts - token savings analytics boundary
 */
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { TokenSaveCategory } from "./filters.js";

export interface TokenSaveRecord {
	timestamp: string;
	projectPath: string;
	command: string;
	category: TokenSaveCategory;
	mode: "filtered" | "passthrough";
	inputTokens: number;
	outputTokens: number;
	savedTokens: number;
	savingsPct: number;
	elapsedMs?: number;
	isError: boolean;
	rawRecoveryPath?: string;
}

export class TokenSaveTracker {
	private records: TokenSaveRecord[] = [];

	constructor(private readonly projectPath: string) {}

	add(record: Omit<TokenSaveRecord, "timestamp" | "projectPath">): TokenSaveRecord {
		const fullRecord: TokenSaveRecord = {
			...record,
			timestamp: new Date().toISOString(),
			projectPath: this.projectPath,
		};
		this.records.push(fullRecord);
		if (this.records.length > 500) this.records.shift();
		void this.persist(fullRecord);
		return fullRecord;
	}

	formatSummary(limit = 8): string {
		const filtered = this.records.filter((record) => record.mode === "filtered");
		const totals = filtered.reduce(
			(acc, record) => {
				acc.input += record.inputTokens;
				acc.output += record.outputTokens;
				acc.saved += record.savedTokens;
				return acc;
			},
			{ input: 0, output: 0, saved: 0 },
		);
		const pct = totals.input > 0 ? Math.round((totals.saved / totals.input) * 100) : 0;
		const recent = filtered.slice(-limit).map((record) =>
			`${record.category}: saved ${record.savedTokens} tokens (${record.savingsPct}%)`,
		);
		return [
			"TokenSave stats",
			`Filtered commands: ${filtered.length}`,
			`Estimated tokens: ${totals.input} -> ${totals.output}`,
			`Saved: ${totals.saved} (${pct}%)`,
			recent.length ? "\nRecent:\n" + recent.join("\n") : "\nNo filtered commands recorded yet.",
		].join("\n");
	}

	formatHistory(limit = 20): string {
		const recent = this.records.slice(-limit);
		if (recent.length === 0) return "TokenSave history is empty.";
		return [
			"TokenSave history",
			...recent.map((record) =>
				[
					record.timestamp,
					record.mode,
					record.category,
					`saved=${record.savedTokens}`,
					`pct=${record.savingsPct}`,
					record.rawRecoveryPath ? `raw=${record.rawRecoveryPath}` : undefined,
					`cmd=${record.command}`,
				]
					.filter(Boolean)
					.join(" | "),
			),
		].join("\n");
	}

	private async persist(record: TokenSaveRecord): Promise<void> {
		const dir = join(this.projectPath, ".nanopencil", "token-save");
		try {
			await mkdir(dir, { recursive: true });
			await appendFile(join(dir, "history.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
		} catch {
			// Token savings must never make a tool result fail.
		}
	}
}
