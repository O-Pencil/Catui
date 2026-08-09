/**
 * [WHO]: Shadow automation policy, accounting, and persistence regression tests
 * [FROM]: Depends on node:test/assert/fs/os/path and optional evolution automation
 * [TO]: Guards default-off LLM behavior, cooldown, budgets, triggers, and durable mode state
 * [HERE]: test/evolution-automation.test.ts - deterministic self-evolution automation coverage
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	DEFAULT_AUTOMATION_POLICY,
	defaultAutomationState,
	loadAutomationState,
	recordAutomationReview,
	reserveAutomationReview,
	saveAutomationState,
	shouldReview,
} from "../extensions/optional/evolution/automation.ts";

const day = Date.parse("2026-08-09T12:00:00.000Z");

test("off and manual modes never schedule automatic LLM reviews", () => {
	for (const mode of ["off", "manual"] as const) {
		const state = { ...defaultAutomationState(day), mode };
		assert.deepEqual(shouldReview({ type: "turn", turnIndex: 25, fingerprint: "turn-25" }, state, DEFAULT_AUTOMATION_POLICY, day), { review: false, reason: "mode" });
		assert.deepEqual(shouldReview({ type: "compaction", fingerprint: "compact-1" }, state, DEFAULT_AUTOMATION_POLICY, day), { review: false, reason: "mode" });
	}
});

test("shadow reviews configured turns and compaction while suppressing early or duplicate triggers", () => {
	const state = { ...defaultAutomationState(day), mode: "shadow" as const };
	assert.equal(shouldReview({ type: "turn", turnIndex: 24, fingerprint: "turn-24" }, state, DEFAULT_AUTOMATION_POLICY, day).review, false);
	assert.equal(shouldReview({ type: "turn", turnIndex: 25, fingerprint: "turn-25" }, state, DEFAULT_AUTOMATION_POLICY, day).review, true);
	assert.equal(shouldReview({ type: "compaction", fingerprint: "compact-1" }, state, DEFAULT_AUTOMATION_POLICY, day).review, true);
	const recorded = recordAutomationReview(state, { fingerprint: "turn-25" }, DEFAULT_AUTOMATION_POLICY, day);
	assert.deepEqual(shouldReview({ type: "turn", turnIndex: 50, fingerprint: "turn-25" }, recorded, DEFAULT_AUTOMATION_POLICY, day + DEFAULT_AUTOMATION_POLICY.cooldownMs + 1), { review: false, reason: "duplicate" });
});

test("cooldown and conservative daily token/cost reservations fail closed", () => {
	const state = { ...defaultAutomationState(day), mode: "shadow" as const };
	const recorded = recordAutomationReview(state, { fingerprint: "turn-25" }, DEFAULT_AUTOMATION_POLICY, day);
	assert.deepEqual(shouldReview({ type: "compaction", fingerprint: "compact-2" }, recorded, DEFAULT_AUTOMATION_POLICY, day + 1), { review: false, reason: "cooldown" });
	const exhausted = {
		...recorded,
		lastReviewAt: day - DEFAULT_AUTOMATION_POLICY.cooldownMs - 1,
		tokensUsed: DEFAULT_AUTOMATION_POLICY.dailyTokenBudget,
	};
	assert.deepEqual(shouldReview({ type: "compaction", fingerprint: "compact-3" }, exhausted, DEFAULT_AUTOMATION_POLICY, day), { review: false, reason: "budget" });
});

test("usage resets on a new UTC day and trigger history stays bounded", () => {
	let state = { ...defaultAutomationState(day), mode: "shadow" as const };
	for (let index = 0; index < DEFAULT_AUTOMATION_POLICY.maxTriggerFingerprints + 5; index += 1) {
		state = recordAutomationReview(state, { fingerprint: `trigger-${index}` }, DEFAULT_AUTOMATION_POLICY, day + index);
	}
	assert.equal(state.triggerFingerprints.length, DEFAULT_AUTOMATION_POLICY.maxTriggerFingerprints);
	const nextDay = recordAutomationReview(state, { fingerprint: "next-day" }, DEFAULT_AUTOMATION_POLICY, Date.parse("2026-08-10T01:00:00.000Z"));
	assert.equal(nextDay.tokensUsed, DEFAULT_AUTOMATION_POLICY.estimatedTokensPerReview);
	assert.equal(nextDay.costUsedUsd, DEFAULT_AUTOMATION_POLICY.estimatedCostPerReviewUsd);
});

test("automation state persists privately below the dedicated evolution root", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "catui-evolution-automation-"));
	const state = { ...defaultAutomationState(day), mode: "guarded" as const };
	await saveAutomationState(agentDir, state);
	assert.deepEqual(await loadAutomationState(agentDir, day + 1), state);
});

test("concurrent review reservations charge a trigger at most once", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "catui-evolution-automation-race-"));
	await saveAutomationState(agentDir, { ...defaultAutomationState(day), mode: "shadow" });
	const trigger = { type: "turn", turnIndex: 25, fingerprint: "same-trigger" } as const;
	const outcomes = await Promise.allSettled([
		reserveAutomationReview(agentDir, trigger, DEFAULT_AUTOMATION_POLICY, day),
		reserveAutomationReview(agentDir, trigger, DEFAULT_AUTOMATION_POLICY, day),
	]);
	const reservations = outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : []);
	assert.equal(reservations.filter((result) => result.reserved).length, 1);
	const state = await loadAutomationState(agentDir, day);
	assert.equal(state.tokensUsed, DEFAULT_AUTOMATION_POLICY.estimatedTokensPerReview);
	assert.deepEqual(state.triggerFingerprints, ["same-trigger"]);
});
