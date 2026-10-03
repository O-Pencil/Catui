/**
 * [WHO]: Proves the promotion baseline is captured by the store and bound into the evidence
 * [FROM]: Depends on the real refiner, the real store, and the real fail-closed promotion gate
 * [TO]: Consumed by test:evolution; implements the S08.1 baseline requirement
 * [HERE]: test/evolution-baseline-binding.test.ts - S08 baseline capture and evidence binding
 *
 * A previous attempt let the caller fill `baselineRevisionId`, which is not a control: a model
 * proposal, the refine tool, or a direct caller could omit it or state whatever it liked. These
 * tests never hand-write the field as an input. They drive the real chain
 *
 *     planEvolutionCandidate (real refiner, mocked model)
 *       -> createEvolutionCandidate (real store, the only creation path)
 *         -> promoteEvolutionCandidate (real gate, real integrity-bound evidence)
 *
 * and observe what the store captured. `EvolutionCandidateInput` deliberately has no baseline
 * field, so nothing upstream can influence it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planEvolutionCandidate } from "../extensions/optional/evolution/evolution-refiner.js";
import {
	createEvolutionCandidate,
	inspectEvolution,
	loadCurrentEvolution,
	promoteEvolutionCandidate,
} from "../extensions/optional/evolution/evolution-store.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type {
	EvolutionCandidate,
	EvolutionCandidateInput,
	EvolutionGateReport,
} from "../extensions/optional/evolution/evolution-types.js";
import type { ExtensionCommandContext } from "../core/extensions-host/types.js";

const AGENT_DIR = "/tmp/catui-evo-baseline-agent";
const CWD = "/tmp/catui-evo-baseline-cwd";

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

/** Real evidence, bound to the baseline the candidate itself declares. */
function gateFor(candidate: EvolutionCandidate): EvolutionGateReport {
	return {
		name: "builtin-harness-eval+heldout-benchmark",
		passed: true,
		checkedAt: "2026-08-25T01:00:00.000Z",
		metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
		benchmark: compareEvolutionBenchmarks(
			snapshot("baseline", candidate),
			snapshot("candidate", candidate),
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{
				candidateId: candidate.id,
				baselineRevisionId: candidate.baselineRevisionId ?? null,
				checkedAt: "2026-08-25T01:00:00.000Z",
			},
		),
	};
}

/**
 * The body is derived from the id, not shared. These tests are about baseline capture, and they
 * need several candidates in one scope; a single shared body under different ids is byte-identical
 * duplicate content, which the store now refuses on purpose.
 */
function skillArtifact(id: string) {
	return {
		kind: "skill_manifest" as const,
		id,
		title: `Skill ${id}`,
		// Skill bodies must carry all four sections. These tests are about baseline capture, so the
		// body is a compliant placeholder rather than the old one-line summary.
		content: [
			"## Prerequisites",
			"The matching task is already identified.",
			"",
			"## Steps",
			`Work the matching task, per ${id}.`,
			"",
			"## Pitfalls",
			"Do not widen this to unrelated tasks.",
			"",
			"## Verification",
			"Confirm the matching task's own success signal.",
		].join("\n"),
		applicability: "When the matching task appears.",
		nonApplicability: "Not for unrelated tasks.",
	};
}

const SKILL_ARTIFACT = skillArtifact("evolved:skill_manifest:captured-baseline");

/** A refiner call whose model output is fully controlled, including fields it tries to set. */
function refinerContext(modelJson: unknown): ExtensionCommandContext {
	return {
		cwd: CWD,
		agentDir: AGENT_DIR,
		sessionManager: { getEntries: () => [] },
		completeSimple: async () => JSON.stringify(modelJson),
	} as unknown as ExtensionCommandContext;
}

function modelProposal(extra: Record<string, unknown> = {}): unknown {
	return { artifacts: [skillArtifact("evolved:skill_manifest:captured-baseline")], predictions: [], ...extra };
}

function withRoot(run: (scopeRoot: string) => void | Promise<void>): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-baseline-"));
	return Promise.resolve(run(join(root, "scope"))).finally(() => rmSync(root, { recursive: true, force: true }));
}

function candidateById(scopeRoot: string, candidateId: string): EvolutionCandidate {
	const found = inspectEvolution(scopeRoot).candidates.find((entry) => entry.id === candidateId);
	assert.ok(found, `candidate ${candidateId} should be readable`);
	return found as EvolutionCandidate;
}

