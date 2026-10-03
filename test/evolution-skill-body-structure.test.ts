/**
 * [WHO]: Pins the structural contract a skill_manifest body must satisfy before the store accepts it
 * [FROM]: Depends on node:test/assert/fs/os/path, the real evolution store, and real promoted revisions
 * [TO]: Consumed by test:evolution-boundaries; covers S06.6 so a promoted skill is a procedure, not a paragraph
 * [HERE]: test/evolution-skill-body-structure.test.ts - S06.6 skill body structure coverage
 *
 * A skill_manifest is materialized into a real SKILL.md that the agent follows, so a body that
 * omits prerequisites, pitfalls, or verification produces a skill nobody can apply or check. The
 * rule must reject those at candidate time while leaving everything already on disk readable:
 * revisions are loaded, rendered, and rolled back without validation, and that is asserted here
 * rather than assumed, because a store that re-validated on read would strand every skill
 * promoted before this rule existed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	loadActiveEvolutionArtifacts,
	loadActiveEvolutionSkillPaths,
	promoteEvolutionCandidate,
	rollbackEvolution,
	validateEvolutionCandidateInput,
} from "../extensions/optional/evolution/evolution-store.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionArtifact, EvolutionCandidate, EvolutionCandidateInput, EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";

const SESSION_ID = "skill-body-test";

const SECTIONS: ReadonlyArray<{ key: string; heading: string; body: string }> = [
	{ key: "prerequisites", heading: "## Prerequisites", body: "The matching task is already identified." },
	{ key: "steps", heading: "## Steps", body: "Work the matching task." },
	{ key: "pitfalls", heading: "## Pitfalls", body: "Do not widen this to unrelated tasks." },
	{ key: "verification", heading: "## Verification", body: "Confirm the matching task's own success signal." },
];

/** A compliant body, optionally with named sections removed or replaced. */
function body(overrides: { omit?: string; replace?: Record<string, string> } = {}): string {
	return SECTIONS
		.filter((section) => section.key !== overrides.omit)
		.map((section) => `${overrides.replace?.[section.key] ?? section.heading}\n${section.body}`)
		.join("\n\n");
}

function skill(
	overrides: Partial<EvolutionArtifact> = {},
	bodyOverride?: string,
): EvolutionArtifact {
	return {
		id: "evolved:skill_manifest:structured",
		kind: "skill_manifest",
		title: "Structured skill",
		content: bodyOverride ?? body(),
		applicability: "When the matching task appears.",
		nonApplicability: "Not for unrelated tasks.",
		...overrides,
	};
}

function input(artifacts: EvolutionArtifact[]): EvolutionCandidateInput {
	return {
		scope: "session",
		summary: "seed a skill",
		rationale: "measured improvement",
		expectedOutcome: "the skill is usable as a procedure",
		artifacts,
		evidence: { source: "test" },
	};
}

function errorsFor(artifacts: EvolutionArtifact[]): string {
	return validateEvolutionCandidateInput(input(artifacts)).errors.join("\n");
}

async function withScopeRoot(run: (scopeRoot: string) => Promise<void> | void): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-skill-body-"));
	try {
		await run(getEvolutionScopeRoot(join(root, "agent"), { scope: "session", sessionId: SESSION_ID }));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
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

test("a skill body carrying every required section is accepted and promotes", async () => {
	await withScopeRoot((scopeRoot) => {
		const candidate = createEvolutionCandidate(scopeRoot, input([skill()]));
		const revision = promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) });

		assert.equal(revision.artifacts.length, 1);
		assert.deepEqual(validateEvolutionCandidateInput(input([skill()])).errors, []);
	});
});

for (const section of SECTIONS) {
	test(`a skill body missing the ${section.key} section is rejected with a locatable error`, () => {
		const errors = errorsFor([skill({}, body({ omit: section.key }))]);

		assert.match(errors, new RegExp(`evolved:skill_manifest:structured`));
		assert.match(errors, new RegExp(`missing a ${section.key} section`));
		// The error has to name the heading to add, or the author is left guessing the format.
		assert.match(errors, new RegExp(`add a markdown heading "## ${section.heading.slice(3)}"`));
	});
}

test("a skill with no trigger or no limits is rejected", () => {
	assert.match(errorsFor([skill({ applicability: "" })]), /needs applicability describing its trigger/);
	assert.match(errorsFor([skill({ nonApplicability: "   " })]), /needs nonApplicability describing its limits/);
});

test("a bare-prose skill is rejected", () => {
	const errors = errorsFor([skill({}, "A reusable procedure that a real refiner run proposed.")]);

	for (const section of SECTIONS) {
		assert.match(errors, new RegExp(`missing a ${section.key} section`));
	}
});

