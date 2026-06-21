/**
 * [WHO]: PresenceMemoryEngine type, getMemoryDir(), getProject(), detectLanguageFromMemory(), collectMemoryHighlights(), collectIdentityPreferenceHighlights()
 * [FROM]: Depends on node:os, node:path, node:fs for memory path discovery
 * [TO]: Consumed by extensions/builtin/presence/index.ts and presence tests
 * [HERE]: extensions/builtin/presence/presence-memory.ts - memory-derived locale and highlight selection for presence prompts
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
	personaMemEngine?: PresenceMemoryEngine;
	recentlyReferencedMemories: string[];
};

export type MemoryHighlights = { preferences: string[]; lessons: string[] };

const IDENTITY_PREFERENCE_PATTERN =
	/(tone|style|speaking|speak|call(?:s|ed)?\s+(?:me|user|them)?|address|persona|role|identity|character|扮演|角色|人设|身份|语气|口吻|说话方式|称呼|叫我|雷姆|rem-like|rem\b)/i;

export function getMemoryDir(): string {
	// Use the same memory directory as the main app.
	// Priority: env var > catui default > legacy nanomem path.
	if (process.env.NANOMEM_MEMORY_DIR) return process.env.NANOMEM_MEMORY_DIR;
	const catuiMemory = join(homedir(), ".catui", "agent", "memory");
	if (existsSync(catuiMemory)) return catuiMemory;
	return join(homedir(), ".nanomem", "memory");
}

/**
 * Resolve the persona-specific memory directory, if one exists for the active persona.
 * Returns the path only when both NANO_PERSONA_DIR is set AND the persona has its own
 * `memory/` subdirectory containing at least one of the canonical nanomem files.
 * Returns undefined when persona has no memory (graceful fallback to global memory).
 */
export function getPersonaMemoryDir(): string | undefined {
	const personaDir = process.env.NANO_PERSONA_DIR;
	if (!personaDir) return undefined;
	const personaMemory = join(personaDir, "memory");
	if (!existsSync(personaMemory)) return undefined;
	// Require at least one canonical file so we don't init an empty engine.
	for (const file of ["knowledge.json", "lessons.json", "preferences.json", "events.json"]) {
		if (existsSync(join(personaMemory, file))) return personaMemory;
	}
	return undefined;
}

export function getProject(): string {
	const parts = process.cwd().split("/").filter(Boolean);
	return parts.length >= 2
		? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
		: parts[parts.length - 1] || "default";
}

// Detect user's language preference from memory.
export async function detectLanguageFromMemory(state: PresenceMemoryState): Promise<"en" | "zh" | undefined> {
	if (!state.memEngine && !state.personaMemEngine) return undefined;

	// Persona memory is the narrower scope, so its signal outranks global.
	const personaResult = state.personaMemEngine
		? await scoreLanguageFromEngine(state.personaMemEngine)
		: undefined;
	if (personaResult && personaResult !== "tie") return personaResult;

	const globalResult = state.memEngine
		? await scoreLanguageFromEngine(state.memEngine)
		: undefined;
	if (globalResult && globalResult !== "tie") return globalResult;

	// If persona said "tie" but global has a strong signal, defer to global.
	return globalResult === "tie" ? undefined : globalResult;
}

