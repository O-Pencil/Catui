/**
 * [WHO]: TokenSave command classifiers and output filters
 * [FROM]: Depends on core/tools/truncate for bounded output helpers
 * [TO]: Consumed by extensions/builtin/token-save/index.ts and tests
 * [HERE]: extensions/builtin/token-save/filters.ts - pure token-saving filter library
 */
import { truncateHead, truncateTail } from "../../../core/tools/truncate.js";

export type TokenSaveCategory =
	| "git-status"
	| "git-log"
	| "git-diff"
	| "read-file"
	| "search"
	| "typescript"
	| "lint"
	| "pytest"
	| "test"
	| "json"
	| "package-manager"
	| "generic";

export interface TokenSaveClassification {
	category: TokenSaveCategory;
	mode: "filtered" | "passthrough";
	reason?: string;
}

export interface TokenSaveFilterResult {
	text: string;
	category: TokenSaveCategory;
	mode: "filtered" | "passthrough";
}

const MAX_GENERIC_LINES = 120;
const MAX_FAILURE_LINES = 180;
const MAX_DIFF_LINES = 180;

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function firstCommandSegment(command: string): string {
	return command
		.split(/&&|\|\||;/, 1)[0]
		.replace(/^\s*(?:\w+=\S+\s+)*/, "")
		.trim();
}

function looksLikeDisabled(command: string): boolean {
	return /\b(?:TOKEN_SAVE_DISABLED|TOKENSAVE_DISABLED)=1\b/.test(command);
}

function hasWriteRedirection(segment: string): boolean {
	return /(^|\s)(?:>>?|2>|&>)/.test(segment) || /\bcat\s*>/.test(segment);
}

export function classifyCommand(command: string): TokenSaveClassification {
	if (!command.trim()) return { category: "generic", mode: "passthrough", reason: "empty command" };
	if (looksLikeDisabled(command)) return { category: "generic", mode: "passthrough", reason: "disabled by env" };

	const segment = firstCommandSegment(command);
	if (hasWriteRedirection(segment)) {
		return { category: "generic", mode: "passthrough", reason: "write redirection" };
	}

	if (/\bgit\s+status\b/.test(segment)) return { category: "git-status", mode: "filtered" };
	if (/\bgit\s+(?:log|show)\b/.test(segment)) return { category: "git-log", mode: "filtered" };
	if (/\bgit\s+(?:diff|show)\b/.test(segment)) return { category: "git-diff", mode: "filtered" };
	if (/^(?:cat|head|tail|less|sed\s+-n)\b/.test(segment)) return { category: "read-file", mode: "filtered" };
	if (/^(?:rg|grep|find|fd|ls|tree)\b/.test(segment)) return { category: "search", mode: "filtered" };
	if (/\b(?:tsc|vue-tsc)\b/.test(segment)) return { category: "typescript", mode: "filtered" };
	if (/\b(?:eslint|biome)\b/.test(segment)) return { category: "lint", mode: "filtered" };
	if (/\bpytest\b/.test(segment)) return { category: "pytest", mode: "filtered" };
	if (/\b(?:vitest|jest|playwright|pytest|mocha)\b/.test(segment)) return { category: "test", mode: "filtered" };
	if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update)\b/.test(segment)) return { category: "package-manager", mode: "filtered" };
	if (/\b(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+(?:test|build|lint|typecheck)|exec\s+(?:tsc|vue-tsc|vitest|jest|playwright|eslint|biome))\b/.test(segment)) {
		return { category: "test", mode: "filtered" };
	}
	if (/\b(?:jq|curl)\b/.test(segment)) return { category: "json", mode: "filtered" };

	return { category: "generic", mode: "filtered" };
}

