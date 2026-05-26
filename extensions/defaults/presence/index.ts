/**
 * [WHO]: Extension interface, AI-driven personalized greetings and idle cues
 * [FROM]: Depends on @pencil-agent/tui, core/extensions/types.js, core/i18n, node:path, node:url, node:fs
 * [TO]: Loaded by core/extensions/loader.ts as extension entry point
 * [HERE]: extensions/defaults/presence/index.ts - AI-generated opening + idle presence lines from memory (episodes/preferences/lessons) + git snapshot (branch/last commit/changed files) + soul personality traits, injects last MAX_RECENT_PRESENCE lines into agent systemPrompt per turn, configurable via settings.presence.enabled, canSendOpening guards against agent-is-busy race
 */

import { Box, Container, Spacer, Text } from "@pencil-agent/tui";
import type { ExtensionAPI, ExtensionContext, SessionReadyEvent, SessionStartEvent } from "../../../core/extensions/types.js";
import { getLocale, tValue } from "../../../core/i18n/index.js";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	collectMemoryHighlights,
	detectLanguageFromMemory,
	getMemoryDir,
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

// Fallback messages for when AI generation fails or memory is empty
function getFallbackOpeningLines(locale?: "en" | "zh"): string[] {
	const useLocale = locale || getLocale();
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
	const useLocale = locale || getLocale();
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

type PresenceState = {
	lastActivityAt: number;
	idleReminderSent: boolean;
	openingStartedAt?: number;
	openingSent: boolean;
	openingTimer?: ReturnType<typeof setTimeout>;
	idleTimer?: ReturnType<typeof setInterval>;
	unsubscribeInput?: () => void;
	memEngine?: PresenceMemoryEngine;
	recentPresenceLines: string[]; // Last few presence lines (max 3) for per-turn agent injection
	lastPresenceAt?: number; // Timestamp of last sendPresence (debounce)
	idleGenerating?: boolean; // In-flight lock for async idle generation
	recentlyReferencedMemories: string[]; // Track recently referenced memory names to avoid repetition
};

const MAX_RECENT_PRESENCE = 3;

function createState(): PresenceState {
	return {
		lastActivityAt: Date.now(),
		idleReminderSent: false,
		openingSent: false,
		recentPresenceLines: [],
		recentlyReferencedMemories: [],
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
	const raw = process.env.NANOPENCIL_PRESENCE_OPENING_DELAY_MS;
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

function collectSoulHints(soulManager: unknown): { traits: string[]; tone?: string } {
	const out: { traits: string[]; tone?: string } = { traits: [] };
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
	} catch {
		/* fail-soft */
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

async function initMemEngine(state: PresenceState): Promise<void> {
	if (state.memEngine) return;
	try {
		const memModule = await importRuntimeModule<{
			NanoMemEngine: new (config: unknown) => NonNullable<PresenceState["memEngine"]>;
			getConfig: (options: { memoryDir: string; locale: "en" | "zh" }) => unknown;
		}>(["@pencil-agent/mem-core"], "mem-core");
		if (!memModule?.NanoMemEngine || !memModule.getConfig) {
			state.memEngine = undefined;
			return;
		}
		const { NanoMemEngine, getConfig } = memModule;
		const memoryDir = getMemoryDir();
		const config = getConfig({ memoryDir, locale: getLocale() === "zh" ? "zh" : "en" });
		state.memEngine = new NanoMemEngine(config);
	} catch {
		// NanoMem not available, use fallback messages
		state.memEngine = undefined;
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
	soulHints: { traits: string[]; tone?: string },
	kind: "opening" | "idle" = "opening",
	lastUserMessage?: string,
): Promise<string | undefined> {
	if (!state.memEngine) return undefined;

	try {
		// Get recent episodes for context
		const episodes = await state.memEngine.getAllEpisodes();
		const recentEpisodes = episodes
			.filter((ep) => ep.date && !ep.consolidated)
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
				"要求:",
				"- 像老朋友一样自然，不要太正式",
				"- 简短随意",
				kind === "idle" ? "- 不要重复你之前说过的开场白" : "- 如果有上下文，可以自然提一句",
				"- 不要为了有话说而硬找话题",
				"- 如果他只是在做很琐碎的事情，不需要特别提起，简单打个招呼就好",
				"- 偏好和经验只是背景参考，不需要每次都引用，只在真正自然的时候带一句",
				"- 不要反复提同样的记忆或概念，要换着花样",
				"",
				"项目状态:",
				`项目: ${project}`,
				...(snapshot.branch ? [`分支: ${snapshot.branch}`] : []),
				...(snapshot.lastCommit ? [`最近提交: ${snapshot.lastCommit}`] : []),
				`时间: ${now.toLocaleDateString("zh-CN", { weekday: "long", hour: "2-digit", minute: "2-digit" })}`,
			];

			if (recentEpisodes.length > 0) {
				lines.push("", "最近在做:");
				for (const ep of recentEpisodes.slice(0, 2)) {
					const summary = ep.summary?.slice(0, 80) || "无摘要";
					lines.push(`- ${summary}`);
				}
			}

			if (highlights.preferences.length > 0) {
				lines.push("", "你知道他的偏好:");
				for (const p of highlights.preferences) lines.push(`- ${p}`);
			}
			if (highlights.lessons.length > 0) {
				lines.push("", "记下的经验:");
				for (const l of highlights.lessons) lines.push(`- ${l}`);
			}

			if (snapshot.changedFiles.length > 0) {
				lines.push("", "他正在改的文件:");
				for (const f of snapshot.changedFiles) lines.push(`- ${f}`);
			}

			if (soulHints.traits.length > 0) {
				lines.push("", `你的人格倾向: ${soulHints.traits.join(", ")}${soulHints.tone ? ` (心情: ${soulHints.tone})` : ""}`);
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
				"Requirements:",
				"- Sound like a friend, not formal",
				"- Short and casual",
				kind === "idle" ? "- Do NOT repeat your earlier opening greeting" : "- If there's recent context, mention it naturally",
				"- Don't force a topic just to have something to say",
				"- If they're only doing trivial things (like creating an empty folder), don't mention it - just say hi",
				"- Preferences and lessons are background context only - reference at most 1-2, only when it naturally fits",
				"- Don't keep bringing up the same memories or concepts repeatedly",
				"",
				"Project state:",
				`Project: ${project}`,
				...(snapshot.branch ? [`Branch: ${snapshot.branch}`] : []),
				...(snapshot.lastCommit ? [`Last commit: ${snapshot.lastCommit}`] : []),
				`Time: ${now.toLocaleDateString("en-US", { weekday: "long", hour: "2-digit", minute: "2-digit" })} (${timeOfDay})`,
			];

			if (recentEpisodes.length > 0) {
				lines.push("", "Recently worked on:");
				for (const ep of recentEpisodes.slice(0, 2)) {
					const summary = ep.summary?.slice(0, 80) || "No summary";
					lines.push(`- ${summary}`);
				}
			}

			if (highlights.preferences.length > 0) {
				lines.push("", "What you know about them:");
				for (const p of highlights.preferences) lines.push(`- ${p}`);
			}
			if (highlights.lessons.length > 0) {
				lines.push("", "Lessons remembered:");
				for (const l of highlights.lessons) lines.push(`- ${l}`);
			}

			if (snapshot.changedFiles.length > 0) {
				lines.push("", "Files they're currently editing:");
				for (const f of snapshot.changedFiles) lines.push(`- ${f}`);
			}

			if (soulHints.traits.length > 0) {
				lines.push("", `Your personality tilt: ${soulHints.traits.join(", ")}${soulHints.tone ? ` (mood: ${soulHints.tone})` : ""}`);
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
	} catch {
		return undefined;
	}
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
	const prompt = await buildGreetingPrompt(
		state,
		locale,
		soulHints,
		kind,
		lastUser,
	);
	if (!prompt) return fallback();

	const systemPrompt = (() => {
		const traitsHint = soulHints.traits.length > 0
			? ` Your key traits: ${soulHints.traits.map((t) => t.split(":")[0]).join(", ")}.`
			: "";

		if (locale === "zh") {
			return kind === "opening"
				? `你是个程序员的好朋友，现在来打个招呼。说得随意自然点。${traitsHint}`
				: `你是个程序员的好朋友。轻声问候，不打扰。一句话。${traitsHint}`;
		}
		return kind === "opening"
			? `You're a developer's coding buddy saying hi. Keep it casual and human.${traitsHint}`
			: `You're a developer's coding buddy doing a quiet check-in. One short, non-pushy line.${traitsHint}`;
	})();

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
	await initMemEngine(state);

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
			await initMemEngine(state);
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
		const lines = state.recentPresenceLines;
		if (!lines.length) return undefined;
		const list = lines.map((l) => `- "${l}"`).join("\n");
		const injection = [
			"",
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
			"",
		].join("\n");
		return { appendSystemPrompt: injection };
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

export const __testUtils = {
	getFallbackOpeningLines,
	getFallbackIdleLines,
	resolveBundledPackageEntry,
	importRuntimeModule,
	detectLanguageFromMemory,
	getOpeningDelayMs,
};
