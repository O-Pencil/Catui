/**
 * [WHO]: extractFreeRecap(), formatFreeRecap(), FreeRecap — zero-LLM deterministic recap from session entries
 * [FROM]: Depends on core/session/session-manager (SessionEntry types), @pencil-agent/ai (UserMessage, AssistantMessage)
 * [TO]: Consumed by extensions/builtin/recap/index.ts (Free path), recap-synthesizer (shared walker for activity counts)
 * [HERE]: extensions/builtin/recap/recap-extractor.ts - heuristic Free recap: longest user message as goal, tool/file frequency as facts, question detection as next-step
 */
import type { SessionEntry } from "../../../core/session/session-manager.js";

export interface FreeRecap {
	goal: string;
	facts: string;
	next: string;
}

export interface ExtractedActivity {
	userTexts: string[];
	tools: string[];
	files: string[];
}

const MIN_SUBSTANTIVE_GOAL_LENGTH = 30;
const GOAL_TRUNCATE = 100;
const NEXT_TRUNCATE = 120;
const TOP_TOOLS = 3;
const TOP_FILES = 3;

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } =>
			typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text",
		)
		.map((part) => part.text)
		.join("\n");
}

function extractFilePath(toolName: string, args: Record<string, unknown>): string | null {
	// Cover the high-traffic file-operating tools. Other tools are counted by
	// name only — we don't try to parse arbitrary tool inputs.
	if (toolName === "edit" || toolName === "read" || toolName === "write") {
		const fp = args.file_path;
		return typeof fp === "string" ? fp : null;
	}
	if (toolName === "bash") {
		// Cheap heuristic: pull the first path-like token. Misses some commands
		// but is good enough for "what did this session touch" at zero cost.
		const cmd = typeof args.command === "string" ? args.command : "";
		const m = cmd.match(/[\w.-]+\/[\w./-]+/);
		return m ? m[0] : null;
	}
	return null;
}

/**
 * Walk session entries once and collect everything the Free extractor and the
 * activity guard need. Exported so the Smart synthesizer can reuse the same
 * walk (avoids two passes + drift between Free and Smart context views).
 */
export function walkSessionActivity(entries: SessionEntry[]): ExtractedActivity {
	const userTexts: string[] = [];
	const tools: string[] = [];
	const files: string[] = [];

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role === "user") {
			const t = extractText(msg.content).trim();
			if (t) userTexts.push(t);
		} else if (msg.role === "assistant") {
			if (!Array.isArray(msg.content)) continue;
			for (const block of msg.content as Array<{ type: string; name?: string; arguments?: Record<string, unknown> }>) {
				if (block.type === "toolCall" && block.name) {
					tools.push(block.name);
					const path = extractFilePath(block.name, block.arguments ?? {});
					if (path) files.push(path);
				}
			}
		}
	}

	return { userTexts, tools, files };
}

function topN<T>(items: T[], n: number): Array<[T, number]> {
	const counts = new Map<T, number>();
	for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function pickGoal(userTexts: string[]): string {
	if (userTexts.length === 0) return "(no user message recorded)";
	// Prefer substantive messages (>= 30 chars, not a slash command). Pick the
	// longest — task-defining sentences are nearly always longer than chit-chat
	// like "try this" or "ok".
	const substantive = userTexts.filter((t) => t.length >= MIN_SUBSTANTIVE_GOAL_LENGTH && !t.startsWith("/"));
	const pool = substantive.length > 0 ? substantive : userTexts;
	const longest = pool.reduce((a, b) => (b.length > a.length ? b : a));
	const trimmed = longest.slice(0, GOAL_TRUNCATE).trim();
	return trimmed + (longest.length > GOAL_TRUNCATE ? "…" : "");
}

function buildFacts(tools: string[], files: string[]): string {
	if (tools.length === 0 && files.length === 0) return "no tool activity yet";
	const parts: string[] = [];
	if (tools.length > 0) {
		parts.push(topN(tools, TOP_TOOLS).map(([t, c]) => `${t}(×${c})`).join(", "));
	}
	if (files.length > 0) {
		parts.push("files: " + topN(files, TOP_FILES).map(([f]) => f).join(", "));
	}
	return parts.join("; ");
}

function pickNext(userTexts: string[]): string {
	const last = userTexts[userTexts.length - 1];
	if (!last) return "continue";
	const t = last.trim();
	// Direct question detection: punctuation or common Chinese/English question stems.
	const hasQuestionMark = /[?？]/.test(t);
	const hasQuestionStem = /^(要不要|是否|是不是|应该|怎么|为什么|how |what |should |can |is |are |do |does )/i.test(t);
	if (hasQuestionMark || hasQuestionStem) {
		const snippet = t.slice(0, NEXT_TRUNCATE) + (t.length > NEXT_TRUNCATE ? "…" : "");
		return `respond to "${snippet}"`;
	}
	return "continue";
}

/**
 * Extract a deterministic recap from session entries. No LLM calls. Returns
 * structured FreeRecap; pair with formatFreeRecap() to get a renderable string.
 */
export function extractFreeRecap(entries: SessionEntry[]): FreeRecap {
	const { userTexts, tools, files } = walkSessionActivity(entries);
	return {
		goal: pickGoal(userTexts),
		facts: buildFacts(tools, files),
		next: pickNext(userTexts),
	};
}

/**
 * Render FreeRecap as a three-clause string that matches the shape of Smart's
 * output, so the same renderer + side-by-side comparison work without
 * special-casing.
 */
export function formatFreeRecap(recap: FreeRecap): string {
	return [`Current goal: ${recap.goal}`, `Key facts: ${recap.facts}`, `Next: ${recap.next}`].join("\n");
}
