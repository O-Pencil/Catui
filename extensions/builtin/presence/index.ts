/**
 * [WHO]: Extension interface, AI-driven personalized greetings and idle cues
 * [FROM]: Depends on @catui/tui, core/extensions-host/types.js, core/platform/i18n, node:path, node:url, node:fs
 * [TO]: Loaded by core/extensions-host/loader.ts as extension entry point
 * [HERE]: extensions/builtin/presence/index.ts - AI-generated opening + idle presence lines from memory (episodes/preferences/lessons) + git snapshot (branch/last commit/changed files) + soul personality traits and identity/style preferences, injects last MAX_RECENT_PRESENCE lines into agent systemPrompt per turn, configurable via settings.presence.enabled, canSendOpening guards against agent-is-busy race
 */

import { Box, Container, Spacer, Text } from "@catui/tui";
import type { ExtensionAPI, ExtensionContext, SessionReadyEvent, SessionStartEvent } from "../../../core/extensions-host/types.js";
import { getLocale, tValue } from "../../../core/platform/i18n/index.js";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	collectIdentityPreferenceHighlights,
	collectMemoryHighlights,
	detectLanguageFromMemory,
	getMemoryDir,
	getPersonaMemoryDir,
	getProject,
	type PresenceMemoryEngine,
} from "./presence-memory.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const PRESENCE_MESSAGE_TYPE = "presence";
const OPENING_DELAY_MS = 1200;
const IDLE_POLL_MS = 15000;
const LONG_IDLE_MS = 4 * 60 * 1000;
const GREETING_TIMEOUT_MS = 8000;
const PRESENCE_DEBOUNCE_MS = 30_000;
const GIT_TIMEOUT_MS = 200;

/**
 * Read persona-specific presence lines from the active persona's CATUI.md.
 * Parses `## Presence` section for `### Opening Lines` or `### Idle Lines` blocks.
 * Returns empty array if no persona or no matching section found.
 */
