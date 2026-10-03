/**
 * [WHO]: Proves one refinement cannot make more than four logical artifact changes, and is rejected whole rather than trimmed
 * [FROM]: Depends on node:test/assert/fs/os/path and the real store, gate evidence, and change formatter
 * [TO]: Consumed by test:evolution-boundaries; covers S07.3 so one proposal cannot rewrite the active set
 * [HERE]: test/evolution-edit-budget.test.ts - S07.3 refinement budget coverage
 *
 * The proposal asks for "at most four logical add/delete/replace changes per refinement, subject to a
 * documented mapping onto existing artifact semantics" and for over-budget output to be rejected
 * rather than truncated. Both halves are load-bearing: a budget that trims produces a different
 * proposal than the one that was evaluated, so these tests check that a rejected candidate leaves
 * no record at all rather than checking only that it was refused.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	inspectEvolution,
	loadActiveEvolutionArtifacts,
	promoteEvolutionCandidate,
} from "../extensions/optional/evolution/evolution-store.js";
import { formatEvolutionChanges } from "../extensions/optional/evolution/evolution-format.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionArtifact, EvolutionCandidate, EvolutionCandidateInput, EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";

const SESSION_ID = "edit-budget-test";
const BUDGET_ERROR = /exceeds the refinement budget: (\d+) logical changes \((\d+) added, (\d+) changed, (\d+) removed\)/;

function body(steps: string): string {
	return [
		"## Prerequisites",
		"A failing test is in hand.",
		"",
		"## Steps",
		steps,
		"",
		"## Pitfalls",
		"Rewriting instead of reading.",
		"",
		"## Verification",
		"Quote the output that shows the state.",
	].join("\n");
}

function skill(id: string, steps: string, overrides?: { skillId: string }): EvolutionArtifact {
	return {
		id,
		kind: "skill_manifest",
		title: `Skill ${id}`,
		content: body(steps),
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
		expectedOutcome: "the refinement lands where it is used",
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
	const root = mkdtempSync(join(tmpdir(), "catui-evo-budget-"));
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

function candidatesOnDisk(scopeRoot: string): string[] {
	const dir = join(scopeRoot, "candidates");
	return existsSync(dir) ? readdirSync(dir) : [];
}

/** Extracts the counts the reviewer is shown, so the budget can be checked against the same view. */
function shownChanges(scopeRoot: string, revisionId: string): { added: number; changed: number; removed: number } {
	const lines = formatEvolutionChanges(inspectEvolution(scopeRoot), revisionId).split("\n");
	// Each section is a heading line followed by its entries; entries run until the next heading.
	const count = (title: string) => {
		const start = lines.indexOf(`${title}:`);
		if (start < 0) return 0;
		let entries = 0;
		for (let i = start + 1; i < lines.length && lines[i].startsWith("- "); i += 1) {
			// An empty section renders a "- none" placeholder that also starts with "- ".
			if (lines[i] !== "- none") entries += 1;
		}
		return entries;
	};
	return { added: count("Added"), changed: count("Changed"), removed: count("Removed") };
}

test("four logical changes are accepted", async () => {
	await withScopeRoot((scopeRoot) => {
		const candidate = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:one", "One."),
			skill("evolved:skill_manifest:two", "Two."),
			skill("evolved:skill_manifest:three", "Three."),
			skill("evolved:skill_manifest:four", "Four."),
		]));

		assert.equal(candidate.status, "proposed");
		assert.equal(candidatesOnDisk(scopeRoot).length, 1);
	});
});

