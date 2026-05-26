/**
 * [WHO]: storeInsight(), loadRecentInsights(), buildInsightInjection(), projectKeyFromCwd() — project-scoped nanomem insight storage and injection
 * [FROM]: Depends on node:fs, node:path, node:os, packages/mem-core/src/store and packages/mem-core/src/types for validated persistent memory entries
 * [TO]: Consumed by ./index.ts (idle-think extension entry)
 * [HERE]: extensions/defaults/idle-think/insights.ts - persistent insight storage via nanomem knowledge.json
 *
 * Insights are stored in nanomem's knowledge.json with tag "idle-think".
 * This keeps persistence compatible with nanomem's entry migration and
 * avoids injecting notes from unrelated projects.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadEntries, saveEntries } from "../../../packages/mem-core/src/store.js";
import type { MemoryEntry } from "../../../packages/mem-core/src/types.js";

const MAX_IDLE_INSIGHTS = 100;
const IDLE_THINK_TAG = "idle-think";
const AUTO_EXPLORATION_TAG = "auto-exploration";

// ── Path resolution ──────────────────────────────────────────────────────────

function getMemoryDir(): string {
	if (process.env.NANOMEM_MEMORY_DIR) return process.env.NANOMEM_MEMORY_DIR;
	const nanopencilMemory = join(homedir(), ".nanopencil", "agent", "memory");
	if (existsSync(nanopencilMemory)) return nanopencilMemory;
	return join(homedir(), ".nanomem", "memory");
}

function getKnowledgePath(): string {
	return join(getMemoryDir(), "knowledge.json");
}

export function projectKeyFromCwd(cwd: string): string {
	const parts = cwd.split(/[\\/]+/).filter(Boolean);
	return parts.slice(-2).join("/") || parts[0] || "default";
}

// ── Store helpers ────────────────────────────────────────────────────────────

async function loadKnowledge(): Promise<MemoryEntry[]> {
	try {
		return await loadEntries(getKnowledgePath());
	} catch {
		return [];
	}
}

async function saveKnowledge(entries: MemoryEntry[]): Promise<void> {
	await saveEntries(getKnowledgePath(), entries, Number.MAX_SAFE_INTEGER, insightUtility);
}

function insightUtility(entry: MemoryEntry): number {
	return (entry.importance ?? 0) * (entry.accessCount + 1);
}

function isIdleInsight(entry: MemoryEntry): boolean {
	return Array.isArray(entry.tags) && entry.tags.includes(IDLE_THINK_TAG);
}

function pruneIdleInsights(entries: MemoryEntry[]): MemoryEntry[] {
	const idle = entries
		.filter(isIdleInsight)
		.sort((a, b) => b.created.localeCompare(a.created))
		.slice(0, MAX_IDLE_INSIGHTS);
	const keepIdleIds = new Set(idle.map((entry) => entry.id));
	return entries.filter((entry) => !isIdleInsight(entry) || keepIdleIds.has(entry.id));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Store an insight as a nanomem knowledge entry.
 * Entry is tagged "idle-think" for traceability and filtering.
 */
export async function storeInsight(insightText: string, project: string): Promise<void> {
	const trimmed = insightText.trim();
	if (!trimmed) return;

	const entries = await loadKnowledge();
	const now = new Date().toISOString();
	const dateStamp = now.slice(0, 10);

	// Generate a short summary from the first line or first 150 chars
	const firstLine = trimmed.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
	const summary = firstLine.length > 150 ? firstLine.slice(0, 147) + "..." : firstLine;

	const entry: MemoryEntry = {
		id: `idle-think-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		type: "fact",
		name: `idle-think:${dateStamp}`,
		summary,
		detail: trimmed.slice(0, 2000),
		tags: [IDLE_THINK_TAG, AUTO_EXPLORATION_TAG],
		project,
		importance: 0.5, // moderate — not a core preference or lesson
		created: now,
		accessCount: 0,
	};

	await saveKnowledge(pruneIdleInsights([...entries, entry]));
}

/**
 * Load recent idle-think insights from nanomem.
 * Returns the last `count` entries, newest first.
 */
export async function loadRecentInsights(count: number = 5, project?: string): Promise<MemoryEntry[]> {
	const entries = await loadKnowledge();
	return entries
		.filter((entry) => isIdleInsight(entry) && (!project || entry.project === project))
		.sort((a, b) => b.created.localeCompare(a.created))
		.slice(0, count);
}

/**
 * Build a system prompt injection for before_agent_start.
 * Reads from nanomem (persistent), not session state.
 */
export async function buildInsightInjection(project?: string): Promise<string | undefined> {
	const insights = await loadRecentInsights(3, project);
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
		project ? "about this project:" : "about recent projects:",
		"",
		items,
		"",
		"These are persistent knowledge from idle exploration (stored in nanomem).",
		"They are NOT conversation history. Reference them naturally if relevant;",
		"don't force them into conversation or mention how you learned them.",
		"",
	].join("\n");
}