function getPersonaPresenceLines(kind: "opening" | "idle"): string[] {
	const personaDir = process.env.NANO_PERSONA_DIR;
	if (!personaDir) return [];
	const catuiPath = join(personaDir, "CATUI.md");
	if (!existsSync(catuiPath)) return [];
	try {
		const content = readFileSync(catuiPath, "utf-8");
		const presenceMatch = content.match(/## Presence\s*\n([\s\S]*?)(?=\n## |\n# |$)/);
		if (!presenceMatch) return [];
		const presenceSection = presenceMatch[1]!;
		const heading = kind === "opening" ? "### Opening Lines" : "### Idle Lines";
		const blockMatch = presenceSection.match(
			new RegExp(`${heading}\\s*\\n([\\s\\S]*?)(?=\\n### |$)`),
		);
		if (!blockMatch) return [];
		return blockMatch[1]!
			.split("\n")
			.map((l) => l.replace(/^\s*-\s*/, "").trim())
			.filter((l) => l.length > 0);
	} catch {
		return [];
	}
}

const PERSONA_IDENTITY_HEADINGS = ["## Identity", "## Tone", "## Working Style"] as const;
const PERSONA_IDENTITY_MAX_CHARS = 1200;

/**
 * Read persona identity blocks (Identity / Tone / Working Style) from the active
 * persona's CATUI.md. These are persona-locked hard constraints — the model's
 * presence output must conform to them.
 *
 * Returns concatenated blocks, truncated to PERSONA_IDENTITY_MAX_CHARS.
 * Returns empty string when persona is missing or no matching sections found.
 *
 * Excludes `## Presence` (handled by getPersonaPresenceLines) and `## Example Interactions`
 * (kept terse on purpose; the examples can leak style choices that the LLM echoes
 * verbatim, which we don't want for short opening/idle lines).
 */
function loadPersonaIdentity(): string {
	const personaDir = process.env.NANO_PERSONA_DIR;
	if (!personaDir) return "";
	const catuiPath = join(personaDir, "CATUI.md");
	if (!existsSync(catuiPath)) return "";
	try {
		const content = readFileSync(catuiPath, "utf-8");
		const blocks: string[] = [];
		for (const heading of PERSONA_IDENTITY_HEADINGS) {
			const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const match = content.match(
				new RegExp(`${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n# |$)`),
			);
			if (!match) continue;
			const trimmed = match[1]!.trim();
			if (trimmed.length > 0) {
				blocks.push(`${heading}\n${trimmed}`);
			}
		}
		if (blocks.length === 0) return "";
		const joined = blocks.join("\n\n");
		if (joined.length <= PERSONA_IDENTITY_MAX_CHARS) return joined;
		return joined.slice(0, PERSONA_IDENTITY_MAX_CHARS) + "\n…";
	} catch {
		return "";
	}
}

// Fallback messages for when AI generation fails or memory is empty
function getFallbackOpeningLines(locale?: "en" | "zh"): string[] {
	const personaLines = getPersonaPresenceLines("opening");
	const useLocale = locale || getLocale();
	// Only use persona lines when their language matches the requested locale.
	// A Chinese-only persona should not leak its lines when the user is in English.
	if (personaLines.length > 0 && personaLinesMatchLocale(personaLines, useLocale)) {
		return personaLines;
	}
	if (!locale || useLocale === getLocale()) {
		const lines = tValue<string[]>("msg.presence.opening");
		if (Array.isArray(lines)) return lines;
	}
	// More human-like fallback messages
	if (useLocale === "zh") {
		return [
			"来了啊。",
			"嘿，有什么想做的吗？",
			"准备开始吧。",
			"随时可以开始。",
			"有什么要聊聊的吗？",
		];
	}
	return [
		"Hey, what's up?",
		"Ready when you are.",
		"What do you want to work on?",
		"Any ideas?",
		"Let's do this.",
	];
}

function getFallbackIdleLines(locale?: "en" | "zh"): string[] {
	const personaLines = getPersonaPresenceLines("idle");
	const useLocale = locale || getLocale();
	if (personaLines.length > 0 && personaLinesMatchLocale(personaLines, useLocale)) {
		return personaLines;
	}
	if (!locale || useLocale === getLocale()) {
		const lines = tValue<string[]>("msg.presence.idle");
		if (Array.isArray(lines)) return lines;
	}
	if (useLocale === "zh") {
		return [
			"还在，有需要随时说。",
			"不急，慢慢来。",
			"我在，随时继续。",
			"有空了就继续吧。",
			"没关系的，想什么时候继续都行。",
		];
	}
	return [
		"Still here when you need me.",
		"No rush, take your time.",
		"Ready when you are.",
		"I'll be here.",
		"Whenever you're ready.",
	];
}

/**
 * Heuristic: do the persona presence lines primarily use the requested locale's script?
 * Used so a Chinese-only persona does not leak Chinese lines when the user is in English.
 * Count Chinese characters vs Latin word tokens across the lines.
 */
function personaLinesMatchLocale(lines: readonly string[], locale: "en" | "zh"): boolean {
	if (lines.length === 0) return false;
	let chinese = 0;
	let latin = 0;
	for (const line of lines) {
		chinese += (line.match(/[一-鿿]/g) || []).length;
		latin += (line.match(/[A-Za-z]+/g) || []).length;
	}
	if (locale === "zh") return chinese >= latin;
	return latin >= chinese;
}

type PresenceState = {
	lastActivityAt: number;
	idleReminderSent: boolean;
	openingStartedAt?: number;
	openingSent: boolean;
	openingTimer?: ReturnType<typeof setTimeout>;
	idleTimer?: ReturnType<typeof setInterval>;
	unsubscribeInput?: () => void;
	memEngine?: PresenceMemoryEngine;
	personaMemEngine?: PresenceMemoryEngine;
	recentPresenceLines: string[]; // Last few presence lines (max 3) for per-turn agent injection
	lastPresenceAt?: number; // Timestamp of last sendPresence (debounce)
	idleGenerating?: boolean; // In-flight lock for async idle generation
	recentlyReferencedMemories: string[]; // Track recently referenced memory names to avoid repetition
	awakening?: string; // Cached awakening text (generated once per session)
	awakeningGenerated?: boolean; // Guard against multiple generation attempts
};

const MAX_RECENT_PRESENCE = 3;

function createState(): PresenceState {
	return {
		lastActivityAt: Date.now(),
		idleReminderSent: false,
		openingSent: false,
		recentPresenceLines: [],
		recentlyReferencedMemories: [],
		awakening: undefined,
		awakeningGenerated: false,
	};
}

function getBundledPackageCandidates(packageName: "mem-core" | "soul-core"): string[] {
	return [
		join(__dirname, "..", "..", "..", "packages", packageName),
		join(process.cwd(), "dist", "packages", packageName),
		join(process.cwd(), "packages", packageName, "dist"),
	];
}

function resolveBundledPackageEntry(packageName: "mem-core" | "soul-core"): string | undefined {
	for (const dir of getBundledPackageCandidates(packageName)) {
		const entry = join(dir, "index.js");
		if (existsSync(entry)) return realpathSync(entry);
	}
	return undefined;
}

function getOpeningDelayMs(): number {
	const raw = process.env.CATUI_PRESENCE_OPENING_DELAY_MS;
	if (!raw) return OPENING_DELAY_MS;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : OPENING_DELAY_MS;
}

async function importRuntimeModule<T>(
	moduleNames: string[],
	bundledPackageName?: "mem-core" | "soul-core",
): Promise<T | undefined> {
	if (bundledPackageName) {
		const bundledEntry = resolveBundledPackageEntry(bundledPackageName);
		if (bundledEntry) {
			try {
				return await import(pathToFileURL(bundledEntry).href) as T;
			} catch {
				// Fall through to package-name resolution.
			}
		}
	}

	for (const moduleName of moduleNames) {
		try {
			return await import(moduleName) as T;
		} catch {
			// Try the next runtime candidate.
		}
	}

	return undefined;
}

type PresenceSoulHints = {
	traits: string[];
	tone?: string;
	identityPreferences: string[];
};

function normalizePreferenceText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.trim().replace(/\s+/g, " ");
	return text ? text.slice(0, 160) : undefined;
}