test("five logical changes are refused and nothing is written", async () => {
	await withScopeRoot((scopeRoot) => {
		let message = "";
		try {
			createEvolutionCandidate(scopeRoot, input([
				skill("evolved:skill_manifest:one", "One."),
				skill("evolved:skill_manifest:two", "Two."),
				skill("evolved:skill_manifest:three", "Three."),
				skill("evolved:skill_manifest:four", "Four."),
				skill("evolved:skill_manifest:five", "Five."),
			]));
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		assert.match(message, BUDGET_ERROR);
		// The point of rejecting at creation rather than at promotion: nothing is persisted, so
		// there is no half-written candidate for a later reader to trip over.
		assert.deepEqual(candidatesOnDisk(scopeRoot), [], "a refused candidate must leave no record on disk");
		assert.equal(inspectEvolution(scopeRoot).candidates.length, 0);
		assert.equal(inspectEvolution(scopeRoot).revisions.length, 0);
		assert.deepEqual(loadActiveEvolutionArtifacts(scopeRoot), []);
	});
});

test("a refused candidate leaves an existing active set untouched", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:one", "One."), skill("evolved:skill_manifest:two", "Two.")]);
		const before = loadActiveEvolutionArtifacts(scopeRoot).map((artifact) => artifact.id);

		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([
				skill("evolved:skill_manifest:one", "One, revised."),
				skill("evolved:skill_manifest:two", "Two, revised."),
				skill("evolved:skill_manifest:three", "Three."),
				skill("evolved:skill_manifest:four", "Four."),
				skill("evolved:skill_manifest:five", "Five."),
			])),
			BUDGET_ERROR,
		);

		assert.deepEqual(loadActiveEvolutionArtifacts(scopeRoot).map((artifact) => artifact.id), before);
		assert.equal(candidatesOnDisk(scopeRoot).length, 1, "only the promoted candidate's own record remains");
	});
});

test("deletes count against the budget", async () => {
	await withScopeRoot((scopeRoot) => {
		// Five skills cannot be seeded in one candidate either: the budget refuses five adds just
		// as it refuses five deletes, so the baseline is built in two steps.
		promote(scopeRoot, [
			skill("evolved:skill_manifest:one", "One."),
			skill("evolved:skill_manifest:two", "Two."),
			skill("evolved:skill_manifest:three", "Three."),
			skill("evolved:skill_manifest:four", "Four."),
		]);
		promote(scopeRoot, [
			skill("evolved:skill_manifest:one", "One."),
			skill("evolved:skill_manifest:two", "Two."),
			skill("evolved:skill_manifest:three", "Three."),
			skill("evolved:skill_manifest:four", "Four."),
			skill("evolved:skill_manifest:five", "Five."),
		]);

		// One add and five deletes is six logical changes.
		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([skill("evolved:skill_manifest:six", "Six.")])),
			(err: Error) => {
				const match = err.message.match(BUDGET_ERROR);
				assert.ok(match, err.message);
				assert.equal(match[1], "6", "total");
				assert.equal(match[2], "1", "one add");
				assert.equal(match[3], "0", "no replaces");
				assert.equal(match[4], "5", "five deletes");
				return true;
			},
		);
	});
});

test("five replaces are refused even though nothing is added or deleted", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [
			skill("evolved:skill_manifest:one", "One."),
			skill("evolved:skill_manifest:two", "Two."),
			skill("evolved:skill_manifest:three", "Three."),
			skill("evolved:skill_manifest:four", "Four."),
		]);
		promote(scopeRoot, [
			skill("evolved:skill_manifest:one", "One."),
			skill("evolved:skill_manifest:two", "Two."),
			skill("evolved:skill_manifest:three", "Three."),
			skill("evolved:skill_manifest:four", "Four."),
			skill("evolved:skill_manifest:five", "Five."),
		]);

		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([
				skill("evolved:skill_manifest:one", "One, revised."),
				skill("evolved:skill_manifest:two", "Two, revised."),
				skill("evolved:skill_manifest:three", "Three, revised."),
				skill("evolved:skill_manifest:four", "Four, revised."),
				skill("evolved:skill_manifest:five", "Five, revised."),
			])),
			(err: Error) => {
				const match = err.message.match(BUDGET_ERROR);
				assert.ok(match, err.message);
				assert.equal(match[1], "5");
				assert.equal(match[3], "5", "five replaces");
				return true;
			},
		);
	});
});

test("replaces count one each, and a renamed update is not charged as an add plus a delete", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:one", "One."), skill("evolved:skill_manifest:two", "Two.")]);

		// Same id, new body: one replace each, inside budget.
		const accepted = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:one", "One, revised."),
			skill("evolved:skill_manifest:two", "Two, revised."),
		]));
		assert.equal(accepted.status, "proposed");

		// Renaming through `overrides` is still one replace. Charging it as an add plus a delete
		// would make the update path S07.2 added the most expensive way to propose.
		const renamed = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:one-better", "One, revised further.", { skillId: "evolved:skill_manifest:one" }),
			skill("evolved:skill_manifest:two-better", "Two, revised further.", { skillId: "evolved:skill_manifest:two" }),
		]));
		assert.equal(renamed.status, "proposed");
	});
});

