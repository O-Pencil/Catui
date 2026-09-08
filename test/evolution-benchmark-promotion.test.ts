/**
 * [WHO]: Store-level evidence authority regression tests for behavioral evolution promotion
 * [FROM]: Depends on benchmark comparison plus evolution candidate/revision storage
 * [TO]: Guards fail-closed promotion and the pure eval_fixture verifier exception
 * [HERE]: test/evolution-benchmark-promotion.test.ts - promotion boundary coverage
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	compareEvolutionBenchmarks,
	DEFAULT_EVOLUTION_BENCHMARK_POLICY,
} from "../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import {
	createEvolutionCandidate,
	promoteEvolutionCandidate,
} from "../extensions/optional/evolution/evolution-store.js";
import { EvolutionStore } from "../extensions/optional/evolution/store.js";
import type { EvolutionCandidateInput, EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";

function benchmarkRuns(role: "baseline" | "candidate"): EvolutionBenchmarkRunV1[] {
	return Array.from({ length: 40 }, (_, task) => Array.from({ length: 3 }, (_, repetition) => {
		const success = task < (role === "baseline" ? 20 : 30);
		return {
			taskId: `task-${task}`,
			repetition: repetition + 1,
			split: "heldout" as const,
			slices: [task % 2 === 0 ? "coding" : "tool-use"],
			success,
			score: success ? 1 : 0,
			costUsd: 1,
			latencyMs: role === "baseline" ? 1_000 : 1_050,
			policyViolations: 0,
			replayDivergences: 0,
			unpairedToolCalls: 0,
		};
	})).flat();
}

function benchmarkSnapshot(
	role: "baseline" | "candidate",
	candidateId: string,
	candidateContentHash: string,
	runValues = benchmarkRuns(role),
): EvolutionBenchmarkSnapshotV1 {
	return {
		schemaVersion: 1,
		kind: "catui-evolution-benchmark-snapshot",
		role,
		...(role === "candidate" ? { candidateId } : {}),
		...(role === "candidate" ? { candidateContentHash } : {}),
		createdAt: "2026-08-25T00:00:00.000Z",
		corpus: { id: "pawbench", version: "1.0", digest: `sha256:${"a".repeat(64)}` },
		harness: { revisionId: role, commitSha: role === "baseline" ? "a".repeat(40) : "b".repeat(40) },
		execution: { model: "frozen-model", modelVersion: "v1", temperature: 0, maxTokens: 32_768, timeoutMs: 60_000, budgetUsd: 100 },
		runs: runValues,
	};
}

function passingGate(candidateId: string, candidateContentHash: string): EvolutionGateReport {
	return {
		name: "builtin-harness-eval+heldout-benchmark",
		passed: true,
		checkedAt: "2026-08-25T01:00:00.000Z",
		metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
		benchmark: compareEvolutionBenchmarks(
			benchmarkSnapshot("baseline", candidateId, candidateContentHash),
			benchmarkSnapshot("candidate", candidateId, candidateContentHash),
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{ candidateId, checkedAt: "2026-08-25T01:00:00.000Z" },
		),
	};
}

function behavioralInput(): EvolutionCandidateInput {
	return {
		scope: "workspace",
		summary: "Use evidence-backed workflow",
		rationale: "Repeated task failures support a focused workflow change.",
		expectedOutcome: "Held-out task success improves.",
		artifacts: [{ id: "evolved:memory:evidence", kind: "memory", title: "Evidence", content: "Use paired evidence." }],
	};
}

function fixtureInput(): EvolutionCandidateInput {
	return {
		scope: "workspace",
		summary: "Add verifier fixture",
		rationale: "A trace should guard replay behavior.",
		expectedOutcome: "Future gates cover the trace.",
		artifacts: [{ id: "evolved:eval_fixture:trace", kind: "eval_fixture", title: "Trace", content: "{}" }],
	};
}

function fixtureGate(): EvolutionGateReport {
	return {
		name: "candidate-eval-fixture",
		passed: true,
		checkedAt: "2026-08-25T01:00:00.000Z",
		metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
	};
}

test("behavioral promotion rejects missing, mismatched, and tampered benchmark evidence", () => {
	const root = mkdtempSync(join(tmpdir(), "catui-evolution-evidence-"));
	try {
		const candidate = createEvolutionCandidate(root, behavioralInput(), { id: () => "candidate-a" });
		assert.throws(() => promoteEvolutionCandidate(root, "candidate-a", { gateReport: fixtureGate() }), /benchmark evidence/i);

		const mismatched = passingGate("candidate-other", candidate.contentHash);
		assert.throws(() => promoteEvolutionCandidate(root, "candidate-a", { gateReport: mismatched }), /benchmark evidence/i);
		const contentMismatched = passingGate("candidate-a", `sha256:${"d".repeat(64)}`);
		assert.throws(() => promoteEvolutionCandidate(root, "candidate-a", { gateReport: contentMismatched }), /benchmark evidence/i);
		const unsafeReplay = passingGate("candidate-a", candidate.contentHash);
		unsafeReplay.metrics = { passRate: 0, replayDivergences: 9, policyViolations: 9, unpairedToolCalls: 9 };
		assert.throws(() => promoteEvolutionCandidate(root, "candidate-a", { gateReport: unsafeReplay }), /replay.*safety/i);

		const tampered = passingGate("candidate-a", candidate.contentHash);
		tampered.benchmark!.metrics.candidatePassRate = 1;
		assert.throws(() => promoteEvolutionCandidate(root, "candidate-a", { gateReport: tampered }), /benchmark evidence/i);

		const failedBenchmark = compareEvolutionBenchmarks(
			benchmarkSnapshot("baseline", "candidate-a", candidate.contentHash),
			benchmarkSnapshot("candidate", "candidate-a", candidate.contentHash, benchmarkRuns("baseline")),
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{ candidateId: "candidate-a", checkedAt: "2026-08-25T01:00:00.000Z" },
		);
		assert.equal(failedBenchmark.passed, false);
		assert.throws(
			() => promoteEvolutionCandidate(root, "candidate-a", { gateReport: { ...passingGate("candidate-a", candidate.contentHash), benchmark: failedBenchmark } }),
			/benchmark evidence/i,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("behavioral promotion accepts integrity-bound passing held-out evidence", () => {
	const root = mkdtempSync(join(tmpdir(), "catui-evolution-evidence-"));
	try {
		const candidate = createEvolutionCandidate(root, behavioralInput(), { id: () => "candidate-pass" });
		const revision = promoteEvolutionCandidate(root, "candidate-pass", { gateReport: passingGate("candidate-pass", candidate.contentHash) });
		assert.equal(revision.candidateId, "candidate-pass");
		assert.equal(revision.gateReport?.benchmark?.passed, true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("pure eval_fixture promotion requires its replay gate but not a real-task benchmark", () => {
	const root = mkdtempSync(join(tmpdir(), "catui-evolution-evidence-"));
	try {
		createEvolutionCandidate(root, fixtureInput(), { id: () => "candidate-fixture" });
		assert.throws(() => promoteEvolutionCandidate(root, "candidate-fixture"), /gate report/i);
		assert.throws(
			() => promoteEvolutionCandidate(root, "candidate-fixture", { gateReport: passingGate("candidate-fixture", `sha256:${"e".repeat(64)}`) }),
			/candidate fixture replay gate/i,
		);
		const revision = promoteEvolutionCandidate(root, "candidate-fixture", { gateReport: fixtureGate() });
		assert.equal(revision.gateReport?.name, "candidate-eval-fixture");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("legacy evolution store cannot bypass the evidence-gated promotion authority", async () => {
	const root = mkdtempSync(join(tmpdir(), "catui-legacy-evolution-"));
	try {
		const store = new EvolutionStore({ agentDir: root, cwd: root, sessionId: "session" });
		await assert.rejects(() => store.promote("workspace", "candidate-legacy"), /legacy.*promotion.*disabled/i);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("eval_fixture verifier candidates cannot mix multiple or behavioral artifacts", () => {
	const root = mkdtempSync(join(tmpdir(), "catui-evolution-evidence-"));
	try {
		const multiple = fixtureInput();
		multiple.artifacts.push({ ...multiple.artifacts[0]!, id: "evolved:eval_fixture:second", content: "{\"second\":true}" });
		assert.throws(() => createEvolutionCandidate(root, multiple, { id: () => "candidate-multiple-fixtures" }), /exactly one|cannot mix/i);
		const mixed = fixtureInput();
		mixed.artifacts.push(behavioralInput().artifacts[0]!);
		assert.throws(() => createEvolutionCandidate(root, mixed, { id: () => "candidate-mixed-fixture" }), /exactly one|cannot mix/i);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
