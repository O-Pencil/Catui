/**
 * [WHO]: Proves an evolution candidate can update an already-active skill instead of adding a near-duplicate
 * [FROM]: Depends on node:test/assert/crypto/fs/os/path and the real store, gate evidence, and refiner
 * [TO]: Consumed by test:evolution-boundaries; covers S07.2 so a refinement lands on the same skill
 * [HERE]: test/evolution-overrides.test.ts - S07.2 update-over-duplicate coverage
 *
 * A revision normally replaces the active artifact set with the candidate's, which is right for
 * "here is something new" and wrong for "here is the same skill, improved". These tests promote
 * real revisions and read the resolved set back, so the merge is exercised end to end rather than
 * asserted against a stub. The negative cases matter as much as the positive one: an override that
 * names nothing active, a baseline that moved, and two artifacts claiming one target must all fail
 * loudly rather than quietly producing a set nobody asked for.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	inspectEvolution,
	loadActiveEvolutionArtifacts,
	promoteEvolutionCandidate,
	validateEvolutionCandidateInput,
} from "../extensions/optional/evolution/evolution-store.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionArtifact, EvolutionCandidate, EvolutionCandidateInput, EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";

const SESSION_ID = "overrides-test";
const SKILL = "evolved:skill_manifest:verify-before-claiming";
const OTHER = "evolved:skill_manifest:run-a-bounded-eval";

function sections(extra: string): string {
	return [
		"## Prerequisites",
		"A failing test or a stale claim is in hand.",
		"",
		"## Steps",
		extra,
		"",
		"## Pitfalls",
		"Rewriting the check instead of reading its output.",
		"",
		"## Verification",
		"Quote the command output that shows the state.",
	].join("\n");
}

function skill(id: string, steps: string, overrides?: { skillId: string }): EvolutionArtifact {
	return {
		id,
		kind: "skill_manifest",
		title: "A skill",
		content: sections(steps),
		applicability: "When a claim needs evidence.",
		nonApplicability: "Not for narration.",
		...(overrides ? { overrides } : {}),
	};
}

function input(artifacts: EvolutionArtifact[]): EvolutionCandidateInput {
	return {
		scope: "session",
		summary: "propose",
		rationale: "measured",
		expectedOutcome: "the skill lands where it is used",
		artifacts,
		evidence: { source: "test" },
	};
}

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

async function withScopeRoot(run: (scopeRoot: string) => Promise<void> | void): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-overrides-"));
	try {
		await run(getEvolutionScopeRoot(join(root, "agent"), { scope: "session", sessionId: SESSION_ID }));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function promote(scopeRoot: string, artifacts: EvolutionArtifact[]): string {
	const candidate = createEvolutionCandidate(scopeRoot, input(artifacts));
	return promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) }).id;
}

function seedTwoSkills(scopeRoot: string): string {
	return promote(scopeRoot, [skill(SKILL, "Read the output."), skill(OTHER, "Cap the run.")]);
}

test("a candidate with no overrides promotes exactly as it did before the field existed", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill(SKILL, "Read the output."), skill(OTHER, "Cap the run.")]);
		const revisionId = promote(scopeRoot, [skill("evolved:skill_manifest:brand-new", "Start here.")]);

		// Wholesale replacement is the pre-existing behavior and must not change silently.
		const active = loadActiveEvolutionArtifacts(scopeRoot);
		assert.deepEqual(active.map((artifact) => artifact.id), ["evolved:skill_manifest:brand-new"]);
		assert.equal(inspectEvolution(scopeRoot).revisions.find((r) => r.id === revisionId)?.artifacts.length, 1);
	});
});

test("a candidate without the field persists and reloads unchanged", async () => {
	await withScopeRoot((scopeRoot) => {
		const revisionId = promote(scopeRoot, [skill(SKILL, "Read the output.")]);

		// No `overrides` key is written, and a record written before this field existed has none to
		// read, so an absent field is the compatible case rather than a degraded one.
		const stored = inspectEvolution(scopeRoot).revisions.find((r) => r.id === revisionId)!;
		assert.ok(!("overrides" in stored.artifacts[0]!));
		assert.equal(loadActiveEvolutionArtifacts(scopeRoot)[0]!.overrides, undefined);
	});
});

test("an override updates the named skill in place rather than adding a copy", async () => {
	await withScopeRoot((scopeRoot) => {
		seedTwoSkills(scopeRoot);

		const updated = skill(SKILL, "Read the output twice, then quote it.", { skillId: SKILL });
		promote(scopeRoot, [updated]);

		const active = loadActiveEvolutionArtifacts(scopeRoot);
		assert.deepEqual(
			active.map((artifact) => artifact.id),
			[SKILL, OTHER],
			"the update must land on the same skill and must not disturb its neighbor",
		);
		assert.match(active[0]!.content, /Read the output twice, then quote it\./);
		assert.equal(active.filter((artifact) => artifact.id === SKILL).length, 1, "no near-duplicate may survive");
	});
});

test("an override may also rename the skill, and the old id stops being active", async () => {
	await withScopeRoot((scopeRoot) => {
		seedTwoSkills(scopeRoot);
		const renamed = "evolved:skill_manifest:verify-with-output";
		promote(scopeRoot, [skill(renamed, "Read the output.", { skillId: SKILL })]);

		const active = loadActiveEvolutionArtifacts(scopeRoot);
		assert.deepEqual(active.map((artifact) => artifact.id), [renamed, OTHER]);
		assert.equal(active.some((artifact) => artifact.id === SKILL), false, "the superseded id must not linger beside its successor");
	});
});

test("an override can be combined with a genuinely new artifact", async () => {
	await withScopeRoot((scopeRoot) => {
		seedTwoSkills(scopeRoot);
		promote(scopeRoot, [
			skill(SKILL, "Read the output twice.", { skillId: SKILL }),
			skill("evolved:skill_manifest:brand-new", "Start here."),
		]);

		assert.deepEqual(
			loadActiveEvolutionArtifacts(scopeRoot).map((artifact) => artifact.id),
			[SKILL, OTHER, "evolved:skill_manifest:brand-new"],
		);
	});
});

test("a plain artifact colliding with a carried-forward id replaces in place", async () => {
	// Only reachable inside the merge path, which is why it needs its own case: without the
	// collision guard the merged set carries one id twice, and loadRevision rejects duplicate ids,
	// so reading that revision back would quarantine it.
	await withScopeRoot((scopeRoot) => {
		seedTwoSkills(scopeRoot);
		promote(scopeRoot, [
			skill(OTHER, "Cap the run harder.", { skillId: OTHER }),
			skill(SKILL, "Read the output twice."),
		]);

		const active = loadActiveEvolutionArtifacts(scopeRoot);
		assert.deepEqual(active.map((artifact) => artifact.id), [SKILL, OTHER]);
		assert.match(active[0]!.content, /Read the output twice\./);
		assert.match(active[1]!.content, /Cap the run harder\./);
	});
});

test("without any override the merge never runs, so a lone artifact still replaces the set", async () => {
	// Pins the scope of the collision guard: it guards the merge path, it is not a change to the
	// pre-existing wholesale-replacement behavior.
	await withScopeRoot((scopeRoot) => {
		seedTwoSkills(scopeRoot);
		promote(scopeRoot, [skill(SKILL, "Read the output twice.")]);

		assert.deepEqual(loadActiveEvolutionArtifacts(scopeRoot).map((artifact) => artifact.id), [SKILL]);
	});
});

test("the resolved revision stores no overrides field, and its content hash matches what it stores", async () => {
	await withScopeRoot((scopeRoot) => {
		seedTwoSkills(scopeRoot);
		const revisionId = promote(scopeRoot, [skill(SKILL, "Read the output twice.", { skillId: SKILL })]);

		const stored = inspectEvolution(scopeRoot).revisions.find((r) => r.id === revisionId)!;
		assert.ok(stored.artifacts.every((artifact) => !("overrides" in artifact)), "the instruction is resolved at promotion, not persisted");
		// loadRevision re-hashes what it reads; reaching this line means the hash was consistent.
		assert.equal(stored.contentHash, `sha256:${createHash("sha256").update(JSON.stringify(stored.artifacts)).digest("hex")}`);
		assert.equal(loadActiveEvolutionArtifacts(scopeRoot).length, 2);
	});
});

test("an override naming a skill that is not active is refused", async () => {
	await withScopeRoot((scopeRoot) => {
		seedTwoSkills(scopeRoot);
		const candidate = createEvolutionCandidate(scopeRoot, input([skill(SKILL, "Read it.", { skillId: "evolved:skill_manifest:never-existed" })]));

		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) }),
			/overrides evolved:skill_manifest:never-existed, which is not active in baseline/,
		);
		assert.equal(
			loadActiveEvolutionArtifacts(scopeRoot).map((artifact) => artifact.id).join(),
			`${SKILL},${OTHER}`,
			"a refused override must leave the active set exactly as it was",
		);
	});
});

test("an override on a first candidate is refused because nothing is active to override", async () => {
	await withScopeRoot((scopeRoot) => {
		const candidate = createEvolutionCandidate(scopeRoot, input([skill(SKILL, "Read it.", { skillId: SKILL })]));

		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) }),
			/no revision is active to override/,
		);
		assert.deepEqual(loadActiveEvolutionArtifacts(scopeRoot), []);
	});
});

test("an override is refused once the baseline has moved", async () => {
	await withScopeRoot((scopeRoot) => {
		seedTwoSkills(scopeRoot);
		const candidate = createEvolutionCandidate(scopeRoot, input([skill(SKILL, "Read it.", { skillId: SKILL })]));
		promote(scopeRoot, [skill(OTHER, "Cap the run harder.")]);

		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) }),
			/baseline is stale/,
		);
	});
});

test("two artifacts may not claim the same override target", async () => {
	const report = validateEvolutionCandidateInput(input([
		skill(SKILL, "One.", { skillId: OTHER }),
		skill("evolved:skill_manifest:second", "Two.", { skillId: OTHER }),
	]));

	assert.equal(report.passed, false);
	assert.match(report.errors.join("\n"), /which another artifact in this candidate also overrides/);
});

test("an override must name an id in the same artifact kind", () => {
	const report = validateEvolutionCandidateInput(input([skill(SKILL, "Read it.", { skillId: "evolved:memory:notes" })]));

	assert.equal(report.passed, false);
	assert.match(report.errors.join("\n"), /overrides must name an evolved:skill_manifest: id/);
});

test("a malformed overrides payload is rejected rather than silently dropped", () => {
	for (const overrides of [{ skillId: 42 }, {}, { skillId: "  " }, "not-an-object"] as unknown[]) {
		const artifact = { ...skill(SKILL, "Read it."), overrides } as unknown as EvolutionArtifact;
		const report = validateEvolutionCandidateInput(input([artifact]));
		assert.equal(report.passed, false, `overrides=${JSON.stringify(overrides)} must be rejected`);
		assert.match(report.errors.join("\n"), /overrides must name an evolved:skill_manifest: id/);
	}
});

test("the refiner keeps a well-formed override and drops a malformed one instead of crashing", async () => {
	const { planEvolutionCandidate } = await import("../extensions/optional/evolution/evolution-refiner.js");
	const proposed = async (overrides: unknown) => {
		let captured: string | undefined;
		const ctx = {
			agentDir: mkdtempSync(join(tmpdir(), "catui-evo-refiner-")),
			cwd: process.cwd(),
			sessionManager: { getSessionId: () => SESSION_ID, getEntries: () => [] },
			completeSimple: async (_system: string, user: string) => {
				captured = user;
				return JSON.stringify({
					summary: "s",
					rationale: "r",
					expectedOutcome: "e",
					artifacts: [{ id: SKILL, kind: "skill_manifest", title: "t", content: sections("Do it."), applicability: "a", nonApplicability: "n", ...(overrides === undefined ? {} : { overrides }) }],
				});
			},
		};
		try {
			const planned = await planEvolutionCandidate(ctx as never, "session", "refine");
			assert.ok(captured?.includes("User refinement instructions"), "precondition: the prompt was built");
			return planned.artifacts[0]!;
		} finally {
			rmSync((ctx as { agentDir: string }).agentDir, { recursive: true, force: true });
		}
	};

	assert.deepEqual((await proposed({ skillId: SKILL })).overrides, { skillId: SKILL });
	// A bare string is accepted rather than dropped, since losing the instruction would silently
	// turn an update into a near-duplicate.
	assert.deepEqual((await proposed(SKILL)).overrides, { skillId: SKILL });
	for (const malformed of [{ skillId: "" }, { skillId: 7 }, {}, 5, []]) {
		assert.equal((await proposed(malformed)).overrides, undefined, `overrides=${JSON.stringify(malformed)} must be dropped`);
	}
});

test("the refiner system prompt tells the model to override rather than duplicate", async () => {
	const { readFileSync } = await import("node:fs");
	const source = readFileSync(new URL("../extensions/optional/evolution/evolution-refiner.ts", import.meta.url), "utf8");

	assert.match(source, /"overrides": \{ "skillId": "<that id>" \}/, "the producer must know the field exists");
	assert.match(source, /Leave "overrides" off when the artifact is genuinely new/);
	assert.match(source, /Already active at this scope\./, "precondition: the inventory the instruction refers to is still built");
});