test("an unchanged artifact costs nothing", async () => {
	await withScopeRoot((scopeRoot) => {
		const original = skill("evolved:skill_manifest:one", "One.");
		promote(scopeRoot, [original, skill("evolved:skill_manifest:two", "Two.")]);

		// Re-sending the same artifact verbatim is not a logical change, so it must not spend budget.
		// Four real changes plus the verbatim one is exactly at the limit: charging the no-op would
		// push it to five and refuse it, so this case is the difference between pass and fail.
		const candidate = createEvolutionCandidate(scopeRoot, input([
			{ ...original },
			skill("evolved:skill_manifest:two", "Two, revised."),
			skill("evolved:skill_manifest:three", "Three."),
			skill("evolved:skill_manifest:four", "Four."),
			skill("evolved:skill_manifest:five", "Five."),
		]));

		assert.equal(candidate.status, "proposed");
		// Precondition: without the verbatim re-send this is five changes and would be refused.
		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([
				skill("evolved:skill_manifest:two", "Two, revised."),
				skill("evolved:skill_manifest:three", "Three."),
				skill("evolved:skill_manifest:four", "Four."),
				skill("evolved:skill_manifest:five", "Five."),
				skill("evolved:skill_manifest:six", "Six."),
			])),
			BUDGET_ERROR,
		);
	});
});

test("the budget is measured against the revision the candidate records as its baseline", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:one", "One."), skill("evolved:skill_manifest:two", "Two.")]);
		const revisionId = loadActiveEvolutionArtifacts(scopeRoot).length > 0
			? inspectEvolution(scopeRoot).current!.revisionId
			: "";

		const candidate = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:one", "One, revised."),
			skill("evolved:skill_manifest:two", "Two, revised."),
		]));

		assert.equal(candidate.baselineRevisionId, revisionId);
		// A rename plus a replace is two changes against a two-artifact baseline, leaving nothing
		// deleted: if the budget had been measured against an empty baseline it would have been two
		// adds and two deletes instead.
		const overBudget = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:one-new", "One.", { skillId: "evolved:skill_manifest:one" }),
			skill("evolved:skill_manifest:two-new", "Two.", { skillId: "evolved:skill_manifest:two" }),
			skill("evolved:skill_manifest:three", "Three."),
		]));
		assert.equal(overBudget.status, "proposed");
	});
});

test("the change count the budget uses is the count a reviewer is shown", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:one", "One."), skill("evolved:skill_manifest:two", "Two.")]);
		const revisionId = promote(scopeRoot, [
			skill("evolved:skill_manifest:one", "One, revised."),
			skill("evolved:skill_manifest:two", "Two, revised."),
			skill("evolved:skill_manifest:three", "Three."),
		]);

		// Two replaces and one add. Both sides hash through evolutionArtifactHash, so a change
		// counted by the budget is exactly a change the change report lists.
		assert.deepEqual(shownChanges(scopeRoot, revisionId), { added: 1, changed: 2, removed: 0 });
	});
});

