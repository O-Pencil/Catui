/**
 * [WHO]: Verifies a turn-end self-report can only reach active state through the store's promotion gate
 * [FROM]: Depends on node:test/assert/fs/os/path, the real store promotion entry, and the real observer
 * [TO]: Consumed by test:evolution-boundaries; covers S06.2 promotion authority
 * [HERE]: test/evolution-auto-promotion-gate.test.ts - self-report promotion authority coverage
 *
 * The previous file records what a candidate claims. This file records what may act on that claim:
 * provenance confers nothing, so a self-report's only route to active state is promoteEvolutionCandidate
 * with a passing gate report, and that entry must refuse every weaker form of evidence.
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
	loadCurrentEvolution,
	promoteEvolutionCandidate,
	recordEvolutionGateFailure,
} from "../extensions/optional/evolution/evolution-store.js";
import type { ExtensionContext, TurnEndEvent } from "../core/extensions-host/types.js";

const SESSION_ID = "promotion-gate-test";

function withScope(run: (scopeRoot: string, ctx: ExtensionContext) => Promise<void>): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-promote-"));
	const agentDir = join(root, "agent");
	const ctx = {
		agentDir,
		cwd: join(root, "work"),
		sessionManager: { getSessionId: () => SESSION_ID },
	} as unknown as ExtensionContext;
	return run(getEvolutionScopeRoot(agentDir, { scope: "session", sessionId: SESSION_ID }), ctx)
		.finally(() => rmSync(root, { recursive: true, force: true }));
}

function turnEnd(turnIndex: number, text: string): TurnEndEvent {
	return {
		type: "turn_end",
		turnIndex,
		message: { role: "assistant", content: [{ type: "text", text }] } as TurnEndEvent["message"],
		toolResults: [],
	};
}

function gateReport(passed: boolean) {
	return {
		name: "builtin-harness-eval",
		passed,
		checkedAt: "2026-08-25T01:00:00.000Z",
		metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
	};
}

/** A prose lesson is the weakest source; it must not promote on any weaker evidence than this. */
const PROSE_LESSON = "Reusable lesson: prefer focused regression tests";

test("a prose self-report with a failing gate stays inactive and records the failure as evidence", async () => {
	await withScope(async (scopeRoot, ctx) => {
		const observer = new EvolutionAutoObserver({ runGate: async () => gateReport(false) });
		const result = await observer.observeTurnEnd(turnEnd(5, PROSE_LESSON), ctx);
		assert.ok(result.candidateId, "the candidate is still recorded; only activation is withheld");

		assert.equal(
			loadCurrentEvolution(scopeRoot),
			undefined,
			"a self-report must not become active when the gate did not pass",
		);
		const stored = inspectEvolution(scopeRoot).candidates.find((c) => c.id === result.candidateId);
		assert.deepEqual(
			stored?.evidence?.gateReport,
			gateReport(false),
			"the failed gate must be durable evidence, so the failure cannot be quietly forgotten",
		);
		assert.equal(inspectEvolution(scopeRoot).revisions.length, 0, "no revision may be materialized");
	});
});

test("promotion refuses a self-report candidate when the gate report did not pass", async () => {
	await withScope(async (scopeRoot, ctx) => {
		const observer = new EvolutionAutoObserver({ runGate: async () => gateReport(false) });
		const result = await observer.observeTurnEnd(turnEnd(5, PROSE_LESSON), ctx);
		assert.ok(result.candidateId);

		// The only promotion entry point, called directly with the same self-report candidate.
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, result.candidateId!, { approvedBy: "direct", gateReport: gateReport(false) }),
			/passing gate report/,
			"a failed gate report must not be promotable",
		);
		assert.equal(loadCurrentEvolution(scopeRoot), undefined, "a refused promotion leaves nothing active");
	});
});

test("promotion refuses a self-report candidate given no gate report at all", async () => {
	await withScope(async (scopeRoot, ctx) => {
		const observer = new EvolutionAutoObserver({ runGate: async () => gateReport(false) });
		const result = await observer.observeTurnEnd(turnEnd(5, PROSE_LESSON), ctx);
		assert.ok(result.candidateId);

		// A self-declaration with no external evidence at all is the strongest version of the
		// claim the previous file records as unverified; it must be the least promotable.
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, result.candidateId!, { approvedBy: "direct" }),
			/passing gate report/,
			"absent evidence must not be treated as satisfied evidence",
		);
		assert.equal(loadCurrentEvolution(scopeRoot), undefined);
	});
});

