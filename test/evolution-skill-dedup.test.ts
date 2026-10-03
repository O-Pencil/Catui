/**
 * [WHO]: Extends the store's duplicate-content refusal from eval_fixture traces to behavioral prose artifacts
 * [FROM]: Depends on node:test/assert/fs/os/path and the real store
 * [TO]: Consumed by test:evolution-boundaries; covers S07.1 so a refinement cannot add a copy of a skill that already exists
 * [HERE]: test/evolution-skill-dedup.test.ts - S07.1 behavioral dedup coverage
 *
 * The store already refused an eval_fixture whose content repeated one already in the ledger. That
 * check is untouched; this extends the same hash-comparison shape to the kinds whose content is
 * prose someone reads and follows. The two tiers matter and are tested separately: byte-identical
 * content arriving under a new id is a copy and is refused, while content that says the same thing
 * in different words is reported to a reviewer and still allowed through, because rephrasing a
 * procedure more clearly is most of what a refinement is for.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	loadActiveEvolutionArtifacts,
	promoteEvolutionCandidate,
	validateEvolutionCandidateInput,
} from "../extensions/optional/evolution/evolution-store.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionArtifact, EvolutionCandidate, EvolutionCandidateInput, EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";

const SESSION_ID = "skill-dedup-test";

/** A compliant skill body; every case varies the steps so only the tested field differs. */
function stepsText(steps: string): string {
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
		content: stepsText(steps),
		applicability: "When a claim needs evidence.",
		nonApplicability: "Not for narration.",
		...(overrides ? { overrides } : {}),
	};
}

function note(id: string, text: string): EvolutionArtifact {
	return { id, kind: "prompt_note", title: `Note ${id}`, content: text };
}

function input(artifacts: EvolutionArtifact[]): EvolutionCandidateInput {
	return {
		scope: "session",
		summary: "propose",
		rationale: "measured",
		expectedOutcome: "no copies reach the ledger",
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
	const root = mkdtempSync(join(tmpdir(), "catui-evo-dedup-"));
	try {
		await run(getEvolutionScopeRoot(join(root, "agent"), { scope: "session", sessionId: SESSION_ID }));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function promote(scopeRoot: string, artifacts: EvolutionArtifact[]): string {
	const candidate = createEvolutionCandidate(scopeRoot, input(artifacts));
	const pureFixture = candidate.artifacts.every((artifact) => artifact.kind === "eval_fixture");
	return promoteEvolutionCandidate(scopeRoot, candidate.id, {
		approvedBy: "test",
		gateReport: pureFixture
			? {
				name: "candidate-eval-fixture",
				passed: true,
				checkedAt: "2026-08-25T01:00:00.000Z",
				metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
			}
			: gateFor(candidate),
	}).id;
}

test("an identical skill body under a new id is refused", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:original", "Read the output, then quote it.")]);

		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([skill("evolved:skill_manifest:copy", "Read the output, then quote it.")])),
			/Duplicate skill_manifest content already exists in/,
		);
	});
});

test("the duplicate is found in a pending candidate, not only in a promoted revision", async () => {
	await withScopeRoot((scopeRoot) => {
		const pending = createEvolutionCandidate(scopeRoot, input([skill("evolved:skill_manifest:pending", "Check the diff first.")]));

		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([skill("evolved:skill_manifest:copy", "Check the diff first.")])),
			/Duplicate skill_manifest content already exists in candidate/,
		);
		assert.equal(pending.status, "proposed");
	});
});

test("a duplicate is found across a rejected candidate's successor, so rejection does not open a hole", async () => {
	await withScopeRoot((scopeRoot) => {
		// A rejected candidate is not compared, but the record that replaced it is: two proposals of
		// the same content cannot slip through by making the first one get rejected in between.
		promote(scopeRoot, [skill("evolved:skill_manifest:kept", "Name the risk in one line.")]);

		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([skill("evolved:skill_manifest:copy", "Name the risk in one line.")])),
			/already exists in (candidate|revision)/,
		);
		// The promoted candidate is still on the books, so the ledger is searched as a whole rather
		// than as "whichever source happens to be checked first".
		assert.match(
			(() => {
				try {
					createEvolutionCandidate(scopeRoot, input([skill("evolved:skill_manifest:copy2", "Name the risk in one line.")]));
					return "";
				} catch (error) {
					return error instanceof Error ? error.message : String(error);
				}
			})(),
			/evolved:skill_manifest:kept/,
		);
	});
});

test("the same kind of content is refused for other prose artifacts too", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [note("evolved:prompt_note:first", "Prefer the smallest evidence-backed change.")]);

		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([note("evolved:prompt_note:second", "Prefer the smallest evidence-backed change.")])),
			/Duplicate prompt_note content already exists in/,
		);
	});
});

test("prose that differing only in wording is reported and still allowed", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:original", "Read the output, then quote it.")]);

		// Only differences that normalization is meant to collapse: extra whitespace, a bold run, a
		// different heading depth. A different word is a different sentence and must not be reported.
		const candidate = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:reworded", "Read the  output,\n\tthen quote it."),
		]));

		assert.equal(candidate.status, "proposed", "rephrasing a procedure must not be blocked outright");
		const flagged = candidate.validation.warnings.filter((warning) => /differing only in wording/.test(warning));
		assert.equal(flagged.length, 1, `reported once per pair, got: ${JSON.stringify(candidate.validation.warnings)}`);
		assert.match(candidate.validation.warnings.join("\n"), /evolved:skill_manifest:reworded/);
		assert.match(candidate.validation.warnings.join("\n"), /evolved:skill_manifest:original/);
	});
});