function directInput(artifactId = "evolved:skill_manifest:direct-seed"): EvolutionCandidateInput {
	return {
		scope: "session",
		summary: "seed a revision",
		rationale: "measured improvement",
		expectedOutcome: "held-out success improves",
		artifacts: [skillArtifact(artifactId)],
	};
}

/** Rewrite the persisted record to simulate a record written before the field existed. */
function stripBaselineField(scopeRoot: string, candidateId: string): void {
	const recordPath = join(scopeRoot, "candidates", candidateId, "proposal.json");
	const record = JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, unknown>;
	delete record.baselineRevisionId;
	writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf8");
}

test("the store captures a null baseline for a first candidate, from state not from input", async () => {
	await withRoot((scopeRoot) => {
		const candidate = createEvolutionCandidate(scopeRoot, directInput());
		assert.equal(candidate.baselineRevisionId, null, "first candidate must record a null baseline");
		assert.equal(loadCurrentEvolution(scopeRoot), undefined, "precondition: nothing is active");
	});
});

test("the refiner cannot choose the baseline; the store captures it", async () => {
	await withRoot(async (scopeRoot) => {
		const seed = createEvolutionCandidate(scopeRoot, directInput());
		const r1 = promoteEvolutionCandidate(scopeRoot, seed.id, { approvedBy: "test", gateReport: gateFor(seed) }).id;

		// The model output tries to declare its own baseline at the top level and on the artifact.
		const input = await planEvolutionCandidate(
			refinerContext(modelProposal({
				baselineRevisionId: "revision-the-model-invented",
				artifacts: [{ ...skillArtifact("evolved:skill_manifest:captured-baseline"), baselineRevisionId: "revision-the-model-invented" }],
			})),
			"workspace",
			"propose a refinement",
		);
		const candidate = createEvolutionCandidate(scopeRoot, input);

		assert.equal(candidate.baselineRevisionId, r1, "the store's captured baseline must win over the model's claim");
		assert.notEqual(candidate.baselineRevisionId, "revision-the-model-invented");
	});
});

test("a candidate created before the baseline moves cannot promote after it moves", async () => {
	await withRoot((scopeRoot) => {
		const seed = createEvolutionCandidate(scopeRoot, directInput());
		const r1 = promoteEvolutionCandidate(scopeRoot, seed.id, { approvedBy: "test", gateReport: gateFor(seed) }).id;

		const before = createEvolutionCandidate(scopeRoot, directInput());
		assert.equal(before.baselineRevisionId, r1, "precondition: created against r1");

		// Someone else advances the active revision.
		const mover = createEvolutionCandidate(scopeRoot, directInput());
		const r2 = promoteEvolutionCandidate(scopeRoot, mover.id, { approvedBy: "test", gateReport: gateFor(mover) }).id;
		assert.notEqual(r1, r2);

		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, before.id, { approvedBy: "test", gateReport: gateFor(before) }),
			/baseline is stale/,
		);
		assert.equal(loadCurrentEvolution(scopeRoot)?.revisionId, r2, "a rejected promotion must not move the pointer");
	});
});

test("a first-candidate null baseline stops being valid once a revision exists", async () => {
	await withRoot((scopeRoot) => {
		const first = createEvolutionCandidate(scopeRoot, directInput());
		assert.equal(first.baselineRevisionId, null);
		promoteEvolutionCandidate(scopeRoot, first.id, { approvedBy: "test", gateReport: gateFor(first) });

		// Rewrite this record to hold a null baseline, as one captured before the promotion would.
		const stale = createEvolutionCandidate(scopeRoot, directInput());
		rewriteBaseline(scopeRoot, stale.id, null);
		const reloaded = candidateById(scopeRoot, stale.id);
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, stale.id, { approvedBy: "test", gateReport: gateFor(reloaded) }),
			/baseline is stale/,
		);
	});
});