function collectSoulHints(soulManager: unknown): PresenceSoulHints {
	const out: PresenceSoulHints = { traits: [], identityPreferences: [] };
	if (!soulManager || typeof soulManager !== "object") return out;
	try {
		const profile = (soulManager as { getProfile?: () => unknown }).getProfile?.();
		const personality = (profile as any)?.personality;
		if (personality && typeof personality === "object") {
			const top = Object.entries(personality)
				.filter(([, v]) => typeof v === "number")
				.sort((a, b) => (b[1] as number) - (a[1] as number))
				.slice(0, 3)
				.map(([k, v]) => `${k}:${(v as number).toFixed(2)}`);
			out.traits = top;
		}
		const mood = (profile as any)?.emotionalState?.mood;
		if (typeof mood === "string") out.tone = mood;
		const knownPreferences = (profile as any)?.userRelationship?.knownPreferences;
		if (Array.isArray(knownPreferences)) {
			out.identityPreferences = knownPreferences
				.map(normalizePreferenceText)
				.filter((text): text is string => Boolean(text))
				.slice(0, 5);
		}
	} catch {
		/* fail-soft */
	}
	return out;
}

function mergeIdentityPreferences(...groups: readonly string[][]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const group of groups) {
		for (const value of group) {
			const text = normalizePreferenceText(value);
			if (!text) continue;
			const key = text.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(text);
			if (out.length >= 5) return out;
		}
	}
	return out;
}

function touch(state: PresenceState): void {
	state.lastActivityAt = Date.now();
	state.idleReminderSent = false;
}

function clearTimers(state: PresenceState): void {
	if (state.openingTimer) {
		clearTimeout(state.openingTimer);
		state.openingTimer = undefined;
	}
	if (state.idleTimer) {
		clearInterval(state.idleTimer);
		state.idleTimer = undefined;
	}
	state.unsubscribeInput?.();
	state.unsubscribeInput = undefined;
}

async function initMemEngine(
	state: PresenceState,
	kind: "global" | "persona" = "global",
): Promise<void> {
	if (kind === "persona" && state.personaMemEngine) return;
	if (kind === "global" && state.memEngine) return;
	const memoryDir = kind === "persona" ? getPersonaMemoryDir() : getMemoryDir();
	if (kind === "persona" && !memoryDir) {
		// Persona has no memory dir; do not init an engine.
		state.personaMemEngine = undefined;
		return;
	}
	try {
		const memModule = await importRuntimeModule<{
			NanoMemEngine: new (config: unknown) => NonNullable<PresenceState["memEngine"]>;
			getConfig: (options: { memoryDir: string; locale: "en" | "zh" }) => unknown;
		}>(["catui-mem"], "mem-core");
		if (!memModule?.NanoMemEngine || !memModule.getConfig) {
			if (kind === "persona") state.personaMemEngine = undefined;
			else state.memEngine = undefined;
			return;
		}
		const { NanoMemEngine, getConfig } = memModule;
		const config = getConfig({ memoryDir: memoryDir!, locale: getLocale() === "zh" ? "zh" : "en" });
		const engine = new NanoMemEngine(config) as NonNullable<PresenceState["memEngine"]>;
		if (kind === "persona") state.personaMemEngine = engine;
		else state.memEngine = engine;
	} catch {
		// NanoMem not available, use fallback messages
		if (kind === "persona") state.personaMemEngine = undefined;
		else state.memEngine = undefined;
	}
}

type ProjectSnapshot = { name: string; branch?: string; lastCommit?: string; changedFiles: string[] };

async function collectProjectSnapshot(): Promise<ProjectSnapshot> {
	const cwd = process.cwd();
	const snap: ProjectSnapshot = { name: getProject(), changedFiles: [] };
	const deadline = Date.now() + 350;
	const tryGit = async (args: string[]) => {
		if (Date.now() > deadline) return undefined;
		try {
			const { stdout } = await execFileAsync("git", args, { cwd, timeout: GIT_TIMEOUT_MS });
			return stdout.trim() || undefined;
		} catch {
			return undefined;
		}
	};
	snap.branch = await tryGit(["rev-parse", "--abbrev-ref", "HEAD"]);
	snap.lastCommit = await tryGit(["log", "-1", "--format=%s"]);
	if (snap.lastCommit && snap.lastCommit.length > 80) snap.lastCommit = snap.lastCommit.slice(0, 80);
	const status = await tryGit(["status", "--porcelain"]);
	if (status) {
		snap.changedFiles = status
			.split("\n")
			.map((l) => l.trim())
			// Filter out untracked directories (e.g., "?? newfolder/") - these are trivial actions
			// like creating an empty folder, not meaningful work worth commenting on
			.filter((l) => {
				if (!l) return false;
				// xy path format: first two chars are status codes
				const xy = l.slice(0, 2);
				const path = l.slice(3);
				// Skip untracked items that are just empty directories
				if (xy === "??" && path.endsWith("/")) return false;
				// Only include modified/staged/renamed/deleted - meaningful changes
				// "??" = untracked, "!" = ignored
				if (xy === "??" || xy === "!!") return false;
				return true;
			})
			.map((l) => l.split(/\s+/).slice(-1)[0] || "")
			.filter(Boolean)
			.slice(0, 5);
	}
	return snap;
}