function compactGitStatus(raw: string): string {
	const lines = raw.split("\n").map((line) => line.trimEnd()).filter(Boolean);
	const branch = lines.find((line) => /^On branch /.test(line) || /^## /.test(line));
	const summary = lines.find((line) => /(nothing to commit|working tree clean|changed|insertions|deletions|files? changed)/i.test(line));
	const sections: string[] = [];
	let current = "";
	const buckets = new Map<string, string[]>();

	for (const line of lines) {
		if (/^(Changes|Untracked|Changes not staged|Changes to be committed)/i.test(line)) {
			current = line.replace(/:$/, "");
			if (!buckets.has(current)) buckets.set(current, []);
			continue;
		}
		if (/^\s*(modified|new file|deleted|renamed|copied|both modified):\s+/.test(line) && current) {
			buckets.get(current)?.push(line.trim());
		} else if (/^  \S/.test(line) && /^Untracked files/i.test(current)) {
			buckets.get(current)?.push(line.trim());
		} else if (/^[ MADRCU?!]{1,2}\s+/.test(line)) {
			const key = "Short status";
			if (!buckets.has(key)) buckets.set(key, []);
			buckets.get(key)?.push(line.trim());
		}
	}

	if (branch) sections.push(branch);
	if (summary) sections.push(summary);
	for (const [name, entries] of buckets) {
		sections.push(`${name}: ${entries.length}`);
		sections.push(...entries.slice(0, 20).map((entry) => `  ${entry}`));
		if (entries.length > 20) sections.push(`  ... ${entries.length - 20} more`);
	}
	return sections.length ? sections.join("\n") : truncateHead(raw, { maxLines: 80, maxBytes: 12_000 }).content;
}

function compactGitDiff(raw: string): string {
	const lines = raw.split("\n");
	const files = lines.filter((line) => line.startsWith("diff --git ")).map((line) => line.replace(/^diff --git /, ""));
	const stats = lines.filter((line) => /^[-+]{3} |^@@ |^\+\+\+ /.test(line));
	const changed = lines.filter((line) => /^[+-][^+-]/.test(line)).length;
	const head = [`Git diff compact: ${files.length} file(s), ${changed} changed line(s)`];
	if (files.length) head.push(...files.slice(0, 40).map((file) => `  ${file}`));
	const body = stats.slice(0, MAX_DIFF_LINES);
	return [...head, ...body, stats.length > body.length ? `... ${stats.length - body.length} diff metadata lines omitted` : ""]
		.filter(Boolean)
		.join("\n");
}

function compactGitLog(raw: string): string {
	const lines = raw.split("\n").filter(Boolean);
	const commitLines = lines.filter((line) => /^(commit\s+[0-9a-f]{7,40}|[0-9a-f]{7,40}\s+)/i.test(line));
	const dates = lines.filter((line) => /^Date:\s+/.test(line)).slice(0, 20);
	const subjects = lines.filter((line) => /^\s{4}\S/.test(line)).map((line) => line.trim()).slice(0, 80);
	if (commitLines.length === 0 && subjects.length === 0) return truncateHead(raw, { maxLines: 120, maxBytes: 16_000 }).content;
	return [
		`Git log compact: ${commitLines.length || subjects.length} entr${commitLines.length === 1 || subjects.length === 1 ? "y" : "ies"}`,
		...commitLines.slice(0, 80),
		...dates,
		...subjects,
	].join("\n");
}

function compactTypeScriptOutput(raw: string): string {
	const lines = stripAnsi(raw).split("\n").filter(Boolean);
	const grouped = new Map<string, string[]>();
	const summaries: string[] = [];
	for (const line of lines) {
		const match = line.match(/^(.+?\.(?:ts|tsx|js|jsx|vue))\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
		if (match) {
			const key = `${match[1]} ${match[4]}`;
			const entry = `  ${match[2]}:${match[3]} ${match[5]}`;
			const list = grouped.get(key) ?? [];
			list.push(entry);
			grouped.set(key, list);
			continue;
		}
		if (/error TS\d+|Found \d+ errors?/.test(line)) summaries.push(line);
	}
	if (grouped.size === 0) return compactFailureOutput(raw);
	const output: string[] = [`TypeScript compact: ${grouped.size} file/code group(s)`];
	for (const [key, entries] of Array.from(grouped.entries()).slice(0, 60)) {
		output.push(key);
		output.push(...entries.slice(0, 6));
		if (entries.length > 6) output.push(`  ... ${entries.length - 6} more`);
	}
	output.push(...summaries.slice(-10));
	return output.join("\n");
}

function compactLintOutput(raw: string): string {
	const lines = stripAnsi(raw).split("\n").filter(Boolean);
	const important = lines.filter((line) =>
		/(error|warning|problem|^\s*\d+:\d+\s+|\/.+\.(?:ts|tsx|js|jsx|vue|css|json)$)/i.test(line),
	);
	return important.length ? important.slice(0, MAX_FAILURE_LINES).join("\n") : compactFailureOutput(raw);
}

function compactPytestOutput(raw: string): string {
	const lines = stripAnsi(raw).split("\n").filter(Boolean);
	const selected = lines.filter((line) =>
		/(^FAILED |^ERROR |^E\s+|Traceback|AssertionError|short test summary|failed|passed|warnings?)/i.test(line),
	);
	return selected.length ? selected.slice(0, MAX_FAILURE_LINES).join("\n") : compactFailureOutput(raw);
}

function compactFailureOutput(raw: string): string {
	const lines = stripAnsi(raw).split("\n").filter(Boolean);
	const important = lines.filter((line) =>
		/(error|failed|failure|exception|traceback|^\s*at\s+|expected|received|AssertionError|TS\d{4}|ERR!|FAIL)/i.test(line),
	);
	const summary = lines.filter((line) => /(tests?|passed|failed|skipped|errors?|warnings?|Time:|Ran \d+)/i.test(line)).slice(-30);
	const selected = [...important.slice(0, MAX_FAILURE_LINES), ...summary];
	return selected.length ? Array.from(new Set(selected)).join("\n") : truncateTail(raw, { maxLines: 120, maxBytes: 18_000 }).content;
}

function compactSearchOutput(raw: string): string {
	const lines = raw.split("\n").filter(Boolean);
	if (lines.length <= 160 && raw.length <= 20_000) return raw;
	const grouped = new Map<string, string[]>();
	for (const line of lines) {
		const file = line.split(":", 1)[0] || "(output)";
		const list = grouped.get(file) ?? [];
		list.push(line);
		grouped.set(file, list);
	}
	const output = [`Search compact: ${lines.length} line(s), ${grouped.size} group(s)`];
	for (const [file, entries] of Array.from(grouped.entries()).slice(0, 80)) {
		output.push(`${file}: ${entries.length}`);
		output.push(...entries.slice(0, 3).map((entry) => `  ${entry.slice(0, 240)}`));
		if (entries.length > 3) output.push(`  ... ${entries.length - 3} more`);
	}
	return output.join("\n");
}

function compactPackageManagerOutput(raw: string): string {
	const lines = stripAnsi(raw).split("\n").filter(Boolean);
	const selected = lines.filter((line) =>
		/(added|removed|updated|packages?|dependencies|deprecated|warning|error|vulnerab|audit|funding|lockfile|resolved|downloaded)/i.test(line),
	);
	return selected.length ? selected.slice(0, 120).join("\n") : truncateTail(raw, { maxLines: 80, maxBytes: 12_000 }).content;
}

function compactFileRead(raw: string): string {
	const lines = raw.split("\n");
	if (lines.length <= 220 && raw.length <= 24_000) return raw;
	const first = truncateHead(raw, { maxLines: 80, maxBytes: 12_000 }).content;
	const last = truncateTail(raw, { maxLines: 80, maxBytes: 12_000 }).content;
	return `${first}\n\n... TokenSave omitted ${Math.max(0, lines.length - 160)} middle line(s) ...\n\n${last}`;
}

function compactJson(raw: string): string {
	try {
		const value = JSON.parse(raw);
		return JSON.stringify(summarizeJson(value), null, 2);
	} catch {
		return truncateTail(raw, { maxLines: MAX_GENERIC_LINES, maxBytes: 18_000 }).content;
	}
}

function summarizeJson(value: unknown, depth = 0): unknown {
	if (depth >= 4) return Array.isArray(value) ? `[array:${value.length}]` : typeof value;
	if (Array.isArray(value)) {
		return { type: "array", length: value.length, sample: value.slice(0, 3).map((item) => summarizeJson(item, depth + 1)) };
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).slice(0, 40);
		return Object.fromEntries(entries.map(([key, item]) => [key, summarizeJson(item, depth + 1)]));
	}
	if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 157)}...` : value;
	return value;
}

export function filterTokenSaveOutput(command: string, rawOutput: string): TokenSaveFilterResult {
	const classification = classifyCommand(command);
	const raw = stripAnsi(rawOutput);
	if (classification.mode === "passthrough") {
		return { text: rawOutput, category: classification.category, mode: "passthrough" };
	}

	let text: string;
	switch (classification.category) {
		case "git-status":
			text = compactGitStatus(raw);
			break;
		case "git-diff":
			text = compactGitDiff(raw);
			break;
		case "git-log":
			text = compactGitLog(raw);
			break;
		case "read-file":
			text = compactFileRead(raw);
			break;
		case "typescript":
			text = compactTypeScriptOutput(raw);
			break;
		case "lint":
			text = compactLintOutput(raw);
			break;
		case "pytest":
			text = compactPytestOutput(raw);
			break;
		case "test":
			text = compactFailureOutput(raw);
			break;
		case "json":
			text = compactJson(raw);
			break;
		case "search":
			text = compactSearchOutput(raw);
			break;
		case "package-manager":
			text = compactPackageManagerOutput(raw);
			break;
		case "generic":
			text = truncateTail(raw, { maxLines: MAX_GENERIC_LINES, maxBytes: 18_000 }).content;
			break;
	}

	return { text: text || rawOutput, category: classification.category, mode: "filtered" };
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
