/**
 * [WHO]: Proves a refused proposal can be re-evaluated once the conditions change, and that no idea is permanently barred
 * [FROM]: Depends on node:test/assert/fs/os/path, the real store, and the real observer
 * [TO]: Consumed by test:evolution-boundaries; covers S07.6 so a refusal is a decision, not a verdict
 * [HERE]: test/evolution-no-blacklist.test.ts - S07.6 re-evaluability coverage
 *
 * The proposal says not to permanently blacklist an idea because it failed once under some model or
 * environment, and that changed conditions can justify a new evaluation. There is no blacklist data
 * structure in the extension to delete — the claim is structural, and structural claims about
 * absence are the kind nobody re-checks. So this file takes each surface that can refuse a proposal
 * and drives it through: refuse, change something real, and show the same idea is accepted.
 *
 * Two of these properties were already pinned elsewhere (a rejected candidate can be re-proposed, a
 * budget-refused call does not consume the candidate). They are repeated here as controls rather than
 * as new claims, because a reader of this file should not have to know which other file says what.
 *
 * One genuine constraint surfaced while probing and is documented rather than papered over: a body
 * that is byte-identical to one already in the ledger cannot be re-proposed under a new id, even if
 * the proposal that introduced it was rejected. That is deduplication, not blacklisting — it refuses a
 * *copy* — and the escape is to change the content, which is what an updated proposal does anyway.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvolutionAutoObserver } from "../extensions/optional/evolution/evolution-auto.js";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	inspectEvolution,
	listRejectedCandidates,
	loadActiveEvolutionArtifacts,
	promoteEvolutionCandidate,
	rejectEvolutionCandidate,
} from "../extensions/optional/evolution/evolution-store.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { ExtensionContext } from "../core/extensions-host/types.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionArtifact, EvolutionCandidate, EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";

const SESSION_ID = "no-blacklist-test";
const SKILL = "evolved:skill_manifest:the-one-idea";

interface Space {
	agentDir: string;
	scopeRoot: string;
	dispose: () => void;
}

function space(): Space {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-blacklist-"));
	const agentDir = join(root, "agent");
	return {
		agentDir,
		scopeRoot: getEvolutionScopeRoot(agentDir, { scope: "session", sessionId: SESSION_ID }),
		dispose: () => rmSync(root, { recursive: true, force: true }),
	};
}

function skill(steps: string, id = SKILL): EvolutionArtifact {
	return {
		id,
		kind: "skill_manifest",
		title: "The one idea",
		content: ["## Prerequisites", "A failing test.", "", "## Steps", steps, "", "## Pitfalls", "Guessing.", "", "## Verification", "Quote the output."].join("\n"),
		applicability: "When a test fails.",
		nonApplicability: "Not while the suite is green.",
	};
}

function input(artifacts: EvolutionArtifact[]): Parameters<typeof createEvolutionCandidate>[1] {
	return { scope: "session", summary: "propose", rationale: "measured", expectedOutcome: "it lands", artifacts, evidence: { source: "test" } };
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

/** Real integrity-bound evidence, so "the evidence changed" below means what it says. */
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
			{ candidateId: candidate.id, baselineRevisionId: candidate.baselineRevisionId ?? null, checkedAt: "2026-08-25T01:00:00.000Z" },
		),
	};
}

test("a rejected proposal can be proposed again, and the rejection is per record", async () => {
	const s = space();
	try {
		const first = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.")]));
		rejectEvolutionCandidate(s.scopeRoot, first.id, "not now", { rejectedBy: "reviewer" });

		// The rejection blocks *that candidate* from promotion and nothing else.
		const second = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.")]));
		assert.notEqual(second.id, first.id, "a re-proposal is a new record, not a revival of the old one");
		assert.equal(second.status, "proposed");
		assert.deepEqual(listRejectedCandidates(s.scopeRoot).map((record) => record.id), [first.id], "the rejection is still on the books");

		// And with evidence, the same idea activates.
		promoteEvolutionCandidate(s.scopeRoot, second.id, { approvedBy: "test", gateReport: gateFor(second) });
		assert.deepEqual(loadActiveEvolutionArtifacts(s.scopeRoot).map((artifact) => artifact.id), [SKILL]);
	} finally {
		s.dispose();
	}
});

