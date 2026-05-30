/**
 * [WHO]: Tests idle-think runtime budget, cleanup, diagnostics, and insight persistence behavior
 * [FROM]: Depends on node:test and extensions/builtin/idle-think/idle-think-runtime.ts
 * [TO]: Consumed by extension quality verification
 * [HERE]: test/idle-think-runtime.test.ts - focused behavior coverage for idle exploration lifecycle
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "../core/extensions-host/types.js";
import {
	cleanup,
	createState,
	maybeRunExploration,
	type IdleThinkDeps,
	type IdleThinkState,
} from "../extensions/builtin/idle-think/idle-think-runtime.js";
import type { CuriosityQueue } from "../extensions/builtin/idle-think/curiosity.js";

function createApiHarness() {
	const diagnostics: unknown[] = [];
	const api = {
		events: {
			emit: (event: string, payload: unknown) => {
				if (event === "diagnostic:event") diagnostics.push(payload);
			},
		},
	} as unknown as ExtensionAPI;
	return { api, diagnostics };
}

function createContext(settings: Record<string, unknown> = {}): ExtensionContext {
	return {
		cwd: "/Users/alice/Dev/nanoPencil",
		model: { id: "test-model", name: "Test Model", provider: "test" },
		getSettings: () => ({ idleThink: settings }),
		hasPendingMessages: () => false,
		isIdle: () => true,
	} as unknown as ExtensionContext;
}

function createDeps(overrides: Partial<IdleThinkDeps> = {}): IdleThinkDeps {
	let now = 1_000_000;
	return {
		runExploration: async () => ({
			success: true,
			insights: "Useful architecture insight.\n\nCuriosity:\n- Understand extension lifecycle ownership",
			durationMs: 25,
		}),
		storeInsight: async () => {},
		loadRecentInsights: async () => [],
		projectKeyFromCwd: () => "Dev/nanoPencil",
		loadCuriosityQueue: () => ({ items: [] }),
		saveCuriosityQueue: () => {},
		pickNextTopics: () => [],
		addTopicsFromInsight: () => {},
		extractTopicsFromInsight: () => [],
		markExplored: () => {},
		now: () => now,
		...overrides,
	};
}

function idleReadyState(deps: IdleThinkDeps): IdleThinkState {
	const state = createState(deps);
	state.lastActivityAt = 0;
	return state;
}

test("idle-think resets the daily budget at day boundary before running", async () => {
	const { api } = createApiHarness();
	let calls = 0;
	const deps = createDeps({
		runExploration: async () => {
			calls += 1;
			return { success: true, insights: "Fresh insight", durationMs: 1 };
		},
	});
	const state = idleReadyState(deps);
	state.dailyCount = 1;
	state.dailyResetAt = 0;

	await maybeRunExploration(api, createContext({ enabled: true, idleMinutes: 0, dailyBudget: 1 }), state, deps);

	assert.equal(calls, 1);
	assert.equal(state.dailyCount, 1);
	assert.ok(state.dailyResetAt > 0);
});

test("idle-think cleanup aborts an active exploration and clears running state", async () => {
	const { api } = createApiHarness();
	let capturedSignal: AbortSignal | undefined;
	const deps = createDeps({
		runExploration: async (options) => {
			capturedSignal = options.signal;
			return new Promise((resolve) => {
				options.signal.addEventListener("abort", () => {
					resolve({ success: false, insights: "", durationMs: 1, error: "aborted" });
				}, { once: true });
			});
		},
	});
	const state = idleReadyState(deps);

	const run = maybeRunExploration(api, createContext({ enabled: true, idleMinutes: 0 }), state, deps);
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(state.isRunning, true);
	assert.equal(capturedSignal?.aborted, false);

	cleanup(state);
	await run;

	assert.equal(capturedSignal?.aborted, true);
	assert.equal(state.isRunning, false);
	assert.equal(state.abortController, undefined);
});

test("idle-think persists successful insights and marks selected curiosity topics explored", async () => {
	const { api } = createApiHarness();
	const queue: CuriosityQueue = {
		items: [{ topic: "Understand team runtime lifecycle", addedAt: "2026-01-01T00:00:00.000Z", explored: false }],
	};
	const stored: Array<{ insight: string; project: string }> = [];
	const addedTopics: string[][] = [];
	const exploredTopics: string[][] = [];
	let saveCount = 0;
	const deps = createDeps({
		loadCuriosityQueue: () => queue,
		pickNextTopics: () => queue.items.filter((item) => !item.explored),
		storeInsight: async (insight, project) => {
			stored.push({ insight, project });
		},
		extractTopicsFromInsight: () => ["Understand SAL eval lifecycle"],
		addTopicsFromInsight: (_queue, topics) => {
			addedTopics.push(topics);
		},
		markExplored: (_queue, topics) => {
			exploredTopics.push(topics);
		},
		saveCuriosityQueue: () => {
			saveCount += 1;
		},
	});
	const state = idleReadyState(deps);

	await maybeRunExploration(api, createContext({ enabled: true, idleMinutes: 0 }), state, deps);

	assert.deepEqual(stored, [{ insight: "Useful architecture insight.\n\nCuriosity:\n- Understand extension lifecycle ownership", project: "Dev/nanoPencil" }]);
	assert.deepEqual(addedTopics, [["Understand SAL eval lifecycle"]]);
	assert.deepEqual(exploredTopics, [["Understand team runtime lifecycle"]]);
	assert.equal(saveCount, 2);
});

test("idle-think emits diagnostics for failed explorations instead of silent catch", async () => {
	const { api, diagnostics } = createApiHarness();
	const deps = createDeps({
		runExploration: async () => ({
			success: false,
			insights: "",
			durationMs: 42,
			error: "model unavailable",
		}),
	});
	const state = idleReadyState(deps);

	await maybeRunExploration(api, createContext({ enabled: true, idleMinutes: 0 }), state, deps);

	assert.equal(diagnostics.length, 1);
	assert.deepEqual(diagnostics[0], {
		source: "idle-think",
		severity: "warning",
		category: "background_task",
		message: "Idle exploration completed without a usable insight.",
		detail: { error: "model unavailable", durationMs: 42 },
		fingerprint: "idle-think:background_task:result",
	});
});
