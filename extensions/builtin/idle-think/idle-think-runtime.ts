/**
 * [WHO]: Provides IdleThink state, budget checks, lifecycle cleanup, and exploration loop orchestration
 * [FROM]: Depends on core extension context types, ./thinker, ./insights, and ./curiosity for exploration side effects
 * [TO]: Consumed by ./index.ts and idle-think behavior tests
 * [HERE]: extensions/builtin/idle-think/idle-think-runtime.ts - testable runtime boundary for idle exploration
 */

import type { ExtensionAPI, ExtensionContext } from "../../../core/extensions-host/types.js";
import { runExploration, type ThinkResult } from "./thinker.js";
import { storeInsight, loadRecentInsights, projectKeyFromCwd } from "./insights.js";
import {
	loadCuriosityQueue,
	saveCuriosityQueue,
	pickNextTopics,
	addTopicsFromInsight,
	extractTopicsFromInsight,
	markExplored,
	type CuriosityItem,
	type CuriosityQueue,
} from "./curiosity.js";

const IDLE_POLL_MS = 60_000;
const DEFAULT_IDLE_MINUTES = 15;
const DEFAULT_DAILY_BUDGET = 10;
const DEFAULT_MAX_DURATION_MINUTES = 10;
const DIAGNOSTIC_EVENT_CHANNEL = "diagnostic:event";

export type IdleThinkState = {
	lastActivityAt: number;
	isRunning: boolean;
	dailyCount: number;
	dailyResetAt: number;
	abortController?: AbortController;
	timer?: ReturnType<typeof setInterval>;
};

export type IdleThinkSettings = {
	enabled?: boolean;
	idleMinutes?: number;
	dailyBudget?: number;
	maxDurationMinutes?: number;
};

export type IdleThinkDeps = {
	runExploration: typeof runExploration;
	storeInsight: typeof storeInsight;
	loadRecentInsights: typeof loadRecentInsights;
	projectKeyFromCwd: typeof projectKeyFromCwd;
	loadCuriosityQueue: typeof loadCuriosityQueue;
	saveCuriosityQueue: typeof saveCuriosityQueue;
	pickNextTopics: typeof pickNextTopics;
	addTopicsFromInsight: typeof addTopicsFromInsight;
	extractTopicsFromInsight: typeof extractTopicsFromInsight;
	markExplored: typeof markExplored;
	now: () => number;
};

export const defaultIdleThinkDeps: IdleThinkDeps = {
	runExploration,
	storeInsight,
	loadRecentInsights,
	projectKeyFromCwd,
	loadCuriosityQueue,
	saveCuriosityQueue,
	pickNextTopics,
	addTopicsFromInsight,
	extractTopicsFromInsight,
	markExplored,
	now: () => Date.now(),
};

export function createState(deps: Pick<IdleThinkDeps, "now"> = defaultIdleThinkDeps): IdleThinkState {
	return {
		lastActivityAt: deps.now(),
		isRunning: false,
		dailyCount: 0,
		dailyResetAt: startOfToday(),
	};
}

export function startOfToday(now = new Date()): number {
	return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function touch(state: IdleThinkState, deps: Pick<IdleThinkDeps, "now"> = defaultIdleThinkDeps): void {
	state.lastActivityAt = deps.now();
}

export function getSettings(ctx: ExtensionContext): IdleThinkSettings {
	const settings = ctx.getSettings?.();
	return settings?.idleThink ?? {};
}

export function checkBudget(state: IdleThinkState, settings: IdleThinkSettings): boolean {
	const todayStart = startOfToday();
	if (todayStart > state.dailyResetAt) {
		state.dailyCount = 0;
		state.dailyResetAt = todayStart;
	}

	const budget = settings.dailyBudget ?? DEFAULT_DAILY_BUDGET;
	return state.dailyCount < budget;
}

export function cleanup(state: IdleThinkState): void {
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

export function startIdleLoop(
	api: ExtensionAPI,
	ctx: ExtensionContext,
	state: IdleThinkState,
	deps: IdleThinkDeps = defaultIdleThinkDeps,
): void {
	cleanup(state);
	touch(state, deps);

	state.timer = setInterval(() => {
		void maybeRunExploration(api, ctx, state, deps);
	}, IDLE_POLL_MS);
}

export async function maybeRunExploration(
	api: ExtensionAPI,
	ctx: ExtensionContext,
	state: IdleThinkState,
	deps: IdleThinkDeps = defaultIdleThinkDeps,
): Promise<void> {
	const settings = getSettings(ctx);

	if (settings.enabled !== true) return;
	if (state.isRunning) return;
	if (!ctx.model) return;

	const idleMinutes = settings.idleMinutes ?? DEFAULT_IDLE_MINUTES;
	const idleMs = idleMinutes * 60 * 1000;
	if (deps.now() - state.lastActivityAt < idleMs) return;
	if (!checkBudget(state, settings)) return;
	if (ctx.hasPendingMessages() || !ctx.isIdle()) return;

	const project = deps.projectKeyFromCwd(ctx.cwd);
	const recentInsights = (await deps.loadRecentInsights(3, project)).map(
		(e) => e.summary || e.detail || "",
	);
	const curiosityQueue = deps.loadCuriosityQueue();
	const topics = deps.pickNextTopics(curiosityQueue, 3);

	state.isRunning = true;
	state.dailyCount++;
	state.abortController = new AbortController();

	const maxDurationMinutes = settings.maxDurationMinutes ?? DEFAULT_MAX_DURATION_MINUTES;

	try {
		const result: ThinkResult = await deps.runExploration({
			cwd: ctx.cwd,
			model: ctx.model,
			signal: state.abortController.signal,
			timeoutMs: maxDurationMinutes * 60 * 1000,
			recentInsights,
			curiosityTopics: topics,
		});

		if (result.success && result.insights) {
			await persistSuccessfulInsight(result.insights, project, curiosityQueue, topics, deps);
		} else {
			reportIdleThinkDiagnostic(api, "warning", "Idle exploration completed without a usable insight.", {
				error: result.error,
				durationMs: result.durationMs,
			}, "result");
		}
	} catch (err) {
		reportIdleThinkDiagnostic(api, "error", "Idle exploration failed unexpectedly.", {
			error: (err as Error).message,
		}, "exception");
	} finally {
		state.isRunning = false;
		state.abortController = undefined;
		touch(state, deps);
	}
}

async function persistSuccessfulInsight(
	insight: string,
	project: string,
	curiosityQueue: CuriosityQueue,
	topics: CuriosityItem[],
	deps: IdleThinkDeps,
): Promise<void> {
	await deps.storeInsight(insight, project);

	const newTopics = deps.extractTopicsFromInsight(insight);
	if (newTopics.length > 0) {
		deps.addTopicsFromInsight(curiosityQueue, newTopics);
		deps.saveCuriosityQueue(curiosityQueue);
	}

	if (topics.length > 0) {
		deps.markExplored(curiosityQueue, topics.map((t) => t.topic));
		deps.saveCuriosityQueue(curiosityQueue);
	}
}

function reportIdleThinkDiagnostic(
	api: ExtensionAPI,
	severity: "warning" | "error",
	message: string,
	detail: Record<string, unknown>,
	fingerprintSuffix: string,
): void {
	api.events.emit(DIAGNOSTIC_EVENT_CHANNEL, {
		source: "idle-think",
		severity,
		category: "background_task",
		message,
		detail,
		fingerprint: `idle-think:background_task:${fingerprintSuffix}`,
	});
}
