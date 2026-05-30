/**
 * [WHO]: CuriosityQueue — persistent "want to understand" list for idle exploration
 * [FROM]: Depends on node:fs, node:path, node:os
 * [TO]: Consumed by ./index.ts, ./thinker.ts
 * [HERE]: extensions/builtin/idle-think/curiosity.ts - self-directed exploration agenda
 *
 * The queue is a JSON file at ~/.nanopencil/agent/memory/idle-think-curiosity.json.
 * Topics are added from exploration insights and picked for the next exploration.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const MAX_UNEXPLORED = 30;
const QUEUE_FILENAME = "idle-think-curiosity.json";

export type CuriosityItem = {
	topic: string;
	addedAt: string;
	explored: boolean;
	exploredAt?: string;
};

export type CuriosityQueue = {
	items: CuriosityItem[];
};

function getQueuePath(): string {
	return join(homedir(), ".nanopencil", "agent", "memory", QUEUE_FILENAME);
}

/**
 * Load the curiosity queue from disk. Returns empty queue if file doesn't exist.
 */
export function loadCuriosityQueue(): CuriosityQueue {
	const path = getQueuePath();
	if (!existsSync(path)) return { items: [] };
	try {
		const raw = readFileSync(path, "utf-8");
		const data = JSON.parse(raw) as CuriosityQueue;
		if (!Array.isArray(data.items)) return { items: [] };
		return data;
	} catch {
		return { items: [] };
	}
}

/**
 * Save the curiosity queue to disk.
 */
export function saveCuriosityQueue(queue: CuriosityQueue): void {
	const path = getQueuePath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(queue, null, 2), "utf-8");
	} catch {
		// fail-soft: curiosity queue is best-effort
	}
}

/**
 * Pick the next unexplored topics to focus on.
 * Returns up to `count` topics, oldest first (FIFO).
 */
export function pickNextTopics(queue: CuriosityQueue, count: number = 3): CuriosityItem[] {
	const unexplored = queue.items.filter((item) => !item.explored);
	return unexplored.slice(0, count);
}

/**
 * Mark topics as explored after they've been used in an exploration.
 */
export function markExplored(queue: CuriosityQueue, topics: string[]): void {
	const now = new Date().toISOString();
	for (const topic of topics) {
		const item = queue.items.find((i) => i.topic === topic && !i.explored);
		if (item) {
			item.explored = true;
			item.exploredAt = now;
		}
	}
	pruneOld(queue);
}

/**
 * Add new topics extracted from an exploration insight.
 * Deduplicates against existing topics.
 */
export function addTopicsFromInsight(queue: CuriosityQueue, topics: string[]): void {
	const existing = new Set(queue.items.map((i) => i.topic.toLowerCase()));
	const now = new Date().toISOString();

	for (const topic of topics) {
		const trimmed = topic.trim();
		if (!trimmed || trimmed.length < 10) continue; // skip trivially short
		if (existing.has(trimmed.toLowerCase())) continue;
		queue.items.push({ topic: trimmed, addedAt: now, explored: false });
		existing.add(trimmed.toLowerCase());
	}

	// Prune: keep only unexplored items within budget
	pruneOld(queue);
}

/**
 * Remove old explored items and excess unexplored items.
 */
function pruneOld(queue: CuriosityQueue): void {
	// Always keep explored items for the last 7 days (for dedup)
	const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
	queue.items = queue.items.filter((item) => {
		if (!item.explored) return true;
		const ts = new Date(item.exploredAt ?? item.addedAt).getTime();
		return ts > sevenDaysAgo;
	});

	// Cap unexplored items
	const unexplored = queue.items.filter((i) => !i.explored);
	if (unexplored.length > MAX_UNEXPLORED) {
		// Keep the newest ones
		const toRemove = new Set(
			unexplored
				.sort((a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime())
				.slice(0, unexplored.length - MAX_UNEXPLORED)
				.map((i) => i.topic),
		);
		queue.items = queue.items.filter((i) => i.explored || !toRemove.has(i.topic));
	}
}

/**
 * Extract "want to understand" topics from an insight text.
 * Looks for a "Curiosity" or "Want to explore" section in the text.
 * If not found, returns empty array (no topics extracted).
 */
export function extractTopicsFromInsight(insightText: string): string[] {
	const topics: string[] = [];

	// Look for sections like "Curiosity:", "Want to explore:", "Questions:", etc.
	const sectionPattern = /(?:curiosity|want to explore|questions?|next to explore|deeper questions?)[:：]\s*\n([\s\S]*?)(?:\n\n|\n#|$)/i;
	const match = insightText.match(sectionPattern);
	if (!match?.[1]) return topics;

	// Extract bullet points or numbered items
	const lines = match[1].split("\n");
	for (const line of lines) {
		const cleaned = line
			.replace(/^[\s]*[-*•]\s*/, "")  // bullet points
			.replace(/^[\s]*\d+[.)]\s*/, "") // numbered items
			.trim();
		if (cleaned.length >= 10) {
			topics.push(cleaned);
		}
	}

	return topics.slice(0, 5); // cap at 5 new topics per exploration
}
