/**
 * [WHO]: storeInsight(), loadRecentInsights(), buildInsightInjection() — nanomem-persisted insight storage and injection
 * [FROM]: Depends on node:fs, node:path, node:os, packages/mem-core/src/store (loadEntries/saveEntries)
 * [TO]: Consumed by ./index.ts (idle-think extension entry)
 * [HERE]: extensions/defaults/idle-think/insights.ts - persistent insight storage via nanomem knowledge.json
 *
 * Insights are stored directly in nanomem's knowledge.json with tag "idle-think".
 * This ensures they persist across sessions and benefit from nanomem's existing
 * utility scoring and eviction logic.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────────────

type KnowledgeEntry = {
	id: string;
	type: string;
	name?: string;
	summary?: string;
	detail?: string;
	tags: string[];
	project: string;
	importance: number;
	created: string;
	accessCount: number;
	lastAccessed?: string;
	content?: string; // backward compat
};

// ── Path resolution ──────────────────────────────────────────────────────────

function getKnowledgePath(): string {
	return join(homedir(), ".nanopencil", "agent", "memory", "knowledge.json");
}

function getMemoryDir(): string {
	if (process.env.NANOMEM_MEMORY_DIR) return process.env.NANOMEM_MEMORY_DIR;
	const nanopencilMemory = join(homedir(), ".nanopencil", "agent", "memory");
	if (existsSync(nanopencilMemory)) return nanopencilMemory;
	return join(homedir(), ".nanomem", "memory");
}

// ── Direct file I/O (no engine dependency) ───────────────────────────────────

function loadKnowledge(): KnowledgeEntry[] {
	const path = join(getMemoryDir(), "knowledge.json");
	if (!existsSync(path)) return [];
	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as KnowledgeEntry[];
	} catch {
		return [];
	}
}

function saveKnowledge(entries: KnowledgeEntry[]): void {
	const path = join(getMemoryDir(), "knowledge.json");
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(entries, null, 2), "utf-8");
	} catch {
		// fail-soft
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Store an insight as a nanomem knowledge entry.
 * Entry is tagged "idle-think" for traceability and filtering.
 */
export function storeInsight(insightText: string, project: string): void {
	const entries = loadKnowledge();
	const now = new Date().toISOString();
	const dateStamp = now.slice(0, 10);

	// Generate a short summary from the first line or first 150 chars
	const firstLine = insightText.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
	const summary = firstLine.length > 150 ? firstLine.slice(0, 147) + "..." : firstLine;

	const entry: KnowledgeEntry = {
		id: `idle-think-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		type: "fact",
		name: `idle-think:${dateStamp}`,
		summary,
		detail: insightText.slice(0, 2000),
		tags: ["idle-think", "auto-exploration"],
		project,
		importance: 0.5, // moderate — not a core preference or lesson
		created: now,
		accessCount: 0,
	};

	entries.push(entry);

	// Keep knowledge.json manageable — cap at 500 entries
	if (entries.length > 500) {
		entries.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
		entries.length = 500;
	}

	saveKnowledge(entries);
}

/**
 * Load recent idle-think insights from nanomem.
 * Returns the last `count` entries, newest first.
 */
export function loadRecentInsights(count: number = 5): KnowledgeEntry[] {
	const entries = loadKnowledge();
	return entries
		.filter((e) => e.tags.includes("idle-think"))
		.sort((a, b) => b.created.localeCompare(a.created))
		.slice(0, count);
}

/**
 * Build a system prompt injection for before_agent_start.
 * Reads from nanomem (persistent), not session state.
 */
export function buildInsightInjection(): string | undefined {
	const insights = loadRecentInsights(3);
	if (!insights.length) return undefined;

	const items = insights
		.map((entry) => {
			const text = entry.summary || entry.detail || "";
			return text.slice(0, 300);
		})
		.filter(Boolean)
		.join("\n\n");

	if (!items) return undefined;

	return [
		"",
		"## Idle Exploration Notes",
		"",
		"While the user was away, background code exploration found these insights",
		"about the current project:",
		"",
		items,
		"",
		"These are persistent knowledge from idle exploration (stored in nanomem).",
		"They are NOT conversation history. Reference them naturally if relevant;",
		"don't force them into conversation or mention how you learned them.",
		"",
	].join("\n");
}
