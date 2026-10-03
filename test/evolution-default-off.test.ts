/**
 * [WHO]: Pins what the evolution extension does by default, before a user asks for anything
 * [FROM]: Depends on node:test/assert/fs/os/path and the real registered extension handlers
 * [TO]: Consumed by test:evolution-boundaries; covers S10 so added logic never turns idle behavior on
 * [HERE]: test/evolution-default-off.test.ts - S10 default-off and no-spend coverage
 *
 * "Off by default" is easy to claim and easy to break silently, so it is measured here rather than
 * asserted in prose. These tests drive the *registered* turn_end handler — not the observer class
 * directly — with a context whose only model entry point counts calls, and they check three things
 * the default path must never do: call a model, write anything to disk, or relax the promotion gate.
 *
 * The load policy is a real fact worth pinning too: the extension loads from the optional tier, so
 * "default" here means "loaded and inert", not "absent". That is a stronger claim than absence, and
 * it is the one that actually constrains future changes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import evolutionExtension from "../extensions/optional/evolution/index.js";
import {
	getEvolutionScopeRoot,
	inspectEvolution,
	loadActiveEvolutionArtifacts,
	promoteEvolutionCandidate,
} from "../extensions/optional/evolution/evolution-store.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { ExtensionCommandContext } from "../core/extensions-host/types.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionCandidate, EvolutionCandidateInput } from "../extensions/optional/evolution/evolution-types.js";

interface TurnEndEvent {
	type: "turn_end";
	turnIndex: number;
	message: { role: string; content: string };
	toolResults: unknown[];
}

/** Minimal extension host surface: enough to register, and able to count what the default path does. */
function createHarness(agentDir: string) {
	const handlers = new Map<string, ((event: TurnEndEvent, ctx: ExtensionCommandContext) => Promise<void> | void)[]>();
	const commands = new Map<string, (args: string, ctx: ExtensionCommandContext) => Promise<void> | void>();
	const tools = new Map<string, unknown>();
	const messages: string[] = [];
	return {
		handlers,
		commands,
		tools,
		messages,
		api: {
			registerTool: (tool: { name: string }) => tools.set(tool.name, tool),
			registerCommand: (name: string, spec: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void }) => commands.set(name, spec.handler),
			on: (event: string, handler: (event: TurnEndEvent, ctx: ExtensionCommandContext) => Promise<void> | void) => {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			sendMessage: (message: { content: string }) => messages.push(message.content),
		},
	};
}

