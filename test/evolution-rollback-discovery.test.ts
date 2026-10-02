/**
 * [WHO]: Proves a rolled-back revision disappears from real skill discovery and reload
 * [FROM]: Depends on node:test/assert/fs/os/path, the evolution store's public API, and the real resource loader
 * [TO]: Consumed by test:evolution; implements SL02 and the S08 rollback-discovery acceptance
 * [HERE]: test/evolution-rollback-discovery.test.ts - S08 rollback vs active discovery coverage
 *
 * The prior behavior kept a rolled-back revision discoverable: `discoverResources` unions the
 * active-revision scan with a historical scan over every revision ever promoted, and rollback
 * only moved the `current` pointer. These tests drive the real store, then a real
 * DefaultResourceLoader reload, so "active" means what the loader actually serves.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEvolutionCandidate,
	discoverLocalSkillPaths,
	loadActiveEvolutionSkillPaths,
	promoteEvolutionCandidate,
	readWithdrawnRevisionIds,
	rollbackEvolution,
} from "../extensions/optional/evolution/evolution-store.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionArtifact, EvolutionCandidate, EvolutionCandidateInput, EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";
import { DefaultResourceLoader } from "../core/platform/config/resource-loader.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";

/**
 * Promotion is fail-closed for skill_manifest artifacts: it demands a passing gate plus
 * integrity-bound held-out benchmark evidence. These helpers build that evidence the same way
 * test/evolution-benchmark-promotion.test.ts does, so this file exercises the real gate rather
 * than bypassing it.
 */
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

function benchmarkSnapshot(role: "baseline" | "candidate", candidateId: string, candidateContentHash: string): EvolutionBenchmarkSnapshotV1 {
	return {
		schemaVersion: 1,
		kind: "catui-evolution-benchmark-snapshot",
		role,
		...(role === "candidate" ? { candidateId, candidateContentHash } : {}),
		createdAt: "2026-08-25T00:00:00.000Z",
		corpus: { id: "pawbench", version: "1.0", digest: `sha256:${"a".repeat(64)}` },
		harness: { revisionId: role, commitSha: role === "baseline" ? "a".repeat(40) : "b".repeat(40) },
		execution: { model: "frozen-model", modelVersion: "v1", temperature: 0, maxTokens: 32_768, timeoutMs: 60_000, budgetUsd: 100 },
		runs: benchmarkRuns(role),
	};
}

function passingGate(candidate: EvolutionCandidate): EvolutionGateReport {
	return {
		name: "builtin-harness-eval+heldout-benchmark",
		passed: true,
		checkedAt: "2026-08-25T01:00:00.000Z",
		metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
		benchmark: compareEvolutionBenchmarks(
			benchmarkSnapshot("baseline", candidate.id, candidate.contentHash),
			benchmarkSnapshot("candidate", candidate.id, candidate.contentHash),
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{ candidateId: candidate.id, checkedAt: "2026-08-25T01:00:00.000Z" },
		),
	};
}

/** Create + evidence-promote a candidate, returning the new current revision id. */
function promoteSkillRevision(scopeRoot: string, input: EvolutionCandidateInput): string {
	const candidate = createEvolutionCandidate(scopeRoot, input);
	const revision = promoteEvolutionCandidate(scopeRoot, candidate.id, {
		approvedBy: "test",
		gateReport: passingGate(candidate),
	});
	return revision.id;
}

function currentRevisionId(scopeRoot: string): string {
	return JSON.parse(readFileSync(join(scopeRoot, "current.json"), "utf8")).revisionId;
}

function artifact(id: string, content: string): EvolutionArtifact {
	return {
		kind: "skill_manifest",
		id,
		title: `Skill ${id}`,
		content,
		applicability: "When the matching task appears.",
		nonApplicability: "Not for unrelated tasks.",
	};
}

function candidateInput(skills: EvolutionArtifact[]): EvolutionCandidateInput {
	return {
		scope: "session",
		summary: "seed skills",
		rationale: "fixture",
		expectedOutcome: "skills become discoverable",
		artifacts: skills,
		autoPromote: false,
	};
}

function withScopeRoot(run: (scopeRoot: string) => void | Promise<void>): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-rollback-"));
	return Promise.resolve(run(join(root, "scope"))).finally(() => rmSync(root, { recursive: true, force: true }));
}