test("section headings are matched by alias, depth, and case", () => {
	const aliased = errorsFor([skill({}, body({ replace: {
		prerequisites: "### Before you start",
		steps: "## Procedure",
		pitfalls: "## Gotchas",
		verification: "## How to verify",
	} }))]);

	assert.deepEqual(aliased, "", "a section written with a recognized alias must not be reported missing");
	assert.deepEqual(validateEvolutionCandidateInput(input([skill({}, body({ replace: { steps: "## PROCEDURE" } }))])).errors, []);
});

test("a heading that only appears inside a fenced code block does not satisfy the rule", () => {
	// Otherwise a skill can pass validation with sample text and still ship a body with no
	// structure, which is precisely the failure this rule exists to prevent.
	const faked = SECTIONS.map((section) => "```md\n" + section.heading + "\n" + section.body + "\n```").join("\n\n");
	const errors = errorsFor([skill({}, faked)]);

	for (const section of SECTIONS) {
		assert.match(errors, new RegExp(`missing a ${section.key} section`));
	}
});

test("a shorter nested fence cannot close a longer open fence", () => {
	// Regression from supervisor review: fence tracking that toggles on any fence-looking line let a
	// body open with four backticks, close the block with three, and have every required heading
	// counted as real sections. CommonMark requires the closing run to repeat the marker and be at
	// least as long as the opening one.
	const nested = ["````markdown", "```", ...SECTIONS.map((section) => section.heading), "````"].join("\n");
	const errors = errorsFor([skill({}, nested)]);

	for (const section of SECTIONS) {
		assert.match(errors, new RegExp(`missing a ${section.key} section`), `${section.key} must not count inside a four-backtick block`);
	}
});

test("a fence of a different marker character does not close an open fence", () => {
	// ``` open, ~~~ close: mixing markers is not a valid close, so the block stays open and the
	// headings inside it stay sample text.
	const mixed = ["```", "~~~", ...SECTIONS.map((section) => section.heading), "~~~", "```"].join("\n");
	const errors = errorsFor([skill({}, mixed)]);

	for (const section of SECTIONS) {
		assert.match(errors, new RegExp(`missing a ${section.key} section`));
	}
});

test("a tilde fence is tracked the same way as a backtick fence", () => {
	const tilde = ["~~~~", "~~~", ...SECTIONS.map((section) => section.heading), "~~~~"].join("\n");
	assert.match(errorsFor([skill({}, tilde)]), /missing a steps section/);
});

test("a closing fence carrying an info string does not close the block", () => {
	// Three backticks plus trailing text is not a valid close. Without the info-string check it
	// would close the block and the headings after it would be counted as real sections.
	const withInfoString = ["```", "``` not-a-close", ...SECTIONS.map((section) => section.heading), "```"].join("\n");
	const errors = errorsFor([skill({}, withInfoString)]);

	for (const section of SECTIONS) {
		assert.match(errors, new RegExp(`missing a ${section.key} section`));
	}
});

test("ordinary fenced samples are excluded in both marker styles", () => {
	// Positive control, or the rule would be unusable for any skill that demonstrates a section.
	const withSamples = SECTIONS
		.flatMap((section) => [section.heading, "```md", `## ${section.canonical} sample`, "```", "~~~md", `## ${section.canonical} sample`, "~~~"])
		.join("\n");
	assert.deepEqual(validateEvolutionCandidateInput(input([skill({}, withSamples)])).errors, []);

	// Counter-example: re-opening the block with a bare fence hides the real heading behind a sample.
	const smuggled = SECTIONS
		.map((section, index) => (index === SECTIONS.length - 1 ? "```\n## Verification\n```" : section.heading))
		.join("\n\n");
	assert.match(errorsFor([skill({}, smuggled)]), /missing a verification section/);
});

test("the structure rule applies to skill_manifest only", () => {
	// A prompt_note or a memory is not a procedure; demanding headings of them would be noise.
	const kinds = ["prompt_note", "memory", "tool_spec", "subagent_spec"] as const;
	for (const kind of kinds) {
		const artifact: EvolutionArtifact = {
			id: `evolved:${kind}:plain`,
			kind,
			title: `Plain ${kind}`,
			content: "A one-line note with no headings at all.",
			applicability: "When relevant.",
			nonApplicability: "Otherwise.",
		};
		assert.deepEqual(
			validateEvolutionCandidateInput(input([artifact])).errors,
			[],
			`${kind} must not be held to the skill body structure rule`,
		);
	}
});