async function withExtension(run: (harness: ReturnType<typeof createHarness>, agentDir: string) => Promise<void> | void): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-default-off-"));
	const agentDir = join(root, "agent");
	try {
		const harness = createHarness(agentDir);
		await evolutionExtension(harness.api as never);
		await run(harness, agentDir);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

/**
 * A context whose every plausible model entry point fails the test if it is reached. The default
 * turn_end path must not need a model: the text it reacts to was already produced by one.
 */
function strictContext(agentDir: string, sessionId: string, counters: { modelCalls: number }): ExtensionCommandContext {
	const forbid = (name: string) => async () => {
		counters.modelCalls += 1;
		throw new Error(`default path must not call ${name}`);
	};
	return {
		agentDir,
		cwd: agentDir,
		sessionManager: { getSessionId: () => sessionId, getEntries: () => [] },
		completeSimple: forbid("completeSimple"),
		complete: forbid("complete"),
		reload: forbid("reload"),
	} as unknown as ExtensionCommandContext;
}

test("the turn_end handler is registered by default, and the default is inert", async () => {
	await withExtension(async (harness, agentDir) => {
		assert.equal(harness.handlers.has("turn_end"), true, "the observer is loaded from the optional tier by default");
		const counters = { modelCalls: 0 };
		const ctx = strictContext(agentDir, "default-off", counters);
		const turnEnd = harness.handlers.get("turn_end")![0]!;

		// Ordinary turns, with nothing resembling a proposal in the assistant's output.
		for (let turnIndex = 1; turnIndex <= 12; turnIndex += 1) {
			await turnEnd({ type: "turn_end", turnIndex, message: { role: "assistant", content: "Did the work and explained why." }, toolResults: [] }, ctx);
		}

		assert.equal(counters.modelCalls, 0, "the idle path must cost nothing");
		assert.equal(
			existsSync(getEvolutionScopeRoot(agentDir, { scope: "session", sessionId: "default-off" })),
			false,
			"an inert run must not even create the scope root",
		);
		assert.equal(harness.messages.length, 0, "nothing should be pushed at the user");
	});
});

test("a turn carrying no lesson writes nothing at all", async () => {
	await withExtension(async (harness, agentDir) => {
		const counters = { modelCalls: 0 };
		const ctx = strictContext(agentDir, "quiet", counters);
		const turnEnd = harness.handlers.get("turn_end")![0]!;

		await turnEnd({ type: "turn_end", turnIndex: 1, message: { role: "assistant", content: "All tests pass; no reusable lesson here." }, toolResults: [] }, ctx);

		assert.equal(counters.modelCalls, 0);
		assert.equal(existsSync(getEvolutionScopeRoot(agentDir, { scope: "session", sessionId: "quiet" })), false);
	});
});

test("a malformed declaration is inert rather than a half-created candidate", async () => {
	await withExtension(async (harness, agentDir) => {
		const counters = { modelCalls: 0 };
		const ctx = strictContext(agentDir, "malformed", counters);
		const turnEnd = harness.handlers.get("turn_end")![0]!;

		// The turn_end handler swallows observer errors on purpose, so a malformed payload must not
		// be able to leave partial state behind even if it does reach the store.
		await turnEnd({ type: "turn_end", turnIndex: 1, message: { role: "assistant", content: '{"catui_evolution": {"kind": "memory"}' }, toolResults: [] }, ctx);
		await turnEnd({ type: "turn_end", turnIndex: 2, message: { role: "assistant", content: "catui_evolution: definitely not json" }, toolResults: [] }, ctx);

		assert.equal(counters.modelCalls, 0);
		assert.equal(existsSync(getEvolutionScopeRoot(agentDir, { scope: "session", sessionId: "malformed" })), false);
	});
});

test("the observer reacts to text the model already wrote, and only then", async () => {
	// The distinction that makes the default safe: nothing is sampled, invented, or requested. The
	// only way a candidate appears is the assistant emitting a marker itself.
	await withExtension(async (harness, agentDir) => {
		const counters = { modelCalls: 0 };
		const ctx = strictContext(agentDir, "reactive", counters);
		const turnEnd = harness.handlers.get("turn_end")![0]!;

		await turnEnd({
			type: "turn_end",
			turnIndex: 1,
			message: { role: "assistant", content: "Reusable lesson: check the failing test before theorising." },
			toolResults: [],
		}, ctx);

		const root = getEvolutionScopeRoot(agentDir, { scope: "session", sessionId: "reactive" });
		assert.equal(inspectEvolution(root).candidates.length, 1, "an explicit marker is honored");
		assert.equal(counters.modelCalls, 0, "and it still cost no model call");
		// It is a candidate, not an activation: nothing here is live yet.
		assert.deepEqual(loadActiveEvolutionArtifacts(root), []);
	});
});

test("the added logic costs nothing on the default path", async () => {
	// The budget, cooldown, dedup, override, and rejection-history work all sit on the path this
	// test walks, because the cooldown in particular is evaluated on every turn now. A regression
	// where any of it reaches for a model would show up here rather than in a user's bill.
	await withExtension(async (harness, agentDir) => {
		const counters = { modelCalls: 0 };
		const ctx = strictContext(agentDir, "costless", counters);
		const turnEnd = harness.handlers.get("turn_end")![0]!;

		await turnEnd({ type: "turn_end", turnIndex: 1, message: { role: "assistant", content: '{"catui_evolution": {"kind": "memory", "title": "T", "content": "C", "scope": "session"}}' }, toolResults: [] }, ctx);
		await turnEnd({ type: "turn_end", turnIndex: 2, message: { role: "assistant", content: '{"catui_evolution": {"kind": "memory", "title": "T", "content": "C", "scope": "session"}}' }, toolResults: [] }, ctx);

		assert.equal(counters.modelCalls, 0);
	});
});

test("no new persisted user setting was introduced", async () => {
	// Enablement stays where the review says it should: the extension load itself and the explicit
	// /refine command. Nothing here may leave a config or mode file the user never asked for.
	await withExtension(async (harness, agentDir) => {
		const counters = { modelCalls: 0 };
		const ctx = strictContext(agentDir, "no-settings", counters);
		const turnEnd = harness.handlers.get("turn_end")![0]!;
		for (let turnIndex = 1; turnIndex <= 11; turnIndex += 1) {
			await turnEnd({ type: "turn_end", turnIndex, message: { role: "assistant", content: `turn ${turnIndex}` }, toolResults: [] }, ctx);
		}

		// The agent directory may legitimately not exist yet; what must not exist is anything the
		// default run created inside it.
		assert.equal(existsSync(agentDir), false, "an inert run must not create the agent directory either");
		const v1 = join(agentDir, "evolution", "v1");
		assert.equal(existsSync(v1), false, "no scope root, settings file, or mode record may be created by default");
	});
});

test("the promotion gate is still closed without integrity-bound evidence", async () => {
	// The other half of "default off": a candidate created by the reactive path still cannot become
	// active on a self-report, and the default configuration must not have relaxed that.
	await withExtension(async (harness, agentDir) => {
		const ctx = strictContext(agentDir, "gate", { modelCalls: 0 });
		const turnEnd = harness.handlers.get("turn_end")![0]!;
		await turnEnd({
			type: "turn_end",
			turnIndex: 1,
			message: { role: "assistant", content: "Reusable lesson: the gate is still closed." },
			toolResults: [],
		}, ctx);

		const root = getEvolutionScopeRoot(agentDir, { scope: "session", sessionId: "gate" });
		const candidate = inspectEvolution(root).candidates[0]!;
		assert.equal(candidate.status, "proposed");

		assert.throws(
			() => promoteEvolutionCandidate(root, candidate.id, { approvedBy: "test", gateReport: { name: "self-report", passed: true, checkedAt: "2026-08-25T01:00:00.000Z", metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 } } }),
			/integrity-bound benchmark/,
		);
		assert.deepEqual(loadActiveEvolutionArtifacts(root), [], "a self-report must not become active");
	});
});