test("a rejected proposal does not stop a later, different proposal from landing", async () => {
	const s = space();
	try {
		const rejected = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.")]));
		rejectEvolutionCandidate(s.scopeRoot, rejected.id, "not now", { rejectedBy: "reviewer" });

		const revised = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing, but check the error first.")]));
		promoteEvolutionCandidate(s.scopeRoot, revised.id, { approvedBy: "test", gateReport: gateFor(revised) });

		const active = loadActiveEvolutionArtifacts(s.scopeRoot);
		assert.equal(active.length, 1);
		assert.match(active[0]!.content, /check the error first/);
	} finally {
		s.dispose();
	}
});

test("a copied body is refused, but changing the body lifts the refusal immediately", async () => {
	const s = space();
	try {
		const original = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.")]));
		promoteEvolutionCandidate(s.scopeRoot, original.id, { approvedBy: "test", gateReport: gateFor(original) });

		// A copy under a new id: refused, and nothing is written.
		assert.throws(
			() => createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.", "evolved:skill_manifest:a-copy")])),
			/Duplicate skill_manifest content already exists in/,
		);
		assert.equal(inspectEvolution(s.scopeRoot).candidates.length, 1, "the refused copy left no record");

		// The same id with new content: not a copy, so accepted. This is the escape, and it is what
		// every genuine update looks like anyway.
		const updated = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing, and say why.")]));
		assert.equal(updated.status, "proposed");
		assert.doesNotThrow(() => promoteEvolutionCandidate(s.scopeRoot, updated.id, { approvedBy: "test", gateReport: gateFor(updated) }));
	} finally {
		s.dispose();
	}
});

test("an artifact may be reverted to an earlier body, because the same id is always an update", async () => {
	// I expected this to be refused as a duplicate of history, and it is not. The refusal is keyed on
	// a *new* id: the same id is an update whatever its body, so reverting an artifact to bytes it had
	// before is allowed. That is a stronger result than the one I set out to document — there is no
	// body that becomes permanently unproposable, only a copy, and a copy can always be written as an
	// update instead.
	const s = space();
	try {
		const first = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.")]));
		promoteEvolutionCandidate(s.scopeRoot, first.id, { approvedBy: "test", gateReport: gateFor(first) });
		const updated = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing, and say why.")]));
		promoteEvolutionCandidate(s.scopeRoot, updated.id, { approvedBy: "test", gateReport: gateFor(updated) });
		assert.match(loadActiveEvolutionArtifacts(s.scopeRoot)[0]!.content, /say why/);

		const reverted = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.")]));
		assert.equal(reverted.status, "proposed", "reverting under the same id is not a copy");
		promoteEvolutionCandidate(s.scopeRoot, reverted.id, { approvedBy: "test", gateReport: gateFor(reverted) });

		const active = loadActiveEvolutionArtifacts(s.scopeRoot);
		assert.equal(active.length, 1, "the revert replaced the set rather than adding to it");
		assert.equal(active[0]!.content, skill("Do the thing.").content, "and the earlier body is the active one again");
	} finally {
		s.dispose();
	}
});

test("the only refusal is a copy under a new id, and that copy is refused for being a copy", async () => {
	const s = space();
	try {
		const first = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.")]));
		promoteEvolutionCandidate(s.scopeRoot, first.id, { approvedBy: "test", gateReport: gateFor(first) });

		assert.throws(
			() => createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.", "evolved:skill_manifest:yet-another-copy")])),
			/Duplicate skill_manifest content already exists in .* as evolved:skill_manifest:the-one-idea/,
			"the message must name both the copy and the artifact it duplicates, or a reader cannot act on it",
		);
		// Reword it — still the same idea, but not the same bytes — and it is accepted under a new id
		// as well. Refusing that too would be a blacklist by another name.
		assert.doesNotThrow(
			() => createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing, carefully.", "evolved:skill_manifest:yet-another-copy")])),
		);
	} finally {
		s.dispose();
	}
});

