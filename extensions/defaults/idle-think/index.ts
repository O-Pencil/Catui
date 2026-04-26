/**
 * [WHO]: IdleThink extension interface — idle detection, background code exploration orchestration
 * [FROM]: Depends on core/extensions/types, ./thinker (runExploration), ./insights (storeInsight, buildInsightInjection), ./curiosity (loadCuriosityQueue, saveCuriosityQueue, pickNextTopics, addTopicsFromInsight, extractTopicsFromInsight, markExplored)
 * [TO]: Loaded by builtin-extensions.ts as default extension
 * [HERE]: extensions/defaults/idle-think/index.ts - background code archaeology during idle time
 *
 * When the user is idle for 10+ minutes, spawns a read-only SubAgent to explore the current
 * project and discover non-obvious patterns, architecture decisions, and knowledge worth
 * remembering. Insights are persisted to nanomem and injected into subsequent conversations.
 *
 * Default: ON. The agent thinks when idle — that's the point.
 * Disable via settings.idleThink.enabled = false if needed.
 */

import type { ExtensionAPI, ExtensionContext } from "../../../core/extensions/types.js";
import { runExploration, type ThinkResult } from "./thinker.js";
import { storeInsight, buildInsightInjection, loadRecentInsights } from "./insights.js";
import {
	loadCuriosityQueue,
	saveCuriosityQueue,
	pickNextTopics,
	addTopicsFromInsight,
	extractTopicsFromInsight,
	markExplored,
} from "./curiosity.js";

// ── Constants ────────────────────────────────────────────────────────────────

const IDLE_POLL_MS = 60_000;
const DEFAULT_IDLE_MINUTES = 10;
const DEFAULT_DAILY_BUDGET = 999; // no practical limit
const DEFAULT_MAX_DURATION_MINUTES = 30; // let it think deeply

// ── State ────────────────────────────────────────────────────────────────────

type IdleThinkState = {
	lastActivityAt: number;
	isRunning: boolean;
	dailyCount: number;
	dailyResetAt: number;
	abortController?: AbortController;
	timer?: ReturnType<typeof setInterval>;
};

function createState(): IdleThinkState {
	return {
		lastActivityAt: Date.now(),
		isRunning: false,
		dailyCount: 0,
		dailyResetAt: startOfToday(),
	};
}

function startOfToday(): number {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function touch(state: IdleThinkState): void {
	state.lastActivityAt = Date.now();
}

// ── Settings helpers ─────────────────────────────────────────────────────────

type IdleThinkSettings = {
	enabled?: boolean;
	idleMinutes?: number;
	dailyBudget?: number;
	maxDurationMinutes?: number;
};

function getSettings(ctx: ExtensionContext): IdleThinkSettings {
	const settings = ctx.getSettings?.();
	return (settings as any)?.idleThink ?? {};
}

// ── Budget check ─────────────────────────────────────────────────────────────

function checkBudget(state: IdleThinkState, settings: IdleThinkSettings): boolean {
	// Reset daily count at midnight
	const todayStart = startOfToday();
	if (todayStart > state.dailyResetAt) {
		state.dailyCount = 0;
		state.dailyResetAt = todayStart;
	}

	const budget = settings.dailyBudget ?? DEFAULT_DAILY_BUDGET;
	return state.dailyCount < budget;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

function cleanup(state: IdleThinkState): void {
	if (state.timer) {
		clearInterval(state.timer);
		state.timer = undefined;
	}
	if (state.abortController) {
		state.abortController.abort();
		state.abortController = undefined;
	}
	state.isRunning = false;
}

// ── Core idle loop ───────────────────────────────────────────────────────────

function startIdleLoop(
	api: ExtensionAPI,
	ctx: ExtensionContext,
	state: IdleThinkState,
): void {
	cleanup(state);
	touch(state);

	state.timer = setInterval(() => {
		void maybeRunExploration(api, ctx, state);
	}, IDLE_POLL_MS);
}

async function maybeRunExploration(
	api: ExtensionAPI,
	ctx: ExtensionContext,
	state: IdleThinkState,
): Promise<void> {
	const settings = getSettings(ctx);

	// Guard: must be explicitly disabled
	if (settings.enabled === false) return;

	// Guard: not already running
	if (state.isRunning) return;

	// Guard: model available
	if (!ctx.model) return;

	// Guard: idle threshold not reached
	const idleMinutes = settings.idleMinutes ?? DEFAULT_IDLE_MINUTES;
	const idleMs = idleMinutes * 60 * 1000;
	if (Date.now() - state.lastActivityAt < idleMs) return;

	// Guard: budget
	if (!checkBudget(state, settings)) return;

	// Guard: agent not busy
	if (ctx.hasPendingMessages() || !ctx.isIdle()) return;

	// Load context from persistent stores
	const recentInsights = loadRecentInsights(3).map(
		(e) => e.summary || e.detail || "",
	);
	const curiosityQueue = loadCuriosityQueue();
	const topics = pickNextTopics(curiosityQueue, 3);

	// Run exploration
	state.isRunning = true;
	state.dailyCount++;
	state.abortController = new AbortController();

	const maxDurationMinutes = settings.maxDurationMinutes ?? DEFAULT_MAX_DURATION_MINUTES;

	try {
		const result: ThinkResult = await runExploration({
			cwd: ctx.cwd,
			model: ctx.model,
			signal: state.abortController.signal,
			timeoutMs: maxDurationMinutes * 60 * 1000,
			recentInsights,
			curiosityTopics: topics,
		});

		if (result.success && result.insights) {
			// Persist insight to nanomem
			const project = ctx.cwd.split("/").filter(Boolean).slice(-2).join("/");
			storeInsight(result.insights, project);

			// Extract and store new curiosity topics
			const newTopics = extractTopicsFromInsight(result.insights);
			if (newTopics.length > 0) {
				addTopicsFromInsight(curiosityQueue, newTopics);
				saveCuriosityQueue(curiosityQueue);
			}

			// Mark explored topics as done
			if (topics.length > 0) {
				markExplored(curiosityQueue, topics.map((t) => t.topic));
				saveCuriosityQueue(curiosityQueue);
			}
		}
	} catch {
		// Silently fail — idle exploration is best-effort
	} finally {
		state.isRunning = false;
		state.abortController = undefined;
	}
}

// ── Extension entry ──────────────────────────────────────────────────────────

export default async function idleThinkExtension(api: ExtensionAPI): Promise<void> {
	const state = createState();

	// ── Session lifecycle ─────────────────────────────────────────────────

	api.on("session_start", (_event, ctx) => {
		// Only runs in TUI mode
		if (!ctx.hasUI) return;

		// Default: enabled. The agent should think when idle — that's the point.
		const settings = getSettings(ctx);
		if (settings.enabled === false) return;

		startIdleLoop(api, ctx, state);
	});

	api.on("session_shutdown", () => {
		cleanup(state);
	});

	// ── Activity tracking (reset idle timer) ──────────────────────────────

	api.on("input", () => touch(state));
	api.on("agent_start", () => touch(state));
	api.on("agent_end", () => touch(state));
	api.on("tool_execution_start", () => touch(state));
	api.on("tool_execution_end", () => touch(state));
	api.on("tool_call", () => touch(state));
	api.on("message_end", () => touch(state));

	// ── System prompt injection (reads from nanomem, persistent) ──────────

	api.on("before_agent_start", () => {
		const injection = buildInsightInjection();
		if (!injection) return undefined;
		return { appendSystemPrompt: injection };
	});
}