test("a forged benchmark report does not get through the default gate", async () => {
	// A report that merely says `passed: true` is the shape a self-serving proposal would send, so
	// the default gate has to refuse it for the reason that matters: it is not bound to this
	// candidate. Relaxing the gate would be invisible to a test that only checked the outer flag.
	await withExtension(async (harness, agentDir) => {
		const ctx = strictContext(agentDir, "forged", { modelCalls: 0 });
		await harness.handlers.get("turn_end")![0]!({
			type: "turn_end",
			turnIndex: 1,
			message: { role: "assistant", content: "Reusable lesson: a forged report still fails." },
			toolResults: [],
		}, ctx);

		const root = getEvolutionScopeRoot(agentDir, { scope: "session", sessionId: "forged" });
		const candidate = inspectEvolution(root).candidates[0]!;
		// A real 20 -> 30 improvement, so the forged report is not rejected for weak numbers.
		const runs = (role: "baseline" | "candidate"): EvolutionBenchmarkRunV1[] => Array.from({ length: 40 }, (_, task) => Array.from({ length: 3 }, (_, repetition) => {
			const success = task < (role === "baseline" ? 20 : 30);
			return {
				taskId: `task-${task}`,
				repetition: repetition + 1,
				split: "heldout" as const,
				slices: [task % 2 === 0 ? "coding" : "tool-use"],
				success,
				score: success ? 1 : 0,
				costUsd: 1,
				latencyMs: 1_000,
				policyViolations: 0,
				replayDivergences: 0,
				unpairedToolCalls: 0,
			};
		})).flat();
		const snap = (role: "baseline" | "candidate", id: string, hash: string): EvolutionBenchmarkSnapshotV1 => ({
			schemaVersion: 1,
			kind: "catui-evolution-benchmark-snapshot",
			role,
			...(role === "candidate" ? { candidateId: id, candidateContentHash: hash } : {}),
			createdAt: "2026-08-25T00:00:00.000Z",
			corpus: { id: "pawbench", version: "1.0", digest: `sha256:${"a".repeat(64)}` },
			harness: { revisionId: role, commitSha: "a".repeat(40) },
			execution: { model: "frozen-model", modelVersion: "v1", temperature: 0, maxTokens: 1, timeoutMs: 1, budgetUsd: 1 },
			runs: runs(role),
		});
		// Genuinely passing numbers, bound to the wrong candidate.
		const forged = compareEvolutionBenchmarks(
			snap("baseline", "somebody-else", `sha256:${"b".repeat(64)}`),
			snap("candidate", "somebody-else", `sha256:${"b".repeat(64)}`),
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{ candidateId: "somebody-else", baselineRevisionId: null, checkedAt: "2026-08-25T01:00:00.000Z" },
		);
		assert.equal(forged.passed, true, "precondition: the forged numbers really do pass the comparator");

		assert.throws(
			() => promoteEvolutionCandidate(root, candidate.id, {
				approvedBy: "test",
				gateReport: {
					name: "builtin-harness-eval+heldout-benchmark",
					passed: true,
					checkedAt: "2026-08-25T01:00:00.000Z",
					metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
					benchmark: forged,
				},
			}),
			/integrity-bound benchmark/,
			"a report bound to another candidate must not activate this one",
		);
		assert.deepEqual(loadActiveEvolutionArtifacts(root), []);
	});
});