test("promotion refuses a self-report candidate whose replay metrics are not perfect", async () => {
	await withScope(async (scopeRoot, ctx) => {
		const observer = new EvolutionAutoObserver({ runGate: async () => gateReport(false) });
		const result = await observer.observeTurnEnd(turnEnd(5, PROSE_LESSON), ctx);
		assert.ok(result.candidateId);

		// passed: true but with a policy violation. Proves the perfect-metric requirement is a
		// separate condition, so passing the boolean alone cannot carry a promotion.
		assert.throws(
			() =>
				promoteEvolutionCandidate(scopeRoot, result.candidateId!, {
					approvedBy: "direct",
					gateReport: {
						...gateReport(true),
						metrics: { passRate: 1, replayDivergences: 0, policyViolations: 1, unpairedToolCalls: 0 },
					},
				}),
			/perfect replay and safety gate/,
		);
		assert.equal(loadCurrentEvolution(scopeRoot), undefined);
	});
});

test("a passing replay gate is still not enough without integrity-bound benchmark evidence", async () => {
	await withScope(async (scopeRoot, ctx) => {
		const observer = new EvolutionAutoObserver({ runGate: async () => gateReport(false) });
		const result = await observer.observeTurnEnd(turnEnd(5, PROSE_LESSON), ctx);
		assert.ok(result.candidateId);

		// The strongest evidence a self-report path can assemble on its own: a perfect replay
		// report with passed:true and no failure. It is still refused, because a behavioral
		// artifact needs a benchmark report bound to this candidate's id, content hash and
		// baseline. This is the condition that actually gates promotion, not the boolean.
		assert.throws(
			() => promoteEvolutionCandidate(scopeRoot, result.candidateId!, { approvedBy: "late", gateReport: gateReport(true) }),
			/integrity-bound benchmark evidence/,
			"a perfect replay gate alone must not activate a self-reported lesson",
		);
		assert.equal(loadCurrentEvolution(scopeRoot), undefined, "no amount of replay evidence substitutes for the benchmark");
	});
});

test("promotion is the only route from a self-report candidate to a revision", async () => {
	await withScope(async (scopeRoot, ctx) => {
		const observer = new EvolutionAutoObserver({ runGate: async () => gateReport(false) });
		await observer.observeTurnEnd(turnEnd(5, PROSE_LESSON), ctx);

		// A candidate alone materializes no revision, and no other exported entry may either.
		const inspection = inspectEvolution(scopeRoot);
		assert.equal(inspection.candidates.length, 1);
		assert.equal(inspection.revisions.length, 0, "creating a candidate is not activation");
		assert.equal(inspection.current, undefined);

		// Recording a gate failure is bookkeeping over an existing candidate, not a promotion path.
		recordEvolutionGateFailure(scopeRoot, inspection.candidates[0].id, { gateReport: gateReport(false) });
		assert.equal(inspectEvolution(scopeRoot).revisions.length, 0, "bookkeeping materializes nothing");
		assert.equal(loadCurrentEvolution(scopeRoot), undefined);
	});
});

test("a self-report candidate that is never promoted leaves discovery empty", async () => {
	await withScope(async (scopeRoot, ctx) => {
		const observer = new EvolutionAutoObserver({ runGate: async () => gateReport(false) });
		await observer.observeTurnEnd(turnEnd(5, PROSE_LESSON), ctx);

		// End-to-end: nothing about an inactive self-report may reach a consumer. Promotion is
		// what materializes skill files, so with no revision there is nothing to discover.
		const before = inspectEvolution(scopeRoot);
		assert.equal(before.revisions.length, 0);
		assert.equal(before.current, undefined);
		assert.equal(
			before.activeFixtures,
			undefined,
			"no fixture is activated by a prose self-report",
		);
	});
});

test("createEvolutionCandidate with self-reported evidence cannot itself activate anything", async () => {
	await withScope(async (scopeRoot) => {
		// The store's own constructor is called with provenance-flavoured evidence to prove the
		// gate lives in the store, not in the caller's description of its own evidence.
		const candidate = createEvolutionCandidate(scopeRoot, {
			scope: "session",
			summary: "Directly constructed self-report",
			rationale: "Testing that construction confers no activation.",
			expectedOutcome: "Nothing becomes active.",
			artifacts: [{ id: "evolved:memory:direct", kind: "memory", title: "Direct", content: "Content" }],
			evidence: { source: "turn_end", provenance: "model_prose_self_report" },
		});
		assert.equal(candidate.status, "proposed");
		assert.equal(loadCurrentEvolution(scopeRoot), undefined, "construction alone is not promotion");
		assert.equal(inspectEvolution(scopeRoot).revisions.length, 0);
	});
});
