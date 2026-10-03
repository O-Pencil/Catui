/**
 * [WHO]: Proves a CLI-produced benchmark report is bound to the store-captured baseline and activates through the real gate
 * [FROM]: Depends on the real benchmark CLI, the real store, and the real promotion gate
 * [TO]: Consumed by test:evolution; covers scripts/evolution-benchmark.ts, which tsc --noEmit did not cover
 * [HERE]: test/evolution-benchmark-cli-binding.test.ts - CLI to promotion-gate evidence path
 *
 * `scripts/` is not in the main tsconfig include list, so the missing required baseline argument
 * was invisible to `npm run typecheck` and reached runtime. This file exercises the CLI end to
 * end for that reason, not only for the binding itself.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvolutionBenchmarkCli } from "../scripts/evolution-benchmark.js";
import { runEvolutionGate } from "../extensions/optional/evolution/evolution-gate.js";
import { getEvolutionScopeRoot } from "../extensions/optional/evolution/evolution-store.js";
import { passingEvolutionGate } from "./helpers/evolution-benchmark.js";
import { createEvolutionCandidate, inspectEvolution, promoteEvolutionCandidate } from "../extensions/optional/evolution/evolution-store.js";
import type { EvolutionCandidateInput } from "../extensions/optional/evolution/evolution-types.js";

const SCOPE = { scope: "session", sessionId: "cli-binding" } as const;

function input(artifactId: string): EvolutionCandidateInput {
	return {
		scope: "session",
		summary: "seed",
		rationale: "measured",
		expectedOutcome: "improves",
		artifacts: [{
			kind: "skill_manifest",
			id: artifactId,
			title: "Seeded",
			// A compliant body: the CLI binding under test is the report, not the skill text.
			// Derived from the id: these tests put several candidates in one scope, and a shared
			// body under different ids is byte-identical duplicate content, which the store refuses.
			content: [
				"## Prerequisites",
				"The matching task is already identified.",
				"",
				"## Steps",
				`Work the matching task, per ${artifactId}.`,
				"",
				"## Pitfalls",
				"Do not widen this to unrelated tasks.",
				"",
				"## Verification",
				"Confirm the matching task's own success signal.",
			].join("\n"),
			applicability: "Matching task.",
			nonApplicability: "Unrelated task.",
		}],
	};
}

/** Snapshot fixtures identical to the ones the CLI consumes. */
function writeSnapshots(dir: string, seed: EvolutionCandidateInput): { baseline: string; candidate: string } {
	const base = (role: "baseline" | "candidate", passThrough: number): unknown => ({
		schemaVersion: 1,
		kind: "catui-evolution-benchmark-snapshot",
		role,
		...(role === "candidate" ? { candidateId: "PLACEHOLDER" } : {}),
		createdAt: "2026-08-25T00:00:00.000Z",
		corpus: { id: "pawbench-test", version: "1", digest: `sha256:${"a".repeat(64)}` },
		harness: { revisionId: role, commitSha: role === "baseline" ? "a".repeat(40) : "b".repeat(40) },
		execution: { model: "frozen-test-model", modelVersion: "v1", temperature: 0, maxTokens: 32_768, timeoutMs: 60_000, budgetUsd: 100 },
		runs: Array.from({ length: 40 }, (_, task) => Array.from({ length: 3 }, (_, repetition) => {
			const success = task < passThrough;
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
		})).flat(),
	});
	mkdirSync(dir, { recursive: true });
	const baselinePath = join(dir, "baseline.json");
	const candidatePath = join(dir, "candidate.json");
	writeFileSync(baselinePath, JSON.stringify(base("baseline", 20), null, 2), "utf8");
	writeFileSync(candidatePath, JSON.stringify(base("candidate", 30), null, 2), "utf8");
	void seed;
	return { baseline: baselinePath, candidate: candidatePath };
}

/** Point the candidate snapshot at a real candidate: the pair validator requires both. */
function bindSnapshotToCandidate(path: string, candidate: { id: string; contentHash: string }): void {
	const raw = JSON.parse(readFileSync(path, "utf8")) as { candidateId?: string; candidateContentHash?: string };
	raw.candidateId = candidate.id;
	raw.candidateContentHash = candidate.contentHash;
	writeFileSync(path, JSON.stringify(raw, null, 2), "utf8");
}

function withRoot(run: (root: { agentDir: string; scopeRoot: string; work: string }) => Promise<void>): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-cli-"));
	const agentDir = join(root, "agent");
	const work = join(root, "work");
	return run({ agentDir, scopeRoot: getEvolutionScopeRoot(agentDir, SCOPE), work }).finally(() =>
		rmSync(root, { recursive: true, force: true }));
}

async function runCli(args: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
	const out: string[] = [];
	const err: string[] = [];
	const code = await runEvolutionBenchmarkCli(args, {
		stdout: (line) => out.push(line),
		stderr: (line) => err.push(line),
		checkedAt: "2026-08-25T01:00:00.000Z",
	});
	return { code, out, err };
}

test("the CLI refuses to fabricate a baseline for an unknown candidate", async () => {
	await withRoot(async ({ agentDir, work }) => {
		const { baseline, candidate } = writeSnapshots(work, input("evolved:skill_manifest:x"));
		const result = await runCli([
			"--baseline", baseline,
			"--candidate", candidate,
			"--candidate-id", "no-such-candidate",
			"--output", join(work, "out.json"),
			"--agent-dir", agentDir,
			"--scope", "session",
			"--session-id", SCOPE.sessionId,
		]);
		assert.equal(result.code, 2, "a missing candidate must be a hard error, not a null baseline");
		assert.match(result.err.join("\n"), /candidate not found/i);
	});
});