test("normalization ignores markdown emphasis, heading depth, and case, so those are not new skills", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:original", "Read the **output**.")]);

		const candidate = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:restyled", "read the _output_."),
		]));

		assert.equal(
			candidate.validation.warnings.filter((warning) => /differing only in wording/.test(warning)).length,
			1,
			"emphasis and case changes are formatting, not meaning",
		);
	});
});

test("normalization is Unicode-aware, so two different Chinese skills are not one skill", async () => {
	await withScopeRoot((scopeRoot) => {
		// An ASCII-only filter would erase every CJK character and report these as identical.
		promote(scopeRoot, [note("evolved:prompt_note:one", "优先选择最小的可验证改动。")]);
		const candidate = createEvolutionCandidate(scopeRoot, input([note("evolved:prompt_note:two", "先跑测试再改代码。")]));

		assert.deepEqual(
			candidate.validation.warnings.filter((warning) => /differing only in wording/.test(warning)),
			[],
			"plainly different Chinese notes must not be reported as the same text",
		);
		assert.equal(candidate.status, "proposed");
	});
});

test("a genuinely different skill is neither refused nor warned about", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:original", "Read the output, then quote it.")]);
		const candidate = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:different", "Cap the run, then record the cost."),
		]));

		assert.equal(candidate.status, "proposed");
		assert.deepEqual(candidate.validation.warnings.filter((w) => /differing only in wording/.test(w)), []);
	});
});

test("an update is not reported as a near-duplicate of what it updates", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:original", "Read the output.")]);
		const sameId = createEvolutionCandidate(scopeRoot, input([skill("evolved:skill_manifest:original", "Read the output, more carefully.")]));
		const renamed = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:renamed", "Read the output, and then quote it.", { skillId: "evolved:skill_manifest:original" }),
		]));

		for (const candidate of [sameId, renamed]) {
			assert.deepEqual(
				candidate.validation.warnings.filter((w) => /differing only in wording/.test(w)),
				[],
				"an update declares which entry it supersedes and must not be flagged as a copy of it",
			);
		}
	});
});

test("a same-id artifact is an update, never a copy, and is never refused", async () => {
	// Promotion replaces the active set unless an override merges, so updating one skill means
	// listing its untouched neighbours verbatim. Refusing that would block every multi-skill update,
	// which is why the exact-duplicate rule is keyed on a new id and not on content alone.
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:one", "One."), skill("evolved:skill_manifest:two", "Two.")]);

		const carried = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:one", "One."),
			skill("evolved:skill_manifest:two", "Two, revised."),
		]));
		assert.equal(carried.status, "proposed", "re-listing an untouched skill verbatim must be allowed");

		// A rename that declares itself an update is allowed even with an unchanged body, because
		// `overrides` says which entry it supersedes.
		promote(scopeRoot, [skill("evolved:skill_manifest:one", "One."), skill("evolved:skill_manifest:two", "Two, revised.")]);
		const renamed = createEvolutionCandidate(scopeRoot, input([
			skill("evolved:skill_manifest:two-renamed", "Two, revised.", { skillId: "evolved:skill_manifest:two" }),
		]));
		assert.equal(renamed.status, "proposed", "a declared rename is an update, not a copy");
	});
});

test("a refused duplicate leaves no record and no change to the active set", async () => {
	await withScopeRoot((scopeRoot) => {
		promote(scopeRoot, [skill("evolved:skill_manifest:original", "Read the output, then quote it.")]);
		const before = loadActiveEvolutionArtifacts(scopeRoot).map((artifact) => artifact.id);

		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([skill("evolved:skill_manifest:copy", "Read the output, then quote it.")])),
			/Duplicate skill_manifest content/,
		);
		assert.deepEqual(loadActiveEvolutionArtifacts(scopeRoot).map((artifact) => artifact.id), before);
	});
});

test("the eval_fixture duplicate rule is unchanged", async () => {
	await withScopeRoot((scopeRoot) => {
		const trace = [{
			version: 1, eventId: "e1", sequence: 1, timestamp: 1, runId: "r",
			kind: "run.started",
			payload: { loopFramework: "standard", inputFingerprint: "sha256:a", outputFingerprint: "sha256:b" },
		}];
		const fixture = (id: string) => ({
			id,
			kind: "eval_fixture" as const,
			title: `Trace ${id}`,
			content: JSON.stringify(trace, null, 2),
		});
		promote(scopeRoot, [fixture("evolved:eval_fixture:first")]);

		// The original wording: an eval_fixture repeated under a new id is refused, and the error
		// still names the fixture kind.
		assert.throws(
			() => createEvolutionCandidate(scopeRoot, input([fixture("evolved:eval_fixture:second")])),
			/Duplicate eval_fixture content already exists in/,
		);
	});
});

test("eval_fixture content is not judged by prose normalization", async () => {
	await withScopeRoot((scopeRoot) => {
		// A trace is a record, not prose. Case-folding its JSON would change values, so the trace path
		// keeps comparing exact content and the prose path must leave it alone.
		const base = { version: 1, eventId: "e1", sequence: 1, timestamp: 1, runId: "r", kind: "run.started" };
		const first = { id: "evolved:eval_fixture:a", kind: "eval_fixture" as const, title: "A", content: JSON.stringify({ ...base, payload: { inputFingerprint: "sha256:A" } }) };
		const second = { id: "evolved:eval_fixture:b", kind: "eval_fixture" as const, title: "B", content: JSON.stringify({ ...base, payload: { inputFingerprint: "sha256:a" } }) };
		promote(scopeRoot, [first]);

		const candidate = createEvolutionCandidate(scopeRoot, input([second]));
		assert.equal(candidate.status, "proposed", "case-differing JSON is a different record, not a prose variant");
		assert.equal(validateEvolutionCandidateInput(input([second])).passed, true);
	});
});