async function buildGreetingPrompt(
	state: PresenceState,
	detectedLocale: "en" | "zh",
	soulHints: PresenceSoulHints,
	kind: "opening" | "idle" = "opening",
	lastUserMessage?: string,
): Promise<string | undefined> {
	if (!state.memEngine && !state.personaMemEngine) return undefined;

	try {
		// Get recent episodes from persona memory first, then global, deduped by date.
		const personaEpisodes = state.personaMemEngine ? await state.personaMemEngine.getAllEpisodes() : [];
		const globalEpisodes = state.memEngine ? await state.memEngine.getAllEpisodes() : [];
		const seenDates = new Set<string>();
		const episodes = [...personaEpisodes, ...globalEpisodes].filter((ep) => {
			if (!ep.date) return false;
			if (seenDates.has(ep.date)) return false;
			seenDates.add(ep.date);
			return true;
		});
		const recentEpisodes = episodes
			.filter((ep) => !ep.consolidated)
			.sort((a, b) => {
				const aTime = a.endedAt || a.startedAt || "";
				const bTime = b.endedAt || b.startedAt || "";
				return bTime.localeCompare(aTime);
			})
			.slice(0, 3);

		const highlights = await collectMemoryHighlights(state);
		const snapshot = await collectProjectSnapshot();
		const project = snapshot.name;
		const now = new Date();
		const timeOfDay = now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening";

		if (detectedLocale === "zh") {
			const lines: string[] = [
				kind === "opening"
					? "根据下面的上下文，生成一句开场问候语。"
					: "用户安静了几分钟。轻轻问候一下，别打扰他。一句话就够。",
				"",
				"约束分级（按优先级）:",
				"[1] 最高优先级 — persona 锁定的人格（system prompt 已注入）。必须严格遵守。",
				"[2] 中优先级 — soul 演化的偏好。与 persona 不冲突时遵循；冲突时被 persona 覆盖。",
				"[3] 背景参考 — 记忆、经验、episodes。提供话题，不强制语气。",
				"",
				"要求:",
				"- 简短自然，不要太正式",
				kind === "idle" ? "- 不要重复你之前说过的开场白" : "- 如果有上下文，可以自然提一句",
				"- 不要为了有话说而硬找话题",
				"- 如果他只是在做很琐碎的事情，不需要特别提起，简单打个招呼就好",
				"- 不要反复提同样的记忆或概念，要换着花样",
				"",
				"项目状态:",
				`项目: ${project}`,
				...(snapshot.branch ? [`分支: ${snapshot.branch}`] : []),
				...(snapshot.lastCommit ? [`最近提交: ${snapshot.lastCommit}`] : []),
				`时间: ${now.toLocaleDateString("zh-CN", { weekday: "long", hour: "2-digit", minute: "2-digit" })}`,
			];

			if (recentEpisodes.length > 0) {
				lines.push("", "[3] 最近在做（背景参考）:");
				for (const ep of recentEpisodes.slice(0, 2)) {
					const summary = ep.summary?.slice(0, 80) || "无摘要";
					lines.push(`- ${summary}`);
				}
			}

			if (highlights.preferences.length > 0) {
				lines.push("", "[3] 你知道他的偏好（背景参考）:");
				for (const p of highlights.preferences) lines.push(`- ${p}`);
			}
			if (soulHints.identityPreferences.length > 0) {
				lines.push("", "[2] Soul 演化的偏好（中优先级，和 persona 不冲突时遵循）:");
				for (const p of soulHints.identityPreferences) lines.push(`- ${p}`);
			}
			if (highlights.lessons.length > 0) {
				lines.push("", "[3] 记下的经验（背景参考）:");
				for (const l of highlights.lessons) lines.push(`- ${l}`);
			}

			if (snapshot.changedFiles.length > 0) {
				lines.push("", "他正在改的文件:");
				for (const f of snapshot.changedFiles) lines.push(`- ${f}`);
			}

			if (soulHints.traits.length > 0) {
				lines.push("", `[2] Soul 人格倾向（中优先级参考）: ${soulHints.traits.join(", ")}${soulHints.tone ? ` (心情: ${soulHints.tone})` : ""}`);
			}

			if (state.recentPresenceLines.length > 0) {
				lines.push("", "你之前刚说过的（别重复）:");
				for (const l of state.recentPresenceLines) lines.push(`- ${l}`);
			}

			if (kind === "idle" && lastUserMessage) {
				lines.push("", `他最后说的是: "${lastUserMessage.slice(0, 120)}"`);
			}

			lines.push("", "直接说问候语，别加引号。");

			return lines.join("\n");
		} else {
			const lines: string[] = [
				kind === "opening"
					? "Generate a casual opening greeting based on the context below."
					: "The user has been quiet for a few minutes. Drop a soft, non-pushy check-in. One short sentence.",
				"",
				"Constraint priorities (highest first):",
				"[1] Persona-locked identity (already in system prompt). Must follow strictly.",
				"[2] Soul-evolved preferences. Follow when not conflicting with [1]; override [1] never.",
				"[3] Background reference: memory, lessons, episodes. Topic source, not style.",
				"",
				"Requirements:",
				"- Keep it short and natural, not formal",
				kind === "idle" ? "- Do NOT repeat your earlier opening greeting" : "- If there's recent context, mention it naturally",
				"- Don't force a topic just to have something to say",
				"- If they're only doing trivial things (like creating an empty folder), don't mention it - just say hi",
				"- Don't keep bringing up the same memories or concepts repeatedly",
				"",
				"Project state:",
				`Project: ${project}`,
				...(snapshot.branch ? [`Branch: ${snapshot.branch}`] : []),
				...(snapshot.lastCommit ? [`Last commit: ${snapshot.lastCommit}`] : []),
				`Time: ${now.toLocaleDateString("en-US", { weekday: "long", hour: "2-digit", minute: "2-digit" })} (${timeOfDay})`,
			];

			if (recentEpisodes.length > 0) {
				lines.push("", "[3] Recently worked on (background reference):");
				for (const ep of recentEpisodes.slice(0, 2)) {
					const summary = ep.summary?.slice(0, 80) || "No summary";
					lines.push(`- ${summary}`);
				}
			}

			if (highlights.preferences.length > 0) {
				lines.push("", "[3] What you know about them (background reference):");
				for (const p of highlights.preferences) lines.push(`- ${p}`);
			}
			if (soulHints.identityPreferences.length > 0) {
				lines.push("", "[2] Soul-evolved preferences (medium priority, follow when not conflicting with persona):");
				for (const p of soulHints.identityPreferences) lines.push(`- ${p}`);
			}
			if (highlights.lessons.length > 0) {
				lines.push("", "[3] Lessons remembered (background reference):");
				for (const l of highlights.lessons) lines.push(`- ${l}`);
			}

			if (snapshot.changedFiles.length > 0) {
				lines.push("", "Files they're currently editing:");
				for (const f of snapshot.changedFiles) lines.push(`- ${f}`);
			}

			if (soulHints.traits.length > 0) {
				lines.push("", `[2] Soul personality tilt (medium priority reference): ${soulHints.traits.join(", ")}${soulHints.tone ? ` (mood: ${soulHints.tone})` : ""}`);
			}

			if (state.recentPresenceLines.length > 0) {
				lines.push("", "What you already said recently (don't repeat):");
				for (const l of state.recentPresenceLines) lines.push(`- ${l}`);
			}

			if (kind === "idle" && lastUserMessage) {
				lines.push("", `Their last message was: "${lastUserMessage.slice(0, 120)}"`);
			}

			lines.push("", "Just say the line, no quotes.");

			return lines.join("\n");
		}
	} catch (e) {
		if (process.env.CATUI_DEBUG_PRESENCE) {
			// eslint-disable-next-line no-console
			console.error("[presence] buildGreetingPrompt failed:", e);
		}
		return undefined;
	}
}

