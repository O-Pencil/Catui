/**
 * [WHO]: Proves a candidate declaring a baseline revision cannot be promoted onto a different one
 * [FROM]: Depends on node:test/assert/fs/os/path, the real store API, and the real promotion gate
 * [TO]: Consumed by test:evolution; implements the S08.1 baseline-revision binding gap
 * [HERE]: test/evolution-baseline-binding.test.ts - S08 stale-baseline promotion coverage
 *
 * The report already binds candidate id, content hash, corpus and execution envelope. What it
 * could not bind was the revision the candidate was built to replace, so a candidate designed
 * against one active state could be promoted onto a different one carrying valid-looking
 * evidence for the wrong baseline.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEvolutionCandidate,
	promoteEvolutionCandidate,

} from "../extensions/optional/evolution/evolution-store.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionArtifact, EvolutionCandidate, EvolutionCandidateInput, EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";
import { readFileSync } from "node:fs";

function runs(role: "baseline" | "candidate"): EvolutionBenchmarkRunV1[] {
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
			latencyMs: 1_000,
			policyViolations: 0,
			replayDivergences: 0,
			unpairedToolCalls: 0,
		};
	})).flat();
}

function snapshot(role: "baseline" | "candidate", candidate: EvolutionCandidate): EvolutionBenchmarkSnapshotV1 {
	return {
		schemaVersion: 1,
		kind: "catui-evolution-benchmark-snapshot",
		role,
		...(role === "candidate" ? { candidateId: candidate.id, candidateContentHash: candidate.contentHash } : {}),
		createdAt: "2026-08-25T00:00:00.000Z",
		corpus: { id: "pawbench", version: "1.0", digest: `sha256:${"a".repeat(64)}` },
		harness: { revisionId: role, commitSha: "a".repeat(40) },
		execution: { model: "frozen-model", modelVersion: "v1", temperature: 0, maxTokens: 32_768, timeoutMs: 60_000, budgetUsd: 100 },
		runs: runs(role),
	};
}

function gate(candidate: EvolutionCandidate): EvolutionGateReport {
	return {
		name: "builtin-harness-eval+heldout-benchmark",
		passed: true,
		checkedAt: "2026-08-25T01:00:00.000Z",
		metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
		benchmark: compareEvolutionBenchmarks(
			snapshot("baseline", candidate),
			snapshot("candidate", candidate),
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{ candidateId: candidate.id, checkedAt: "2026-08-25T01:00:00.000Z" },
		),
	};
}

function input(baselineRevisionId?: string, id = "evolved:skill_manifest:next"): EvolutionCandidateInput {
	const artifact: EvolutionArtifact = { kind: "skill_manifest", id, title: "Next", content: "Do the next thing well." };
	return {
		scope: "session",
		summary: "refine the active skill",
		rationale: "measured improvement",
		expectedOutcome: "held-out success improves",
		artifacts: [artifact],
		...(baselineRevisionId ? { baselineRevisionId } : {}),
	};
}

function withRoot(run: (scopeRoot: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-baseline-"));
	try {
		run(join(root, "scope"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function currentId(scopeRoot: string): string | undefined {
	return JSON.parse(readFileSync(join(scopeRoot, "current.json"), "utf8")).revisionId;
}

test("a candidate whose baseline is current promotes normally", () => {
	withRoot((scopeRoot) => {
		const first = createEvolutionCandidate(scopeRoot, input(undefined, "evolved:skill_manifest:base"));
		const r1 = promoteEvolutionCandidate(scopeRoot, first.id, { approvedBy: "test", gateReport: gate(first) }).id;

		const second = createEvolutionCandidate(scopeRoot, input(r1));
		const revision = promoteEvolutionCandidate(scopeRoot, second.id, { approvedBy: "test", gateReport: gate(second) });
		assert.equal(currentId(scopeRoot), revision.id);
	});
});

test("a candidate built against a stale baseline cannot promote, even with valid evidence", () => {
	withRoot((scopeRoot) => {
		const first = createEvolutionCandidate(scopeRoot, input(undefined, "evolved:skill_manifest:base"));
		const r1 = promoteEvolutionCandidate(scopeRoot, first.id, { approvedBy: "test", gateReport: gate(first) }).id;

		// Someone else advances the active revision after this candidate was written.
		const other = createEvolutionCandidate(scopeRoot, input(undefined, "evolved:skill_manifest:other"));
		promoteEvolutionCandidate(scopeRoot, other.id, { approvedBy: "test", gateReport: gate(other) });

		const stale = createEvolutionCandidate(scopeRoot, input(r1));
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, stale.id, { approvedBy: "test", gateReport: gate(stale) }),
			/baseline is stale/,
		);
		const after = currentId(scopeRoot);
		const second = createEvolutionCandidate(scopeRoot, input(after!));
		promoteEvolutionCandidate(scopeRoot, second.id, { approvedBy: "test", gateReport: gate(second) });
		assert.equal(currentId(scopeRoot), JSON.parse(readFileSync(join(scopeRoot, "current.json"), "utf8")).revisionId);
	});
});

test("a candidate declaring a baseline cannot promote when nothing is active yet", () => {
	withRoot((scopeRoot) => {
		const candidate = createEvolutionCandidate(scopeRoot, input("revision-that-never-existed"));
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gate(candidate) }),
			/baseline is stale/,
		);
	});
});

test("candidates without a baseline field still promote, so older records stay valid", () => {
	withRoot((scopeRoot) => {
		// Existing persisted candidates predate the field entirely; they must not be rejected.
		const candidate = createEvolutionCandidate(scopeRoot, input(undefined));
		assert.equal((candidate as { baselineRevisionId?: string }).baselineRevisionId, undefined);
		const revision = promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gate(candidate) });
		assert.ok(revision.id);
	});
});

test("a baseline naming a nonexistent revision is not silently accepted", () => {
	withRoot((scopeRoot) => {
		const first = createEvolutionCandidate(scopeRoot, input(undefined, "evolved:skill_manifest:base"));
		const r1 = promoteEvolutionCandidate(scopeRoot, first.id, { approvedBy: "test", gateReport: gate(first) }).id;
		const ghost = createEvolutionCandidate(scopeRoot, input("revision-ghost"));
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, ghost.id, { approvedBy: "test", gateReport: gate(ghost) }),
			/baseline is stale/,
		);
		assert.equal(currentId(scopeRoot), r1, "a rejected promotion must not move the current pointer");
	});
});
