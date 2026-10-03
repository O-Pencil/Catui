/**
 * [WHO]: Rechecks that nothing the assistant emits can create a candidate or move active state on its own
 * [FROM]: Depends on node:test/assert/fs/os/path and the real observer and store
 * [TO]: Consumed by test:evolution-boundaries; rechecks S06.8 under the current observer
 * [HERE]: test/evolution-no-lesson-recheck.test.ts - S06.8 no-lesson and malformed-proposal recheck
 *
 * The contract for turn-end observation is narrow: the observer may act only on text the assistant
 * already wrote, and only when that text is a well-formed declaration. Everything else must leave the
 * ledger and the active pointer exactly as it found them.
 *
 * An existing test covers two inputs — a turn with no marker, and one truncated JSON string. This
 * rechecks it and widens it to the other rejection points in `structuredProposal`, because each is a
 * separate branch: unparseable text, a `catui_evolution` that is not an object, an unknown kind, a
 * missing title, and a missing body. Covering only the first would leave four branches unproven.
 *
 * The failure this guards against is not subtle but it is easy to write into: a test that passes
 * because everything is rejected. Every malformed class here is paired with a well-formed control in
 * the same scope, so "no candidate" is evidence about that input and not about the observer.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvolutionAutoObserver } from "../extensions/optional/evolution/evolution-auto.js";
import {
	getEvolutionScopeRoot,
	inspectEvolution,
	loadActiveEvolutionArtifacts,
	loadCurrentEvolution,
} from "../extensions/optional/evolution/evolution-store.js";
import type { ExtensionContext } from "../core/extensions-host/types.js";

const SESSION_ID = "no-lesson-recheck";

function failingGate() {
	return {
		name: "builtin-harness-eval",
		passed: false,
		checkedAt: "2026-08-25T00:00:00.000Z",
		metrics: { passRate: 0, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
	};
}

interface Space {
	agentDir: string;
	scopeRoot: string;
	dispose: () => void;
}

function space(): Space {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-no-lesson-"));
	const agentDir = join(root, "agent");
	return {
		agentDir,
		scopeRoot: getEvolutionScopeRoot(agentDir, { scope: "session", sessionId: SESSION_ID }),
		dispose: () => rmSync(root, { recursive: true, force: true }),
	};
}

function context(agentDir: string, counters: { modelCalls: number }): ExtensionContext {
	return {
		agentDir,
		cwd: agentDir,
		sessionManager: { getSessionId: () => SESSION_ID, getEntries: () => [] },
		completeSimple: async () => {
			counters.modelCalls += 1;
			return "{}";
		},
	} as unknown as ExtensionContext;
}

function turnEnd(turnIndex: number, content: string) {
	return { type: "turn_end", turnIndex, message: { content }, toolResults: [] } as never;
}

/** Everything a refused turn must leave exactly as it found it. */
function ledgerState(scopeRoot: string) {
	return {
		candidates: inspectEvolution(scopeRoot).candidates.length,
		revisions: inspectEvolution(scopeRoot).revisions.length,
		active: loadActiveEvolutionArtifacts(scopeRoot).map((artifact) => artifact.id),
		pointer: loadCurrentEvolution(scopeRoot)?.revisionId,
	};
}

const VALID = JSON.stringify({
	catui_evolution: { scope: "session", kind: "memory", title: "T", content: "C" },
});

/** The five distinct rejection branches in structuredProposal, plus the no-marker case. */
const REFUSED: { name: string; text: string }[] = [
	{ name: "a turn with no marker at all", text: "Just a normal answer with no marker." },
	{ name: "text that is not JSON", text: "catui_evolution: definitely not json" },
	{ name: "truncated JSON", text: '{"catui_evolution": {"kind": ' },
	{ name: "truncated JSON inside a fence", text: '```json\n{"catui_evolution": {"kind":\n```' },
	{ name: "a catui_evolution that is a string", text: JSON.stringify({ catui_evolution: "memory" }) },
	{ name: "a catui_evolution that is an array", text: JSON.stringify({ catui_evolution: [{ kind: "memory" }] }) },
	{ name: "a catui_evolution that is null", text: JSON.stringify({ catui_evolution: null }) },
	{ name: "an unknown artifact kind", text: JSON.stringify({ catui_evolution: { kind: "source_patch", title: "T", content: "C" } }) },
	{ name: "a missing kind", text: JSON.stringify({ catui_evolution: { title: "T", content: "C" } }) },
	{ name: "a missing title", text: JSON.stringify({ catui_evolution: { kind: "memory", content: "C" } }) },
	{ name: "a title that is not a string", text: JSON.stringify({ catui_evolution: { kind: "memory", title: 7, content: "C" } }) },
	{ name: "a missing body on a non-fixture kind", text: JSON.stringify({ catui_evolution: { kind: "memory", title: "T" } }) },
	{ name: "a JSON array at the top level", text: JSON.stringify([{ catui_evolution: { kind: "memory", title: "T", content: "C" } }]) },
	{ name: "a proposal key on something that is not an object", text: JSON.stringify("catui_evolution") },
];