function buildPresenceSystemPrompt(
	locale: "en" | "zh",
	soulHints: PresenceSoulHints,
	kind: "opening" | "idle",
): string {
	const personaIdentity = loadPersonaIdentity();
	const personaBlock = personaIdentity
		? `\n\n[Persona Identity — highest priority, persona-locked]\n${personaIdentity}\n[/Persona Identity]`
		: "";

	const traitsHint = soulHints.traits.length > 0
		? ` ${locale === "zh" ? "Soul 人格倾向（中优先级，参考）" : "Soul personality tilt (medium priority, reference)"}: ${soulHints.traits.map((t) => t.split(":")[0]).join(", ")}.`
		: "";
	const identityHint = soulHints.identityPreferences.length > 0
		? ` ${locale === "zh" ? "Soul 演化偏好（中优先级，和 persona 不冲突时遵循）" : "Soul-evolved preferences (medium priority, follow when not conflicting with persona)"}: ${soulHints.identityPreferences.join(" | ")}.`
		: "";

	if (locale === "zh") {
		return kind === "opening"
			? `生成一句简短自然的开场问候。先遵守 persona 锁定的人格，再考虑 soul 风格。${personaBlock}${identityHint}${traitsHint}`
			: `生成一句简短、轻声、不打扰的问候。先遵守 persona 锁定的人格，再考虑 soul 风格。${personaBlock}${identityHint}${traitsHint}`;
	}
	return kind === "opening"
		? `Generate one brief, natural opening greeting. Follow the persona-locked identity first, then the soul style hints.${personaBlock}${identityHint}${traitsHint}`
		: `Generate one brief, quiet, non-pushy check-in. Follow the persona-locked identity first, then the soul style hints.${personaBlock}${identityHint}${traitsHint}`;
}