test("eval_fixture candidates are unaffected by the skill body rule", async () => {
	await withScopeRoot((scopeRoot) => {
		const trace = { version: 1, eventId: "e1", sequence: 1, timestamp: 1, runId: "r", kind: "run.started", payload: { loopFramework: "standard", inputFingerprint: "sha256:a", outputFingerprint: "sha256:b" } };
		const fixture: EvolutionArtifact = {
			id: "evolved:eval_fixture:trace",
			kind: "eval_fixture",
			title: "Trace fixture",
			content: JSON.stringify([trace], null, 2),
		};
		const candidateInput: EvolutionCandidateInput = { ...input([fixture]), summary: "seed a fixture" };
		assert.deepEqual(validateEvolutionCandidateInput(candidateInput).errors, []);

		const candidate = createEvolutionCandidate(scopeRoot, candidateInput);
		promoteEvolutionCandidate(scopeRoot, candidate.id, {
			approvedBy: "test",
			gateReport: {
				name: "candidate-eval-fixture",
				passed: true,
				checkedAt: "2026-08-25T01:00:00.000Z",
				metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
			},
		});
		assert.equal(loadActiveEvolutionArtifacts(scopeRoot).length, 1);
	});
});

/**
 * Writes a revision straight to disk, the way one promoted before the body rule existed would look.
 * Going through createEvolutionCandidate would prove nothing: that path is exactly where the rule
 * now applies, so it could only ever produce conforming records.
 */
function writeLegacyRevision(scopeRoot: string, revisionId: string, artifacts: EvolutionArtifact[]): void {
	mkdirSync(join(scopeRoot, "revisions", revisionId), { recursive: true, mode: 0o700 });
	writeFileSync(join(scopeRoot, "revisions", revisionId, "manifest.json"), `${JSON.stringify({
		schemaVersion: 1,
		id: revisionId,
		candidateId: `candidate-${revisionId}`,
		scope: "session",
		summary: "promoted before the skill body rule existed",
		rationale: "legacy",
		expectedOutcome: "legacy",
		artifacts,
		contentHash: `sha256:${createHash("sha256").update(JSON.stringify(artifacts)).digest("hex")}`,
		createdAt: "2026-01-01T00:00:00.000Z",
		approvedBy: "legacy",
	}, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	writeFileSync(join(scopeRoot, "current.json"), `${JSON.stringify({
		schemaVersion: 1,
		revisionId,
		activatedAt: "2026-01-01T00:00:00.000Z",
		activatedBy: "legacy",
	}, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

const LEGACY_BODY = "A reusable procedure that a real refiner run proposed.";

test("a skill promoted before this rule existed still loads as the active revision", async () => {
	await withScopeRoot((scopeRoot) => {
		writeLegacyRevision(scopeRoot, "revision-legacy", [skill({ id: "evolved:skill_manifest:legacy", content: LEGACY_BODY })]);

		const active = loadActiveEvolutionArtifacts(scopeRoot);
		assert.equal(active.length, 1, "a non-conforming stored skill must not be quarantined out of discovery");
		assert.equal(active[0]!.id, "evolved:skill_manifest:legacy");
		assert.equal(active[0]!.content, LEGACY_BODY, "a legacy body must survive the round trip byte for byte");
		// Precondition, so the two assertions above cannot pass by the rule simply not existing.
		assert.ok(
			validateEvolutionCandidateInput(input([active[0]!])).errors.length > 0,
			"this body must fail today's rule, otherwise the test is vacuous",
		);
	});
});

test("a legacy skill is still rollback-able", async () => {
	await withScopeRoot((scopeRoot) => {
		writeLegacyRevision(scopeRoot, "revision-legacy", [skill({ id: "evolved:skill_manifest:legacy", content: LEGACY_BODY })]);
		writeLegacyRevision(scopeRoot, "revision-newer", [skill({ id: "evolved:skill_manifest:newer" })]);

		rollbackEvolution(scopeRoot, "revision-legacy", { requestedBy: "test" });

		const active = loadActiveEvolutionArtifacts(scopeRoot);
		assert.equal(active.length, 1);
		assert.equal(active[0]!.id, "evolved:skill_manifest:legacy");
	});
});

test("a legacy skill still materializes into a discoverable SKILL.md", async () => {
	await withScopeRoot((scopeRoot) => {
		writeLegacyRevision(scopeRoot, "revision-legacy", [skill({ id: "evolved:skill_manifest:legacy-render", content: LEGACY_BODY })]);

		const [root] = loadActiveEvolutionSkillPaths(scopeRoot);
		const markdown = readFileSync(join(root, "evolved-legacy-render", "SKILL.md"), "utf8");
		assert.match(markdown, /A reusable procedure that a real refiner run proposed\./);
	});
});

test("the refiner system prompt tells the model the structure the store will demand", () => {
	// A store rule the producer was never told about is a rule that only ever fires as a failure.
	const source = readFileSync(
		new URL("../extensions/optional/evolution/evolution-refiner.ts", import.meta.url),
		"utf8",
	);
	for (const section of SECTIONS) {
		assert.ok(source.includes(section.heading.slice(3)), `producer prompt must name the ${section.key} section`);
	}
	assert.ok(source.includes("applicability (what triggers it)"));
	assert.ok(source.includes("nonApplicability (where it does not apply)"));
});