test("the model is only ever consulted when the user runs the refine command", async () => {
	// The one path that does call a model, and it is user-initiated. Pinning it keeps "the default
	// is inert" and "refine works" from drifting into each other.
	await withExtension(async (harness, agentDir) => {
		const counters = { modelCalls: 0 };
		const ctx = {
			...strictContext(agentDir, "refine", counters),
			completeSimple: async () => {
				counters.modelCalls += 1;
				return JSON.stringify({ summary: "s", rationale: "r", expectedOutcome: "e", artifacts: [] });
			},
		} as unknown as ExtensionCommandContext;
		const refine = harness.commands.get("refine");
		assert.ok(refine, "/refine is the user-facing entry point");

		await refine("status", ctx);
		assert.equal(counters.modelCalls, 0, "inspecting status is a local read");
	});
});

test("the extension still loads from the optional tier", async () => {
	// "Default off" here means loaded and inert, not absent. Asserting the load path keeps a future
	// move to builtin, or a new eager registration, from quietly changing what every user runs.
	const { getBuiltinExtensionPaths } = await import("../builtin-extensions.js");
	const loaded = getBuiltinExtensionPaths().map((entry) => entry.split(sep).join("/"));
	assert.ok(
		loaded.some((entry) => entry.includes("/optional/evolution/")),
		"the evolution extension must still be discovered from extensions/optional/",
	);
});

test("the documented off and manual modes make no automatic model calls", async () => {
	// The source-side policy documents `off` and `manual` as call-free. That module is not reachable
	// from the live entry, so the claim is pinned against the module itself rather than assumed to
	// describe running behavior.
	const { DEFAULT_AUTOMATION_POLICY, defaultAutomationState, shouldReview } = await import("../extensions/optional/evolution/automation.js");
	assert.ok(DEFAULT_AUTOMATION_POLICY, "the policy exists and is exported");
	for (const mode of ["off", "manual"] as const) {
		// The mode lives in the recorded state, not the policy, so this pins the real check.
		const state = { ...defaultAutomationState(0), mode };
		for (const turnIndex of [25, 50]) {
			assert.deepEqual(
				shouldReview({ type: "turn", turnIndex, fingerprint: `f-${turnIndex}` }, state, DEFAULT_AUTOMATION_POLICY, 1_000_000),
				{ review: false, reason: "mode" },
				`mode ${mode} must never authorize a review`,
			);
		}
	}
	// And the policy's own budget and interval still hold for a mode that does run.
	assert.deepEqual(
		shouldReview({ type: "turn", turnIndex: 7, fingerprint: "f-7" }, { ...defaultAutomationState(0), mode: "guarded" }, DEFAULT_AUTOMATION_POLICY, 1_000_000),
		{ review: false, reason: "interval" },
	);
});