function getLastUserMessage(ctx: ExtensionContext): string | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i] as any;
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (!message || message.role !== "user") continue;
		const c = message.content;
		if (typeof c === "string") return c;
		if (Array.isArray(c)) {
			const text = c.find((p: any) => p?.type === "text")?.text;
			if (typeof text === "string") return text;
		}
		return undefined;
	}
	return undefined;
}

async function generatePresenceLine(
	api: ExtensionAPI,
	ctx: ExtensionContext,
	state: PresenceState,
	kind: "opening" | "idle",
): Promise<string> {
	const detectedLocale = await detectLanguageFromMemory(state);
	const locale = (detectedLocale || getLocale()) as "en" | "zh";
	const fallback = () =>
		pickLine(
			kind === "opening" ? getFallbackOpeningLines(locale) : getFallbackIdleLines(locale),
			Date.now(),
		);
	if (!ctx.model) return fallback();
	const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
	if (!apiKey) return fallback();

	const lastUser = kind === "idle" ? getLastUserMessage(ctx) : undefined;
	const soulHints = collectSoulHints(ctx.getSoulManager());
	const memoryIdentityPreferences = await collectIdentityPreferenceHighlights(state);
	const presenceHints: PresenceSoulHints = {
		...soulHints,
		identityPreferences: mergeIdentityPreferences(
			soulHints.identityPreferences,
			memoryIdentityPreferences,
		),
	};
	const promptPair = await buildPresencePromptPair(
		state,
		locale,
		presenceHints,
		kind,
		lastUser,
	);
	if (!promptPair) return fallback();

	const { systemPrompt, userPrompt: prompt } = promptPair;

	try {
		const line = await ctx.completeSimple(systemPrompt, prompt);
		if (line && line.trim().length > 0 && line.trim().length < 200) {
			return line.trim();
		}
	} catch {
		/* fall through */
	}
	return fallback();
}

function countConversationEntries(ctx: ExtensionContext): number {
	return ctx.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "message" || entry.type === "custom_message").length;
}

function getLastConversationTimestamp(ctx: ExtensionContext): number | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry.type !== "message" && entry.type !== "custom_message") continue;
		const timestamp = Date.parse(entry.timestamp);
		if (Number.isFinite(timestamp)) {
			return timestamp;
		}
	}
	return undefined;
}

function hasDraftText(ctx: ExtensionContext): boolean {
	if (!ctx.hasUI) return false;
	try {
		return ctx.ui.getEditorText().trim().length > 0;
	} catch {
		return false;
	}
}

function canSendPresence(ctx: ExtensionContext): boolean {
	return ctx.hasUI && ctx.isIdle() && !ctx.hasPendingMessages() && !hasDraftText(ctx);
}

function canSendOpening(ctx: ExtensionContext): boolean {
	return ctx.hasUI && ctx.isIdle() && !ctx.hasPendingMessages() && !hasDraftText(ctx);
}

function pickLine(lines: readonly string[], seed: number): string {
	const index = Math.abs(seed) % lines.length;
	return lines[index] ?? lines[0]!;
}

function sendPresence(api: ExtensionAPI, state: PresenceState, line: string): void {
	const now = Date.now();
	if (state.lastPresenceAt && now - state.lastPresenceAt < PRESENCE_DEBOUNCE_MS) {
		return;
	}
	api.sendMessage({
		customType: PRESENCE_MESSAGE_TYPE,
		content: line,
		display: true,
	});
	state.recentPresenceLines.push(line);
	if (state.recentPresenceLines.length > MAX_RECENT_PRESENCE) {
		state.recentPresenceLines.splice(0, state.recentPresenceLines.length - MAX_RECENT_PRESENCE);
	}
	state.lastPresenceAt = now;
	touch(state);
}

async function maybeSendOpening(
	api: ExtensionAPI,
	ctx: ExtensionContext,
	state: PresenceState,
): Promise<boolean> {
	if (state.openingSent) return true;
	if (!canSendOpening(ctx)) return false;

	// Initialize memory + soul engines if not already done
	await initMemEngine(state, "global");
	await initMemEngine(state, "persona");

	// Generate AI-powered greeting
	const greeting = await generatePresenceLine(api, ctx, state, "opening");
	sendPresence(api, state, greeting);
	state.openingSent = true;
	return true;
}