/** Skill names a DefaultResourceLoader actually serves for these skill paths. */
async function discoveredSkillNames(paths: readonly string[]): Promise<string[]> {
	const cwd = mkdtempSync(join(tmpdir(), "catui-evo-loader-"));
	try {
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: cwd,
			settingsManager: SettingsManager.inMemory(),
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
			additionalSkillPaths: [...paths],
		});
		await loader.reload();
		return loader.getSkills().skills.map((skill) => skill.name).sort();
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("rollback withdraws that revision from both scans while keeping unrelated skills", async () => {
	await withScopeRoot(async (scopeRoot) => {
		// r1 seeds a good skill; r2 supersedes it with a bad one.
		const r1RevisionId = promoteSkillRevision(scopeRoot, candidateInput([artifact("evolved:skill_manifest:good", "Good procedure.")]));
		const r2RevisionId = promoteSkillRevision(scopeRoot, candidateInput([
			artifact("evolved:skill_manifest:good", "Good procedure."),
			artifact("evolved:skill_manifest:bad", "Bad procedure."),
		]));
		assert.notEqual(r1RevisionId, r2RevisionId);

		// A third, unrelated skill exists only in an earlier revision.
		const before = [...loadActiveEvolutionSkillPaths(scopeRoot), ...discoverLocalSkillPaths(scopeRoot)];
		assert.ok(
			(await discoveredSkillNames(before)).includes("evolved-bad"),
			"precondition: the current revision's bad skill is discoverable",
		);

		// Roll back r2 to r1.
		rollbackEvolution(scopeRoot, r1RevisionId, { requestedBy: "test" });

		assert.deepEqual(
			[...readWithdrawnRevisionIds(scopeRoot)],
			[r2RevisionId],
			"the rolled-back revision must be recorded as withdrawn",
		);

		const after = [...loadActiveEvolutionSkillPaths(scopeRoot), ...discoverLocalSkillPaths(scopeRoot)];
		const names = await discoveredSkillNames(after);
		assert.equal(names.includes("evolved-bad"), false, "withdrawn revision's skill must not be discoverable");
		assert.ok(names.includes("evolved-good"), "the rolled-back-to revision's skill must still be discoverable");
	});
});

test("a withdrawn revision's materialized directory is removed, not just unreferenced", async () => {
	await withScopeRoot(async (scopeRoot) => {
		const r1 = promoteSkillRevision(scopeRoot, candidateInput([artifact("evolved:skill_manifest:a", "A.")]));
		const r2 = promoteSkillRevision(scopeRoot, candidateInput([artifact("evolved:skill_manifest:b", "B.")]));

		discoverLocalSkillPaths(scopeRoot);
		const materialized = join(scopeRoot, "resources", "skills", "_local", r2);
		assert.ok(existsSync(materialized), "precondition: the historical scan materialized r2");

		rollbackEvolution(scopeRoot, r1, { requestedBy: "test" });
		discoverLocalSkillPaths(scopeRoot);
		assert.equal(existsSync(materialized), false, "withdrawn revision's on-disk skills must be deleted");
	});
});

test("a second rollback does not resurrect the first withdrawn revision", async () => {
	await withScopeRoot(async (scopeRoot) => {
		const mk = (id: string) => promoteSkillRevision(scopeRoot, candidateInput([artifact(`evolved:skill_manifest:${id}`, `${id}.`)]));
		const r1 = mk("one");
		const r2 = mk("two");
		rollbackEvolution(scopeRoot, r1, { requestedBy: "test" });

		const r3 = mk("three");
		rollbackEvolution(scopeRoot, r1, { requestedBy: "test" });

		const withdrawn = readWithdrawnRevisionIds(scopeRoot);
		assert.ok(withdrawn.has(r2), "the first withdrawn revision must still be withdrawn");
		assert.ok(withdrawn.has(r3), "the second withdrawn revision must be withdrawn");
		assert.equal(discoverLocalSkillPaths(scopeRoot).some((p) => p.endsWith(r2)), false);
		assert.equal(discoverLocalSkillPaths(scopeRoot).some((p) => p.endsWith(r3)), false);
	});
});

test("a malformed history log degrades to nothing withdrawn rather than throwing", async () => {
	await withScopeRoot(async (scopeRoot) => {
		promoteSkillRevision(scopeRoot, candidateInput([artifact("evolved:skill_manifest:x", "X.")]));
		appendCorruptHistory(scopeRoot);
		assert.deepEqual([...readWithdrawnRevisionIds(scopeRoot)], []);
		assert.ok(discoverLocalSkillPaths(scopeRoot).length > 0, "discovery must keep working");
	});
});

function appendCorruptHistory(scopeRoot: string): void {
	// A truncated JSON line must not break resource discovery.
	mkdirSync(scopeRoot, { recursive: true, mode: 0o700 });
	appendFileSync(join(scopeRoot, "history.jsonl"), '{"event":"rolled_back","rollbackOf"\n', { encoding: "utf8", mode: 0o600 });
}

test("skills unrelated to the rollback stay discoverable", async () => {
	await withScopeRoot(async (scopeRoot) => {
		// r1 carries two skills; r2 supersedes with a third. Rolling back r2 must keep both
		// original skills and drop only what r2 added.
		const r1 = promoteSkillRevision(scopeRoot, candidateInput([
			artifact("evolved:skill_manifest:keep1", "Keep one."),
			artifact("evolved:skill_manifest:keep2", "Keep two."),
		]));
		promoteSkillRevision(scopeRoot, candidateInput([
			artifact("evolved:skill_manifest:keep1", "Keep one."),
			artifact("evolved:skill_manifest:keep2", "Keep two."),
			artifact("evolved:skill_manifest:added", "Added later."),
		]));
		rollbackEvolution(scopeRoot, r1, { requestedBy: "test" });

		const names = await discoveredSkillNames([...loadActiveEvolutionSkillPaths(scopeRoot), ...discoverLocalSkillPaths(scopeRoot)]);
		assert.ok(names.includes("evolved-keep1"));
		assert.ok(names.includes("evolved-keep2"));
		assert.equal(names.includes("evolved-added"), false);
	});
});
