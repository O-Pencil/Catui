/**
 * [WHO]: Proves a stale-baseline or scope-mismatched candidate cannot activate anything
 * [FROM]: Depends on node:test/assert/crypto/fs/os/path and the real store with real gate evidence
 * [TO]: Consumed by test:evolution-boundaries; covers S07.7 so a refusal provably moves nothing
 * [HERE]: test/evolution-scope-and-stale-rejection.test.ts - S07.7 stale base and scope mismatch coverage
 *
 * A refusal is only meaningful if it changes nothing, so every case here asserts the same thing at
 * the end: the current pointer, the active artifact set, and the revision count are exactly what they
 * were before the attempt. The stale-baseline half reuses the store's existing capture and promotion
 * checks rather than adding a second gate, and the scope-mismatch half closes a real bypass: a
 * candidate's declared scope and the directory it is written to could disagree, and every
 * scope-keyed policy downstream reads the field.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	canAutoPromoteGlobalEvolution,
	createEvolutionCandidate,
	evolutionScopeOfRoot,
	getEvolutionScopeRoot,
	inspectEvolution,
	loadActiveEvolutionArtifacts,
	loadCurrentEvolution,
	promoteEvolutionCandidate,
} from "../extensions/optional/evolution/evolution-store.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionArtifact, EvolutionCandidate, EvolutionCandidateInput, EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";

const AGENT = "scope-stale-test";

function note(id: string, text: string): EvolutionArtifact {
	return { id, kind: "prompt_note", title: `Note ${id}`, content: text };
}

function input(artifacts: EvolutionArtifact[], scope: "session" | "workspace" | "global" = "session"): EvolutionCandidateInput {
	return { scope, summary: "propose", rationale: "measured", expectedOutcome: "a refusal moves nothing", artifacts, evidence: { source: "test" } };
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

/** Real integrity-bound evidence, so "even with valid evidence" in the test name is true. */
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

async function withAgentDir(run: (agentDir: string) => Promise<void> | void): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-scope-stale-"));
	try {
		await run(join(root, "agent"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function sessionRoot(agentDir: string, sessionId = "s"): string {
	return getEvolutionScopeRoot(agentDir, { scope: "session", sessionId });
}

function globalRoot(agentDir: string): string {
	return getEvolutionScopeRoot(agentDir, { scope: "global" });
}

function workspaceRoot(agentDir: string, cwd: string): string {
	return getEvolutionScopeRoot(agentDir, { scope: "workspace", cwd });
}

function promote(scopeRoot: string, artifacts: EvolutionArtifact[], scope: "session" | "workspace" | "global" = "session"): string {
	const candidate = createEvolutionCandidate(scopeRoot, input(artifacts, scope));
	return promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) }).id;
}

/** Everything a refusal must leave exactly as it found it. */
function snapshotState(scopeRoot: string) {
	return {
		pointer: loadCurrentEvolution(scopeRoot)?.revisionId,
		active: loadActiveEvolutionArtifacts(scopeRoot).map((artifact) => artifact.id),
		revisions: inspectEvolution(scopeRoot).revisions.length,
	};
}

test("a candidate whose baseline moved is refused even with valid evidence", async () => {
	await withAgentDir((agentDir) => {
		const root = sessionRoot(agentDir);
		const seed = createEvolutionCandidate(root, input([note("evolved:prompt_note:seed", "Seed.")]));
		promoteEvolutionCandidate(root, seed.id, { approvedBy: "test", gateReport: gateFor(seed) });

		// Captured against the first revision, then someone else advances the scope.
		const stale = createEvolutionCandidate(root, input([note("evolved:prompt_note:stale", "Stale.")]));
		const mover = createEvolutionCandidate(root, input([note("evolved:prompt_note:mover", "Mover.")]));
		const second = promoteEvolutionCandidate(root, mover.id, { approvedBy: "test", gateReport: gateFor(mover) }).id;

		// Real, passing, integrity-bound evidence, gathered honestly for this candidate.
		const gate = gateFor(stale);
		assert.equal(gate.passed, true);
		assert.equal(gate.benchmark?.passed, true);
		const before = snapshotState(root);

		assert.throws(
			() => promoteEvolutionCandidate(root, stale.id, { approvedBy: "test", gateReport: gate }),
			/baseline is stale/,
		);
		assert.deepEqual(snapshotState(root), before, "a refusal must move nothing");
		assert.equal(loadCurrentEvolution(root)?.revisionId, second, "the pointer stays on the revision that is actually current");
	});
});