function scheduleOpening(
	api: ExtensionAPI,
	ctx: ExtensionContext,
	state: PresenceState,
	delayMs: number,
): void {
	state.openingTimer = setTimeout(async () => {
		const sent = await maybeSendOpening(api, ctx, state);
		if (sent) {
			state.openingTimer = undefined;
			return;
		}
		if (!state.openingStartedAt || Date.now() - state.openingStartedAt >= GREETING_TIMEOUT_MS) {
			state.openingTimer = undefined;
			return;
		}
		scheduleOpening(api, ctx, state, 500);
	}, delayMs);
}

function maybeSendIdleReminder(api: ExtensionAPI, ctx: ExtensionContext, state: PresenceState): void {
	if (state.idleReminderSent) return;
	if (state.idleGenerating) return;
	if (!canSendPresence(ctx)) return;
	if (Date.now() - state.lastActivityAt < LONG_IDLE_MS) return;
	state.idleGenerating = true;
	void (async () => {
		try {
			await initMemEngine(state, "global");
			await initMemEngine(state, "persona");
			const line = await generatePresenceLine(api, ctx, state, "idle");
			if (canSendPresence(ctx)) {
				sendPresence(api, state, line);
				state.idleReminderSent = true;
			}
		} finally {
			state.idleGenerating = false;
		}
	})();
}

/**
 * Generate awakening text once per session.
 * Fire-and-forget: best-effort, fail-soft, no retry.
 * Cost: ~450 tokens (one completeSimple call).
 */
async function generateAwakening(
	ctx: ExtensionContext,
	state: PresenceState,
): Promise<void> {
	if (state.awakeningGenerated) return;
	state.awakeningGenerated = true;

	if (!ctx.model) return;
	const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
	if (!apiKey) return;

	await initMemEngine(state, "global");
	await initMemEngine(state, "persona");

	try {
		const episodes = state.memEngine
			? await state.memEngine.getAllEpisodes()
			: [];
		const recentEpisodes = episodes
			.filter((ep) => ep.date && !ep.consolidated)
			.sort((a, b) => {
				const aTime = a.endedAt || a.startedAt || "";
				const bTime = b.endedAt || b.startedAt || "";
				return bTime.localeCompare(aTime);
			})
			.slice(0, 3);

		const snapshot = await collectProjectSnapshot();
		const soulHints = collectSoulHints(ctx.getSoulManager());
		const now = new Date();

		const contextLines: string[] = [
			`Date: ${now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`,
			`Time: ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`,
			`Project: ${snapshot.name}`,
		];

		if (soulHints.traits.length > 0) {
			contextLines.push(`Personality leanings: ${soulHints.traits.join(", ")}`);
		}
		if (soulHints.tone) {
			contextLines.push(`Current mood: ${soulHints.tone}`);
		}
		if (soulHints.identityPreferences.length > 0) {
			contextLines.push(`Identity/role constraints: ${soulHints.identityPreferences.join(" | ")}`);
		}

		if (recentEpisodes.length > 0) {
			contextLines.push("", "Recent sessions:");
			for (const ep of recentEpisodes) {
				const summary = ep.summary?.slice(0, 80) || "working on something";
				const date = ep.date || "";
				contextLines.push(`- [${date}] ${summary}`);
			}
		}

		if (snapshot.branch) {
			contextLines.push(`Current branch: ${snapshot.branch}`);
		}
		if (snapshot.lastCommit) {
			contextLines.push(`Last commit: ${snapshot.lastCommit}`);
		}

		const systemPrompt = [
			"You are an AI with continuity across sessions.",
			"Generate 2-3 brief internal thoughts (first person) as you orient yourself for this session.",
			"Natural, warm, curious. Not a status report. Not performative.",
			"Show you remember recent work and feel oriented in time.",
			"Just the thoughts, nothing else.",
		].join("\n");

		const userPrompt = contextLines.join("\n");

		const result = await ctx.completeSimple(systemPrompt, userPrompt);
		if (result && result.trim().length > 0 && result.trim().length < 400) {
			state.awakening = result.trim();
		}
	} catch {
		// Best effort; no awakening is fine
	}
}

function startPresenceLoop(
	api: ExtensionAPI,
	_event: SessionStartEvent,
	ctx: ExtensionContext,
	state: PresenceState,
): void {
	clearTimers(state);
	touch(state);
	state.openingSent = false;
	state.openingStartedAt = Date.now();

	// Check if presence is enabled (default: true for backward compatibility)
	const settings = ctx.getSettings?.();
	const presenceEnabled = settings?.presence?.enabled ?? true;
	if (!presenceEnabled) return;

	if (!ctx.hasUI) return;

	// Generate awakening once per session (fire-and-forget, best-effort)
	void generateAwakening(ctx, state);

	state.unsubscribeInput = ctx.ui.onTerminalInput((data) => {
		if (data.length > 0) {
			touch(state);
		}
		return undefined;
	});

	state.idleTimer = setInterval(() => {
		maybeSendIdleReminder(api, ctx, state);
	}, IDLE_POLL_MS);
}