test("the cooldown suppresses a turn and then expires, so the same idea is re-evaluated", async () => {
	const s = space();
	try {
		const ctx: ExtensionContext = {
			agentDir: s.agentDir,
			cwd: s.agentDir,
			sessionManager: { getSessionId: () => SESSION_ID, getEntries: () => [] },
			completeSimple: async () => { throw new Error("the observer must not reach a model"); },
		} as unknown as ExtensionContext;
		const observer = new EvolutionAutoObserver({ runGate: async () => ({ name: "g", passed: false, checkedAt: "2026-08-25T00:00:00.000Z", metrics: { passRate: 0, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 } }) });
		const turn = (turnIndex: number) => ({ type: "turn_end", turnIndex, message: { content: "Reusable lesson: the one idea" }, toolResults: [] }) as never;

		const first = await observer.observeTurnEnd(turn(1), ctx);
		assert.ok(first.candidateId, "the first turn is honored");

		const suppressed = await observer.observeTurnEnd(turn(2), ctx);
		assert.equal(suppressed.skipped, "cooldown", "the repeat is suppressed, with a stated reason");
		assert.equal(suppressed.candidateId, undefined, "and no second candidate is created");

		const afterWindow = await observer.observeTurnEnd(turn(9), ctx);
		assert.ok(afterWindow.candidateId, "once the window passes the same idea is evaluated again, not barred");
	} finally {
		s.dispose();
	}
});

test("a gate failure is not a rejection: the same candidate can be promoted once evidence arrives", async () => {
	const s = space();
	try {
		const candidate = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.")]));
		const failing: EvolutionGateReport = {
			name: "builtin-harness-eval+heldout-benchmark",
			passed: false,
			checkedAt: "2026-08-25T01:00:00.000Z",
			metrics: { passRate: 0, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
		};
		const { recordEvolutionGateFailure } = await import("../extensions/optional/evolution/evolution-store.js");
		recordEvolutionGateFailure(s.scopeRoot, candidate.id, { gateReport: failing });

		assert.equal(inspectEvolution(s.scopeRoot).candidates.find((entry) => entry.id === candidate.id)?.status, "proposed", "a recorded failure leaves the persisted candidate open");
		assert.deepEqual(listRejectedCandidates(s.scopeRoot), [], "it is not on the rejection list");
		assert.doesNotThrow(() => promoteEvolutionCandidate(s.scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) }));
	} finally {
		s.dispose();
	}
});

test("the scope root holds nothing that could be a standing list of refused ideas", async () => {
	// The structural half of "no permanent blacklist". A blacklist is a persisted collection keyed by
	// content or title; the ledger has candidates, revisions, quarantines, usage and feedback, and
	// nothing whose shape is a set of denied ideas. This asserts the absence at the file level, since
	// an in-memory list would leave no trace to find.
	const s = space();
	try {
		const original = createEvolutionCandidate(s.scopeRoot, input([skill("Do the thing.")]));
		promoteEvolutionCandidate(s.scopeRoot, original.id, { approvedBy: "test", gateReport: gateFor(original) });
		const rejected = createEvolutionCandidate(s.scopeRoot, input([skill("Another idea.")]));
		rejectEvolutionCandidate(s.scopeRoot, rejected.id, "not now", { rejectedBy: "reviewer" });

		const { readdirSync, statSync } = await import("node:fs");
		const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const full = join(dir, entry.name);
			return entry.isDirectory() ? walk(full) : [full];
		});
		const names = walk(s.scopeRoot).map((file) => file.slice(s.scopeRoot.length + 1));
		assert.equal(
			names.filter((name) => /blacklist|blocklist|denylist|denied|refus|suppress/i.test(name)).length,
			0,
			`no file may hold a standing list of refused ideas; found ${names.join(", ")}`,
		);
		assert.ok(statSync(join(s.scopeRoot, "candidates")).isDirectory());
	} finally {
		s.dispose();
	}
});