test("a rejected stale candidate can be proposed again once the conditions change", async () => {
	// Not a blacklist: the same content is accepted when it is captured against the current
	// baseline, which is what "changed conditions can justify a new evaluation" means.
	await withAgentDir((agentDir) => {
		const root = sessionRoot(agentDir);
		const seed = createEvolutionCandidate(root, input([note("evolved:prompt_note:seed", "Seed.")]));
		promoteEvolutionCandidate(root, seed.id, { approvedBy: "test", gateReport: gateFor(seed) });
		const stale = createEvolutionCandidate(root, input([note("evolved:prompt_note:retry", "Retry.")]));
		const mover = createEvolutionCandidate(root, input([note("evolved:prompt_note:mover", "Mover.")]));
		promoteEvolutionCandidate(root, mover.id, { approvedBy: "test", gateReport: gateFor(mover) });
		assert.throws(() => promoteEvolutionCandidate(root, stale.id, { approvedBy: "test", gateReport: gateFor(stale) }), /baseline is stale/);

		// Same content, re-proposed against what is now current.
		const again = createEvolutionCandidate(root, input([note("evolved:prompt_note:retry", "Retry.")]));
		assert.equal(again.baselineRevisionId, loadCurrentEvolution(root)?.revisionId ?? null);
		assert.doesNotThrow(() => promoteEvolutionCandidate(root, again.id, { approvedBy: "test", gateReport: gateFor(again) }));
	});
});

test("a candidate declaring a scope its root does not have is refused", async () => {
	await withAgentDir((agentDir) => {
		const before = snapshotState(globalRoot(agentDir));

		// The global root, a workspace-scoped declaration. Without the check this is accepted, and
		// `canAutoPromoteGlobalEvolution` then reads `scope !== "global"` and allows it.
		assert.throws(
			() => createEvolutionCandidate(globalRoot(agentDir), input([note("evolved:prompt_note:sneaky", "Sneaky.")], "workspace")),
			/declares scope workspace but its scope root is global/,
		);
		assert.deepEqual(snapshotState(globalRoot(agentDir)), before, "a refused candidate leaves no record");
	});
});

test("the reverse mismatch is refused too", async () => {
	await withAgentDir((agentDir) => {
		assert.throws(
			() => createEvolutionCandidate(sessionRoot(agentDir), input([note("evolved:prompt_note:x", "X.")], "global")),
			/declares scope global but its scope root is session/,
		);
		assert.throws(
			() => createEvolutionCandidate(workspaceRoot(agentDir, "/tmp/p"), input([note("evolved:prompt_note:x", "X.")], "session")),
			/declares scope session but its scope root is workspace/,
		);
	});
});

test("the mismatch was a live policy bypass, and it is closed", async () => {
	// The whole point of the check. The global policy exists to keep skill_manifest out of the
	// global scope; a record that merely claimed to be a workspace candidate walked straight past it.
	await withAgentDir((agentDir) => {
		const body = ["## Prerequisites", "A failing test.", "", "## Steps", "Read the output.", "", "## Pitfalls", "Rewriting.", "", "## Verification", "Quote it."].join("\n");
		const skillArtifact: EvolutionArtifact = {
			id: "evolved:skill_manifest:sneaky",
			kind: "skill_manifest",
			title: "Sneaky",
			content: body,
			applicability: "When.",
			nonApplicability: "Not otherwise.",
		};

		assert.throws(() => createEvolutionCandidate(globalRoot(agentDir), input([skillArtifact], "workspace")));
		assert.deepEqual(inspectEvolution(globalRoot(agentDir)).candidates, []);

		// And the policy itself is unchanged for an honestly scoped record.
		const honest = createEvolutionCandidate(sessionRoot(agentDir), input([skillArtifact], "session"));
		assert.equal(canAutoPromoteGlobalEvolution(honest).allowed, true, "an honest session candidate is judged on its own scope");
		assert.equal(canAutoPromoteGlobalEvolution({ ...honest, scope: "global" }).allowed, false, "the global policy still refuses a skill_manifest");
	});
});