test("a well-formed declaration does create a candidate, so the refusals below mean something", async () => {
	// Without this control the rest of this file is decorative: an observer that rejected everything
	// would pass every assertion below.
	const s = space();
	try {
		const counters = { modelCalls: 0 };
		const observer = new EvolutionAutoObserver({ runGate: async () => failingGate() });
		const result = await observer.observeTurnEnd(turnEnd(1, VALID), context(s.agentDir, counters));

		assert.ok(result.candidateId, "a well-formed declaration must be honored");
		assert.equal(inspectEvolution(s.scopeRoot).candidates.length, 1);
		assert.equal(counters.modelCalls, 0, "even a honored declaration must not reach a model");
	} finally {
		s.dispose();
	}
});

test("no lesson and no well-formed declaration create nothing and move nothing", async () => {
	for (const { name, text } of REFUSED) {
		const s = space();
		try {
			const counters = { modelCalls: 0 };
			const observer = new EvolutionAutoObserver({ runGate: async () => failingGate() });
			const before = ledgerState(s.scopeRoot);

			const result = await observer.observeTurnEnd(turnEnd(3, text), context(s.agentDir, counters));

			assert.equal(result.candidateId, undefined, `${name} must not produce a candidate`);
			assert.equal(result.skipped, "no_lesson", `${name} must report why nothing happened`);
			assert.deepEqual(ledgerState(s.scopeRoot), before, `${name} must leave the ledger and pointer untouched`);
			assert.equal(counters.modelCalls, 0, `${name} must not reach a model`);
		} finally {
			s.dispose();
		}
	}
});

test("a refused turn leaves the observer able to act on a later valid one", async () => {
	// A refusal that poisoned the scope would show up here rather than in the assertions above, which
	// only ever look at an untouched ledger.
	const s = space();
	try {
		const counters = { modelCalls: 0 };
		const observer = new EvolutionAutoObserver({ runGate: async () => failingGate() });
		await observer.observeTurnEnd(turnEnd(1, '{"catui_evolution": {"kind": '), context(s.agentDir, counters));
		await observer.observeTurnEnd(turnEnd(2, "no marker either"), context(s.agentDir, counters));

		const after = await observer.observeTurnEnd(turnEnd(3, VALID), context(s.agentDir, counters));
		assert.ok(after.candidateId, "a later valid declaration must still be honored");
		assert.equal(inspectEvolution(s.scopeRoot).candidates.length, 1, "and exactly one candidate exists");
	} finally {
		s.dispose();
	}
});

test("a refusal writes nothing at all, not even an empty scope root", async () => {
	// Stronger than "no candidates": a directory tree appearing is how a supposedly inert path starts
	// looking like it has state.
	const s = space();
	try {
		const counters = { modelCalls: 0 };
		const observer = new EvolutionAutoObserver({ runGate: async () => failingGate() });
		await observer.observeTurnEnd(turnEnd(1, '{"catui_evolution": {"kind": "memory", title:'), context(s.agentDir, counters));

		assert.equal(inspectEvolution(s.scopeRoot).candidates.length, 0);
		assert.equal(loadCurrentEvolution(s.scopeRoot), undefined);
	} finally {
		s.dispose();
	}
});

test("an eval_fixture declaration with no trace path is refused for its own reason", async () => {
	// A different skip reason on a different branch. It is a refusal rather than a candidate, and the
	// reason must name what was missing rather than falling back to "no lesson".
	const s = space();
	try {
		const counters = { modelCalls: 0 };
		const observer = new EvolutionAutoObserver({ runGate: async () => failingGate() });
		const result = await observer.observeTurnEnd(
			turnEnd(1, JSON.stringify({ catui_evolution: { scope: "workspace", kind: "eval_fixture", title: "F" } })),
			context(s.agentDir, counters),
		);

		assert.equal(result.candidateId, undefined);
		assert.equal(result.skipped, "eval_fixture_trace_path", "the reason must name the missing field");
		assert.equal(inspectEvolution(s.scopeRoot).candidates.length, 0);
		assert.equal(counters.modelCalls, 0);
	} finally {
		s.dispose();
	}
});