test("a single override-only update against a five-artifact baseline is accepted and preserves the rest", async () => {
	// Regression from supervisor review. The budget charged every baseline artifact the candidate did
	// not name as a delete, so one skill update against a five-skill baseline came to five changes
	// and was refused. `resolveOverrideArtifacts` merges and carries the rest forward, so no delete
	// happens; the budget has to agree with the path that will actually run.
	await withScopeRoot((scopeRoot) => {
		const ids = Array.from({ length: 5 }, (_, i) => `evolved:skill_manifest:n${i}`);
		// Five skills cannot be seeded in one candidate either; the budget refuses five adds.
		promote(scopeRoot, ids.slice(0, 4).map((id, i) => skill(id, `Step ${i}.`)));
		promote(scopeRoot, ids.map((id, i) => skill(id, `Step ${i}.`)));
		assert.equal(loadActiveEvolutionArtifacts(scopeRoot).length, 5, "precondition: a five-artifact baseline");

		const candidate = createEvolutionCandidate(scopeRoot, input([
			skill(ids[0]!, "Step 0, clarified.", { skillId: ids[0]! }),
		]));
		assert.equal(candidate.status, "proposed");
		assert.deepEqual(candidate.validation.errors, [], "an accepted candidate reports no errors");

		const revisionId = promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) }).id;
		const active = loadActiveEvolutionArtifacts(scopeRoot);
		assert.deepEqual(active.map((artifact) => artifact.id), ids, "the four untouched skills must survive the update");
		assert.match(active[0]!.content, /Step 0, clarified\./);
		assert.equal(shownChanges(scopeRoot, revisionId).removed, 0);
	});
});

test("a candidate with no override still has its deletes charged", async () => {
	// The counterpart: removing artifacts for real must still cost, or the fix above would have
	// simply switched the budget off for the replace path.
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [
			skill("evolved:skill_manifest:one", "One."),
			skill("evolved:skill_manifest:two", "Two."),
			skill("evolved:skill_manifest:three", "Three."),
		]);
		promote(scopeRoot, [
			skill("evolved:skill_manifest:one", "One."),
			skill("evolved:skill_manifest:two", "Two."),
			skill("evolved:skill_manifest:three", "Three."),
			skill("evolved:skill_manifest:four", "Four."),
		]);

		// One replace, one add, and three real deletes, with no override anywhere.
		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([
				skill("evolved:skill_manifest:one", "One, revised."),
				skill("evolved:skill_manifest:five", "Five."),
			])),
			(err: Error) => {
				const match = err.message.match(BUDGET_ERROR);
				assert.ok(match, err.message);
				assert.equal(match[1], "5");
				assert.equal(match[2], "1", "one add");
				assert.equal(match[3], "1", "one replace");
				assert.equal(match[4], "3", "three deletes are real and must be charged");
				return true;
			},
		);
	});
});

test("a renamed override is budgeted as one replace but reported as an add and a delete", async () => {
	// The two views deliberately differ, and pretending otherwise would be a false claim. A
	// revision stores only the resolved artifact set with `overrides` stripped, so by the time the
	// change report runs there is nothing left saying which entry was superseded; it can only match
	// raw ids. The budget sees the instruction, so it charges one replace. Pinned here so the
	// mapping is documented behaviour rather than an accident, and so nobody later "fixes" one side
	// to match the other without deciding which is right.
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:old-name", "Do the thing.")]);
		const renamed = "evolved:skill_manifest:new-name";
		const revisionId = promote(scopeRoot, [skill(renamed, "Do the thing.", { skillId: "evolved:skill_manifest:old-name" })]);

		// Budget side: the baseline artifact is replaced, nothing added or removed.
		const candidate = createEvolutionCandidate(scopeRoot, input([
			skill(renamed, "Do the thing, carefully.", { skillId: "evolved:skill_manifest:old-name" }),
		]));
		assert.equal(candidate.status, "proposed", "a rename costs one replace, not an add plus a delete");

		// Report side: raw ids, so it reads as one add and one delete.
		assert.deepEqual(shownChanges(scopeRoot, revisionId), { added: 1, changed: 0, removed: 1 });
	});
});

test("an override artifact may not take an id that is also active", async () => {
	// Found by probing the S07.2 merge: naming an active artifact as the override target while
	// carrying a different active id produced a revision with one id twice. loadRevision rejects
	// duplicate ids, so that revision could never be read and the whole active set was quarantined
	// out of discovery with no error reaching the user.
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:x", "X."), skill("evolved:skill_manifest:y", "Y.")]);
		const candidate = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:x", "X merged.", { skillId: "evolved:skill_manifest:y" }),
		]));

		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) }),
			/an id cannot be both the override target and its replacement/,
		);
		assert.deepEqual(
			loadActiveEvolutionArtifacts(scopeRoot).map((artifact) => artifact.id),
			["evolved:skill_manifest:x", "evolved:skill_manifest:y"],
			"the active set must survive a refused override",
		);
	});
});