async function scoreLanguageFromEngine(
	engine: PresenceMemoryEngine,
): Promise<"zh" | "en" | "tie" | undefined> {
	try {
		const entries = await engine.getAllEntries();
		const isPreference = (entry: PresenceMemoryEntry) =>
			entry.type === "preference" || entry.tags.includes("preference");
		const preferences = [
			...(entries.preferences ?? []),
			...entries.knowledge.filter((entry) => entry.type === "preference" || entry.tags.includes("preference")),
			...entries.lessons.filter((entry) => entry.type === "preference" || entry.tags.includes("preference")),
		].filter(isPreference);

		try {
			const langResults = await engine.searchEntries("language 语言 中文 Chinese");
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

		const episodes = await engine.getAllEpisodes();
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
		return "tie";
	} catch {
		return undefined;
	}
}

export async function collectMemoryHighlights(state: PresenceMemoryState): Promise<MemoryHighlights> {
	const out: MemoryHighlights = { preferences: [], lessons: [] };
	const seenNames = new Set<string>();
	const rememberName = (name?: string) => {
		if (!name) return;
		const key = name.toLowerCase();
		if (seenNames.has(key)) return false;
		seenNames.add(key);
		state.recentlyReferencedMemories.push(name);
		return true;
	};

	// Persona memory first (highest priority), then global memory as background.
	// Same-named entries are deduped: persona wins.
	const engines: Array<{ engine: PresenceMemoryEngine | undefined; label: "persona" | "global" }> = [
		{ engine: state.personaMemEngine, label: "persona" },
		{ engine: state.memEngine, label: "global" },
	];

	// Per-source budgets: persona is the tightest slice since it's persona-specific.
	// Total cap stays close to the original single-source budget.
	const PREF_BUDGET = { persona: 2, global: 1 };
	const LESSON_BUDGET = { persona: 1, global: 1 };

	for (const { engine, label } of engines) {
		if (!engine) continue;
		try {
			const entries = await engine.getAllEntries();
			const prefBudget = PREF_BUDGET[label];
			const lessonBudget = LESSON_BUDGET[label];

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

			const prefCount = Math.min(prefBudget, prefPoolSorted.length);
			const prefSelected = prefPoolSorted.slice(0, prefCount);
			let prefAdded = 0;
			for (const pref of prefSelected) {
				if (prefAdded >= prefBudget) break;
				if (!rememberName(pref.name)) continue;
				const text = (pref.summary || pref.detail || pref.content || "").toString().slice(0, 80);
				if (text) {
					out.preferences.push(`${pref.name || "pref"}: ${text}`);
					prefAdded++;
				} else {
					// Roll back the name reservation since we didn't actually emit a line.
					seenNames.delete((pref.name || "").toLowerCase());
				}
			}

			const lessonPool = (entries.lessons || [])
				.filter((entry) => entry.type !== "preference")
				.filter((entry) => !entry.name || !seenNames.has(entry.name.toLowerCase()))
				.sort((a, b) => {
					const aRecent = a.name && recentlyReferenced.has(a.name) ? -1 : 0;
					const bRecent = b.name && recentlyReferenced.has(b.name) ? -1 : 0;
					return (bRecent - aRecent) || ((b.importance ?? 0) - (a.importance ?? 0));
				});

			const lessonCount = label === "persona"
				? Math.min(lessonBudget, lessonPool.length)
				: (Math.random() < 0.5 ? 0 : Math.min(lessonBudget, lessonPool.length));
			const lessonSelected = lessonPool.slice(0, lessonCount);
			let lessonAdded = 0;
			for (const lesson of lessonSelected) {
				if (lessonAdded >= lessonBudget) break;
				if (!rememberName(lesson.name)) continue;
				const text = (lesson.summary || lesson.detail || lesson.content || "").toString().slice(0, 80);
				if (text) {
					out.lessons.push(`${lesson.name || "lesson"}: ${text}`);
					lessonAdded++;
				} else {
					seenNames.delete((lesson.name || "").toLowerCase());
				}
			}
		} catch {
			// Per-source failure must not block the other source.
		}
	}

	if (state.recentlyReferencedMemories.length > 8) {
		state.recentlyReferencedMemories = state.recentlyReferencedMemories.slice(-8);
	}
	return out;
}

export async function collectIdentityPreferenceHighlights(state: PresenceMemoryState): Promise<string[]> {
	const out: string[] = [];
	const seen = new Set<string>();
	const tryPush = (entry: { name?: string; summary?: string; detail?: string; content?: string; tags?: string[] }) => {
		const text = (entry.summary || entry.detail || entry.content || "").toString().trim().replace(/\s+/g, " ");
		const label = (entry.name || "preference").toString().trim();
		const searchable = `${label} ${text} ${(entry.tags || []).join(" ")}`;
		if (!text || !IDENTITY_PREFERENCE_PATTERN.test(searchable)) return false;
		const line = `${label || "preference"}: ${text.slice(0, 160)}`;
		const key = line.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		out.push(line);
		return true;
	};

	// Persona-first. Each source contributes up to 3 lines, total capped at 5.
	const sources: Array<{ engine: PresenceMemoryEngine | undefined; budget: number }> = [
		{ engine: state.personaMemEngine, budget: 3 },
		{ engine: state.memEngine, budget: 3 },
	];

	for (const { engine, budget } of sources) {
		if (!engine || out.length >= 5) continue;
		try {
			const entries = await engine.getAllEntries();
			const prefPool = [
				...(entries.preferences ?? []),
				...entries.knowledge.filter((entry) => entry.type === "preference" || entry.tags.includes("preference")),
				...entries.lessons.filter((entry) => entry.type === "preference" || entry.tags.includes("preference")),
			].filter((entry) => entry.type === "preference" || entry.tags.includes("preference"));

			const searchResults = await engine.searchEntries(
				"tone style speaking call address persona role identity 称呼 语气 角色 扮演",
			);
			const candidates = [...prefPool, ...searchResults];
			let addedFromSource = 0;
			for (const entry of candidates) {
				if (out.length >= 5 || addedFromSource >= budget) break;
				if (tryPush(entry)) addedFromSource++;
			}
		} catch {
			// Per-source failure must not block the other source.
		}
	}

	return out;
}
