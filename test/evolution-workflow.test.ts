/**
 * [WHO]: Candidate transition and evidence-gate regression tests
 * [FROM]: Depends on node:test/assert and optional evolution workflow/types
 * [TO]: Guards non-skippable validation and approval policy
 * [HERE]: test/evolution-workflow.test.ts - pure self-evolution state-machine coverage
 */
import assert from "node:assert/strict";
import test from "node:test";
import { advanceCandidate, mergeScopedArtifacts } from "../extensions/optional/evolution/workflow.ts";
import type { CandidateRecord, EvolutionProposal, GateEvidence } from "../extensions/optional/evolution/types.ts";

function proposal(scope: EvolutionProposal["scope"] = "workspace"): EvolutionProposal {
	return {
		schemaVersion: 1,
		id: "candidate-a",
		scope,
		baselineRevisionId: null,
		summary: "Improve verification consistency",
		expectedOutcome: "Verification evidence appears before completion",
		createdAt: "2026-08-09T00:00:00.000Z",
		provenance: { trigger: "manual", sessionId: "session-a", traceRefs: ["trace:sha256:abc"] },
		artifacts: [],
	};
}

function record(scope: EvolutionProposal["scope"] = "workspace"): CandidateRecord {
	return { schemaVersion: 1, id: "candidate-a", state: "proposed", proposal: proposal(scope), evidence: {} };
}

function evidence(gate: GateEvidence["gate"], passed = true, details: Record<string, unknown> = {}): GateEvidence {
	return { schemaVersion: 1, gate, passed, createdAt: "2026-08-09T00:01:00.000Z", summary: `${gate} result`, details };
}

test("advances through static, replay, and candidate-specific eval without skipping", () => {
	const staticRecord = advanceCandidate(record(), { type: "static_checked", evidence: evidence("static") });
	assert.equal(staticRecord.state, "statically_validated");
	const replayRecord = advanceCandidate(staticRecord, {
		type: "replay_checked",
		evidence: evidence("replay", true, { lifecyclePreserved: true, toolPairsPreserved: true, policyPreserved: true }),
	});
	assert.equal(replayRecord.state, "replay_validated");
	const evalRecord = advanceCandidate(replayRecord, {
		type: "eval_checked",
		evidence: evidence("eval", true, { matchedScenarios: ["verify-completion"], nonInferior: true, improvement: true }),
	});
	assert.equal(evalRecord.state, "eval_validated");
	assert.throws(() => advanceCandidate(record(), { type: "promote" }), /cannot transition/i);
});

test("quarantines any hard safety gate failure", () => {
	const failed = advanceCandidate(record(), { type: "static_checked", evidence: evidence("static", false) });
	assert.equal(failed.state, "quarantined");
	assert.match(failed.pendingReason ?? "", /static/i);
});

test("replay requires lifecycle, tool-pairing, and policy invariants", () => {
	const staticRecord = advanceCandidate(record(), { type: "static_checked", evidence: evidence("static") });
	const failed = advanceCandidate(staticRecord, {
		type: "replay_checked",
		evidence: evidence("replay", true, { lifecyclePreserved: true, toolPairsPreserved: false, policyPreserved: true }),
	});
	assert.equal(failed.state, "quarantined");
});

test("replay success alone cannot claim quality and unmatched eval remains pending", () => {
	let current = advanceCandidate(record(), { type: "static_checked", evidence: evidence("static") });
	current = advanceCandidate(current, {
		type: "replay_checked",
		evidence: evidence("replay", true, { lifecyclePreserved: true, toolPairsPreserved: true, policyPreserved: true }),
	});
	const pending = advanceCandidate(current, {
		type: "eval_checked",
		evidence: evidence("eval", true, { matchedScenarios: [], nonInferior: true, improvement: true }),
	});
	assert.equal(pending.state, "replay_validated");
	assert.match(pending.pendingReason ?? "", /scenario/i);
});

test("global candidates always require explicit approval", () => {
	let current = advanceCandidate(record("global"), { type: "static_checked", evidence: evidence("static") });
	current = advanceCandidate(current, {
		type: "replay_checked",
		evidence: evidence("replay", true, { lifecyclePreserved: true, toolPairsPreserved: true, policyPreserved: true }),
	});
	current = advanceCandidate(current, {
		type: "eval_checked",
		evidence: evidence("eval", true, { matchedScenarios: ["verify"], nonInferior: true, improvement: true }),
	});
	const awaiting = advanceCandidate(current, { type: "request_approval" });
	assert.equal(awaiting.state, "awaiting_approval");
	assert.throws(() => advanceCandidate(current, { type: "promote" }), /approval/i);
	const approved = advanceCandidate(awaiting, { type: "approve", actor: "human" });
	assert.equal(advanceCandidate(approved, { type: "promote" }).state, "promoted");
});

test("manual approval can override missing effectiveness evidence but not safety", () => {
	let current = advanceCandidate(record(), { type: "static_checked", evidence: evidence("static") });
	current = advanceCandidate(current, {
		type: "replay_checked",
		evidence: evidence("replay", true, { lifecyclePreserved: true, toolPairsPreserved: true, policyPreserved: true }),
	});
	current = advanceCandidate(current, { type: "request_approval", reason: "No matching eval scenario" });
	current = advanceCandidate(current, { type: "approve", actor: "human", overrideMissingEffectiveness: true });
	assert.equal(advanceCandidate(current, { type: "promote" }).state, "promoted");
	assert.throws(() => advanceCandidate(advanceCandidate(record(), { type: "static_checked", evidence: evidence("static", false) }), { type: "approve", actor: "human" }), /cannot transition/i);
});

test("higher evolved scopes override only through explicit provenance", () => {
	const base = {
		...proposal("global").artifacts[0],
		schemaVersion: 1 as const,
		id: "evolved:memory:rule",
		kind: "memory" as const,
		title: "Rule",
		content: "global",
		scope: "global" as const,
		version: 1,
		createdAt: "2026-08-09T00:00:00.000Z",
		applicability: ["always"],
		nonApplicability: ["never"],
		promptTokenBudget: 10,
		dependencies: [],
		expectedOutcome: "rule applies",
		provenance: { sourceCandidateId: "a", trigger: "manual", traceRefs: ["t"] },
	};
	const ignoredWorkspace = { ...base, scope: "workspace" as const, content: "undeclared" };
	const overridingSession = { ...base, scope: "session" as const, content: "session", overrides: base.id };
	const merged = mergeScopedArtifacts([
		{ scope: "global", artifacts: [base] },
		{ scope: "workspace", artifacts: [ignoredWorkspace] },
		{ scope: "session", artifacts: [overridingSession] },
	]);
	assert.equal(merged[0]?.content, "session");
});