test("evidence gathered against a previous baseline cannot activate a candidate", async () => {
	await withRoot((scopeRoot) => {
		const seed = createEvolutionCandidate(scopeRoot, directInput());
		const r1 = promoteEvolutionCandidate(scopeRoot, seed.id, { approvedBy: "test", gateReport: gateFor(seed) }).id;

		const candidate = createEvolutionCandidate(scopeRoot, directInput());
		const reportForR1 = gateFor(candidate).benchmark!;
		assert.equal(reportForR1.baselineRevisionId, r1, "precondition: the report names r1");

		// Baseline moves before the evidence is used.
		const mover = createEvolutionCandidate(scopeRoot, directInput());
		const r2 = promoteEvolutionCandidate(scopeRoot, mover.id, { approvedBy: "test", gateReport: gateFor(mover) }).id;
		assert.notEqual(r1, r2);

		// The candidate is rejected on its stale baseline before the report is even considered.
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, candidate.id, {
				approvedBy: "test",
				gateReport: { ...gateFor(candidate), benchmark: reportForR1 },
			}),
			/baseline is stale/,
		);
	});
});

test("a report naming a different baseline is rejected even for a non-stale candidate", async () => {
	await withRoot((scopeRoot) => {
		const seed = createEvolutionCandidate(scopeRoot, directInput());
		promoteEvolutionCandidate(scopeRoot, seed.id, { approvedBy: "test", gateReport: gateFor(seed) });

		const candidate = createEvolutionCandidate(scopeRoot, directInput());
		// Evidence collected while nothing was active, presented against a candidate whose
		// baseline is now r1. The candidate's own baseline is current, so the report must fail.
		const wrongBaselineReport = compareEvolutionBenchmarks(
			snapshot("baseline", candidate),
			snapshot("candidate", candidate),
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{ candidateId: candidate.id, baselineRevisionId: null, checkedAt: "2026-08-25T01:00:00.000Z" },
		);
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, candidate.id, {
				approvedBy: "test",
				gateReport: { ...gateFor(candidate), benchmark: wrongBaselineReport },
			}),
			/integrity-bound benchmark evidence/,
		);
	});
});

test("a legacy record stays readable but may not promote once a revision exists", async () => {
	await withRoot((scopeRoot) => {
		const seed = createEvolutionCandidate(scopeRoot, directInput());
		promoteEvolutionCandidate(scopeRoot, seed.id, { approvedBy: "test", gateReport: gateFor(seed) });

		const legacy = createEvolutionCandidate(scopeRoot, directInput());
		stripBaselineField(scopeRoot, legacy.id);

		// Readable: inspection and direct load still work.
		const reloaded = candidateById(scopeRoot, legacy.id);
		assert.equal(reloaded.id, legacy.id);
		assert.equal("baselineRevisionId" in reloaded, false);
		assert.ok(inspectEvolution(scopeRoot).candidates.some((entry) => entry.id === legacy.id));

		// Not promotable: it cannot prove its base.
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, legacy.id, { approvedBy: "test", gateReport: gateFor(reloaded) }),
			/predates baseline capture/,
		);
	});
});

test("a legacy record with nothing active can still promote", async () => {
	await withRoot((scopeRoot) => {
		const legacy = createEvolutionCandidate(scopeRoot, directInput());
		stripBaselineField(scopeRoot, legacy.id);
		const reloaded = candidateById(scopeRoot, legacy.id);
		const revision = promoteEvolutionCandidate(scopeRoot, legacy.id, { approvedBy: "test", gateReport: gateFor(reloaded) });
		assert.equal(loadCurrentEvolution(scopeRoot)?.revisionId, revision.id);
	});
});

test("the refiner -> store -> promotion chain works end to end with a captured baseline", async () => {
	await withRoot(async (scopeRoot) => {
		const seed = createEvolutionCandidate(scopeRoot, directInput());
		const r1 = promoteEvolutionCandidate(scopeRoot, seed.id, { approvedBy: "test", gateReport: gateFor(seed) }).id;

		const input = await planEvolutionCandidate(refinerContext(modelProposal()), "workspace", "propose a refinement");
		const candidate = createEvolutionCandidate(scopeRoot, input);
		assert.equal(candidate.baselineRevisionId, r1, "baseline captured from the live scope");

		const revision = promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) });
		assert.equal(loadCurrentEvolution(scopeRoot)?.revisionId, revision.id);
		assert.equal(inspectEvolution(scopeRoot).current?.revisionId, revision.id);
	});
});

function rewriteBaseline(scopeRoot: string, candidateId: string, value: string | null): void {
	const recordPath = join(scopeRoot, "candidates", candidateId, "proposal.json");
	const record = JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, unknown>;
	record.baselineRevisionId = value;
	writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf8");
}