test("a path that is not an evolution root cannot host a candidate at all", async () => {
	// Fail closed. An unrecognized root is exactly the ambiguity a declared scope would exploit, so
	// it is a refusal rather than a wildcard.
	await withAgentDir((agentDir) => {
		assert.equal(evolutionScopeOfRoot(join(agentDir, "somewhere-else")), undefined);
		assert.throws(
			() => createEvolutionCandidate(join(agentDir, "somewhere-else"), input([note("evolved:prompt_note:x", "X.")])),
			/not a recognized evolution root/,
		);
	});
});

test("an agent directory that itself sits under a v1 segment still resolves", async () => {
	// The scope is read from the last "v1" in the path, not the first. Taking the first would make
	// every root under such an agent directory look unrecognized, and the fail-closed response to
	// that is "evolution is unavailable here" rather than anything security-relevant.
	await withAgentDir(async (agentDir) => {
		const nested = getEvolutionScopeRoot(join(agentDir, "v1", "nested"), { scope: "session", sessionId: "nested" });
		assert.equal(evolutionScopeOfRoot(nested), "session");

		const candidate = createEvolutionCandidate(nested, input([note("evolved:prompt_note:nested", "Nested.")]));
		assert.equal(candidate.scope, "session");
		assert.doesNotThrow(() => promoteEvolutionCandidate(nested, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) }));
	});
});

test("every scope derives its own root and accepts its own candidates", async () => {
	await withAgentDir((agentDir) => {
		const cases = [
			{ scope: "global" as const, root: globalRoot(agentDir) },
			{ scope: "workspace" as const, root: workspaceRoot(agentDir, "/tmp/project") },
			{ scope: "session" as const, root: sessionRoot(agentDir) },
		];
		for (const { scope, root } of cases) {
			assert.equal(evolutionScopeOfRoot(root), scope);
			const candidate = createEvolutionCandidate(root, input([note(`evolved:prompt_note:${scope}`, `At ${scope}.`)], scope));
			assert.equal(candidate.scope, scope);
			assert.doesNotThrow(() => promoteEvolutionCandidate(root, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) }));
		}
	});
});

test("two roots of the same scope kind do not see each other", async () => {
	await withAgentDir((agentDir) => {
		const one = sessionRoot(agentDir, "one");
		const two = sessionRoot(agentDir, "two");
		promote(one, [note("evolved:prompt_note:here", "Only here.")]);

		assert.deepEqual(loadActiveEvolutionArtifacts(one).map((a) => a.id), ["evolved:prompt_note:here"]);
		assert.deepEqual(loadActiveEvolutionArtifacts(two), [], "a sibling session root is a different scope");
		assert.equal(loadCurrentEvolution(two), undefined);
	});
});

test("a candidate from one session root cannot be promoted through another", async () => {
	await withAgentDir((agentDir) => {
		const one = sessionRoot(agentDir, "one");
		const two = sessionRoot(agentDir, "two");
		const candidate = createEvolutionCandidate(one, input([note("evolved:prompt_note:cross", "Cross.")]));
		const gate = gateFor(candidate);

		assert.throws(
			() => promoteEvolutionCandidate(two, candidate.id, { approvedBy: "test", gateReport: gate }),
			/Evolution candidate not found/,
			"a candidate id only resolves inside the root that holds it",
		);
		assert.deepEqual(snapshotState(two), { pointer: undefined, active: [], revisions: 0 });
	});
});
