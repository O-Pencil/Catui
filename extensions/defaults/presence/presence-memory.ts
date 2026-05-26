/**
 * [WHO]: PresenceMemoryEngine type, getMemoryDir(), getProject(), detectLanguageFromMemory(), collectMemoryHighlights()
 * [FROM]: Depends on node:os, node:path, node:fs for memory path discovery
 * [TO]: Consumed by extensions/defaults/presence/index.ts and presence tests
 * [HERE]: extensions/defaults/presence/presence-memory.ts - memory-derived locale and highlight selection for presence prompts
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type PresenceMemoryEntry = {
	type?: string;
	tags: string[];
	name?: string;
	summary?: string;
	detail?: string;
	content?: string;
	importance?: number;
};

export type PresenceMemoryEngine = {
	getAllEntries(): Promise<{
		knowledge: PresenceMemoryEntry[];
		lessons: PresenceMemoryEntry[];
		events?: PresenceMemoryEntry[];
		preferences?: PresenceMemoryEntry[];
		facets?: PresenceMemoryEntry[];
	}>;
	getAllEpisodes(): Promise<Array<{ date?: string; consolidated?: boolean; endedAt?: string; startedAt?: string; summary?: string; userGoal?: string }>>;
	searchEntries(query: string): Promise<PresenceMemoryEntry[]>;
};

export type PresenceMemoryState = {
	memEngine?: PresenceMemoryEngine;
	recentlyReferencedMemories: string[];
};

export type MemoryHighlights = { preferences: string[]; lessons: string[] };

export function getMemoryDir(): string {
	// Use the same memory directory as the main app.
	// Priority: env var > nanopencil default > legacy nanomem path.
	if (process.env.NANOMEM_MEMORY_DIR) return process.env.NANOMEM_MEMORY_DIR;
	const nanopencilMemory = join(homedir(), ".nanopencil", "agent", "memory");
	if (existsSync(nanopencilMemory)) return nanopencilMemory;
	return join(homedir(), ".nanomem", "memory");
}

export function getProject(): string {
	const parts = process.cwd().split("/").filter(Boolean);
	return parts.length >= 2
		? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
		: parts[parts.length - 1] || "default";
}

// Detect user's language preference from memory.
export async function detectLanguageFromMemory(state: PresenceMemoryState): Promise<"en" | "zh" | undefined> {
	if (!state.memEngine) return undefined;

	try {
		const entries = await state.memEngine.getAllEntries();
		const isPreference = (entry: PresenceMemoryEntry) => entry.type === "preference" || entry.tags.includes("preference");
		const preferences = [
			...(entries.preferences ?? []),
			...entries.knowledge.filter((entry) => entry.type === "preference" || entry.tags.includes("preference")),
			...entries.lessons.filter((entry) => entry.type === "preference" || entry.tags.includes("preference")),
		].filter(isPreference);

		try {
			const langResults = await state.memEngine.searchEntries("language 语言 中文 Chinese");
			for (const entry of langResults) {
				if (entry.type === "preference" || entry.tags.some((tag) => ["language", "语言", "locale"].includes(tag))) {
					preferences.push(entry);
				}
			}
		} catch {
			// Search is opportunistic; direct entries and episodes still provide signal.
		}

		let zhScore = 0;
		let enScore = 0;

		const zhTerms = "(中文|chinese|zh-hans|mandarin|普通话)";
		const enTerms = "(英文|english|en-us)";
		const negPrefix = "(?:don't|do not|no|not|不用|不要|别|不想用)";
		const useWords = "(?:\\s+use|\\s+using|\\s+说|\\s+讲|\\s+用)?";

		const zhNegative = new RegExp(`${negPrefix}${useWords}\\s*${zhTerms}`);
		const enNegative = new RegExp(`${negPrefix}${useWords}\\s*${enTerms}`);
		const zhPositive = new RegExp(zhTerms);
		const enPositive = new RegExp(enTerms);

		for (const pref of preferences) {
			const text = `${pref.name || ""} ${pref.summary || ""} ${pref.detail || ""} ${pref.content || ""}`.toLowerCase();
			const hasZh = zhPositive.test(text);
			const hasEn = enPositive.test(text);
			const noZh = zhNegative.test(text);
			const noEn = enNegative.test(text);

			if (hasZh && !noZh) zhScore += 2;
			if (hasEn && !noEn) enScore += 2;
			if (noZh) enScore += 1;
			if (noEn) zhScore += 1;
		}

		const episodes = await state.memEngine.getAllEpisodes();
		const recentEpisodes = episodes.slice(-10);

		let chineseContent = 0;
		let englishContent = 0;

		for (const episode of recentEpisodes) {
			const text = episode.summary || episode.userGoal || "";
			const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
			if (chineseChars > 5) chineseContent++;
			if (/^[a-zA-Z\s.,!?'"()-]+$/.test(text.slice(0, 50))) englishContent++;
		}

		if (chineseContent > englishContent) zhScore += 1;
		if (englishContent > chineseContent && englishContent > 2) enScore += 1;

		if (zhScore > enScore && zhScore > 0) return "zh";
		if (enScore > zhScore && enScore > 0) return "en";

		return undefined;
	} catch {
		return undefined;
	}
}

export async function collectMemoryHighlights(state: PresenceMemoryState): Promise<MemoryHighlights> {
	const out: MemoryHighlights = { preferences: [], lessons: [] };
	if (!state.memEngine) return out;
	try {
		const entries = await state.memEngine.getAllEntries();

		const prefPool = [
			...(entries.preferences ?? []),
			...entries.knowledge.filter((entry) => entry.type === "preference" || entry.tags.includes("preference")),
			...entries.lessons.filter((entry) => entry.type === "preference" || entry.tags.includes("preference")),
		].filter((entry) => entry.type === "preference" || entry.tags.includes("preference"));

		const recentlyReferenced = new Set(state.recentlyReferencedMemories);
		const prefPoolSorted = prefPool.sort((a, b) => {
			const aRecent = a.name && recentlyReferenced.has(a.name) ? 1 : 0;
			const bRecent = b.name && recentlyReferenced.has(b.name) ? 1 : 0;
			return aRecent - bRecent;
		});

		const prefCandidates = prefPoolSorted.slice(0, 6);
		const prefCount = Math.min(prefCandidates.length, 1 + Math.floor(Math.random() * 2));
		const prefSelected = shufflePick(prefCandidates, prefCount);

		for (const pref of prefSelected) {
			const text = (pref.summary || pref.detail || pref.content || "").toString().slice(0, 80);
			if (text) {
				out.preferences.push(`${pref.name || "pref"}: ${text}`);
				if (pref.name) state.recentlyReferencedMemories.push(pref.name);
			}
		}

		const lessonPool = (entries.lessons || [])
			.filter((entry) => entry.type !== "preference")
			.sort((a, b) => {
				const aRecent = a.name && recentlyReferenced.has(a.name) ? -1 : 0;
				const bRecent = b.name && recentlyReferenced.has(b.name) ? -1 : 0;
				return (bRecent - aRecent) || ((b.importance ?? 0) - (a.importance ?? 0));
			});

		const lessonCandidates = lessonPool.slice(0, 4);
		const lessonCount = Math.random() < 0.5 ? 0 : Math.min(lessonCandidates.length, 1);
		const lessonSelected = shufflePick(lessonCandidates, lessonCount);

		for (const lesson of lessonSelected) {
			const text = (lesson.summary || lesson.detail || lesson.content || "").toString().slice(0, 80);
			if (text) {
				out.lessons.push(`${lesson.name || "lesson"}: ${text}`);
				if (lesson.name) state.recentlyReferencedMemories.push(lesson.name);
			}
		}

		if (state.recentlyReferencedMemories.length > 8) {
			state.recentlyReferencedMemories = state.recentlyReferencedMemories.slice(-8);
		}
	} catch {
		// Presence is best-effort; malformed memory should not affect startup.
	}
	return out;
}

/** Randomly pick `count` items from array without replacement. */
function shufflePick<T>(arr: readonly T[], count: number): T[] {
	if (count <= 0 || arr.length === 0) return [];
	const indices = arr.map((_, index) => index);
	const picked: T[] = [];
	for (let i = 0; i < count && indices.length > 0; i++) {
		const index = Math.floor(Math.random() * indices.length);
		picked.push(arr[indices[index]!]!);
		indices.splice(index, 1);
	}
	return picked;
}