function handleSessionReady(
	api: ExtensionAPI,
	_event: SessionReadyEvent,
	ctx: ExtensionContext,
	state: PresenceState,
): void {
	if (!ctx.hasUI || state.openingSent) return;
	// Check if presence is enabled (default: true)
	const settings = ctx.getSettings?.();
	const presenceEnabled = settings?.presence?.enabled ?? true;
	if (!presenceEnabled) return;
	state.openingStartedAt = Date.now();
	scheduleOpening(api, ctx, state, getOpeningDelayMs());
}

export default async function presenceExtension(api: ExtensionAPI) {
	const state = createState();

	api.registerMessageRenderer(PRESENCE_MESSAGE_TYPE, (message, _options, theme) => {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("\n");

		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(theme.fg("dim", text), 0, 0));

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	api.on("session_start", (event, ctx) => {
		startPresenceLoop(api, event, ctx, state);
	});

	api.on("session_ready", (event, ctx) => {
		handleSessionReady(api, event, ctx, state);
	});

	// Inject the latest presence line into the agent's system prompt every turn,
	// so the main conversation always perceives what presence said to the user.
	// Important: clearly state that presence is an independent subsystem, NOT the main agent.
	api.on("before_agent_start", (event) => {
		const sections: string[] = [];

		// Awakening: private orientation thoughts (generated once per session)
		if (state.awakening) {
			sections.push(
				[
					"## Your Internal Orientation",
					"",
					"These are your private thoughts as you begin this session.",
					"Let them subtly shape your tone and awareness. Never mention them explicitly to the user.",
					"",
					state.awakening,
				].join("\n"),
			);
		}

		// Presence lines: external messages from the presence subsystem
		const lines = state.recentPresenceLines;
		if (lines.length) {
			const list = lines.map((l) => `- "${l}"`).join("\n");
			sections.push(
				[
					"## Recent Presence Lines",
					"",
					"The presence extension (an independent subsystem that handles greetings and idle",
					"reminders, separate from your main conversation thread) recently displayed these",
					"messages to the user:",
					"",
					list,
					"",
					"Key points:",
					"- These messages were NOT generated by you (the main agent)",
					"- They appear in the UI but are excluded from conversation history",
					"- The user may respond to these as if continuing a casual chat",
					"",
					"If the user's message seems to respond to these lines (e.g., \"好啊\", \"开始吧\",",
					"\"嗯\", \"okay\", \"sure\"), acknowledge naturally without repeating them verbatim.",
					"Do NOT treat these as your own previous responses.",
				].join("\n"),
			);
		}

		if (sections.length === 0) return undefined;
		return { appendSystemPrompt: "\n" + sections.join("\n\n") + "\n" };
	});

	api.on("input", () => {
		touch(state);
	});

	api.on("agent_start", () => {
		touch(state);
	});

	api.on("agent_end", () => {
		touch(state);
	});

	api.on("tool_execution_start", () => {
		touch(state);
	});

	api.on("tool_execution_end", () => {
		touch(state);
	});

	api.on("tool_call", () => {
		touch(state);
	});

	api.on("message_end", () => {
		touch(state);
	});

	api.on("session_shutdown", () => {
		clearTimers(state);
	});
}

/**
 * Test-only helper: assemble the (systemPrompt, userPrompt) pair that generatePresenceLine
 * would feed to ctx.completeSimple, without actually invoking the LLM. This lets tests
 * verify the prompt wiring (persona-locked identity, priority labels, soul de-prioritization,
 * layered memory) end-to-end without spinning up a model.
 */
async function buildPresencePromptPair(
	state: PresenceState,
	locale: "en" | "zh",
	soulHints: PresenceSoulHints,
	kind: "opening" | "idle",
	lastUserMessage?: string,
): Promise<{ systemPrompt: string; userPrompt: string } | undefined> {
	const userPrompt = await buildGreetingPrompt(state, locale, soulHints, kind, lastUserMessage);
	if (!userPrompt) return undefined;
	const systemPrompt = buildPresenceSystemPrompt(locale, soulHints, kind);
	return { systemPrompt, userPrompt };
}

export const __testUtils = {
	getFallbackOpeningLines,
	getFallbackIdleLines,
	getPersonaPresenceLines,
	loadPersonaIdentity,
	personaLinesMatchLocale,
	resolveBundledPackageEntry,
	importRuntimeModule,
	detectLanguageFromMemory,
	collectIdentityPreferenceHighlights,
	getOpeningDelayMs,
	collectSoulHints,
	buildPresenceSystemPrompt,
	buildPresencePromptPair,
};