test("the CLI requires a scope and fails clearly when it is absent", async () => {
	await withRoot(async ({ agentDir, work }) => {
		const { baseline, candidate } = writeSnapshots(work, input("evolved:skill_manifest:x"));
		const result = await runCli([
			"--baseline", baseline, "--candidate", candidate,
			"--candidate-id", "whatever", "--output", join(work, "out.json"),
			"--agent-dir", agentDir, "--scope", "workspace",
		]);
		assert.equal(result.code, 2);
		assert.match(result.err.join("\n"), /requires --cwd/);
	});
});

test("CLI-generated report carries the store-captured baseline and activates through the real gate", async () => {
	await withRoot(async ({ agentDir, scopeRoot, work }) => {
		// A live revision exists, so the captured baseline is a real revision id.
		const seed = createEvolutionCandidate(scopeRoot, input("evolved:skill_manifest:seed"));
		const r1 = promoteEvolutionCandidate(scopeRoot, seed.id, {
			approvedBy: "test",
			gateReport: passingEvolutionGate(seed),
		}).id;

		const candidate = createEvolutionCandidate(scopeRoot, input("evolved:skill_manifest:from-cli"));
		assert.equal(candidate.baselineRevisionId, r1);

		// The candidate snapshot must name the real candidate id for pair validation to succeed.
		const { baseline, candidate: candidateSnapshot } = writeSnapshots(work, input("evolved:skill_manifest:from-cli"));
		bindSnapshotToCandidate(candidateSnapshot, candidate);

		const result = await runCli([
			"--baseline", baseline,
			"--candidate", candidateSnapshot,
			"--candidate-id", candidate.id,
			"--output", join(work, "out.json"),
			"--agent-dir", agentDir,
			"--scope", "session",
			"--session-id", SCOPE.sessionId,
		]);
		assert.equal(result.code, 0, result.err.join("\n"));

		// The report the CLI wrote is bound to the baseline the store captured.
		const report = JSON.parse(readFileSync(join(work, "out.json"), "utf8")) as { baselineRevisionId: string | null; passed: boolean };
		assert.equal(report.baselineRevisionId, r1, "the CLI must take the baseline from the store, not from a flag");
		assert.equal(report.passed, true);

		// Place it where the real gate looks, and let the real gate read it.
		const gateDir = join(work, ".catui", "evolution", "benchmarks");
		mkdirSync(gateDir, { recursive: true });
		writeFileSync(join(gateDir, `${candidate.id}.json`), readFileSync(join(work, "out.json"), "utf8"), "utf8");

		const gateReport = await runEvolutionGate(candidate, { cwd: work, agentDir });
		assert.equal(gateReport.passed, true, gateReport.failure);
		assert.equal(gateReport.benchmark?.baselineRevisionId, r1);

		// And the real store accepts it.
		const revision = promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "cli-test", gateReport });
		assert.equal(inspectEvolution(scopeRoot).current?.revisionId, revision.id);
	});
});

test("a CLI report for an outdated baseline is refused by the gate after the baseline moves", async () => {
	await withRoot(async ({ agentDir, scopeRoot, work }) => {
		const seed = createEvolutionCandidate(scopeRoot, input("evolved:skill_manifest:seed"));
		const r1 = promoteEvolutionCandidate(scopeRoot, seed.id, { approvedBy: "test", gateReport: passingEvolutionGate(seed) }).id;

		const candidate = createEvolutionCandidate(scopeRoot, input("evolved:skill_manifest:from-cli"));
		const { baseline, candidate: candidateSnapshot } = writeSnapshots(work, input("evolved:skill_manifest:from-cli"));
		bindSnapshotToCandidate(candidateSnapshot, candidate);

		const result = await runCli([
			"--baseline", baseline, "--candidate", candidateSnapshot,
			"--candidate-id", candidate.id, "--output", join(work, "out.json"),
			"--agent-dir", agentDir, "--scope", "session", "--session-id", SCOPE.sessionId,
		]);
		assert.equal(result.code, 0, result.err.join("\n"));

		// The baseline moves: a different candidate is promoted on top.
		const mover = createEvolutionCandidate(scopeRoot, input("evolved:skill_manifest:mover"));
		const r2 = promoteEvolutionCandidate(scopeRoot, mover.id, { approvedBy: "test", gateReport: passingEvolutionGate(mover) }).id;
		assert.notEqual(r1, r2);

		const gateDir = join(work, ".catui", "evolution", "benchmarks");
		mkdirSync(gateDir, { recursive: true });
		writeFileSync(join(gateDir, `${candidate.id}.json`), readFileSync(join(work, "out.json"), "utf8"), "utf8");

		// The gate verifies the report against the candidate's own baseline, which is still r1,
		// so this one passes; the store then rejects the candidate because r1 is no longer current.
		const gateReport = await runEvolutionGate(candidate, { cwd: work, agentDir });
		assert.equal(gateReport.passed, true, "the report is still internally consistent with its candidate");
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "cli-test", gateReport }),
			/baseline is stale/,
		);
	});
});
