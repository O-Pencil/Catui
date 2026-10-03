/**
 * [WHO]: Proves one rate limit covers every turn-end branch that can create a candidate
 * [FROM]: Depends on node:test/assert/fs/os/path, the real observer, and the real store
 * [TO]: Consumed by test:evolution-boundaries; covers S07.6 so a repeated proposal does not create a candidate each turn
 * [HERE]: test/evolution-auto-cooldown.test.ts - S07.6 cooldown coverage for all branches
 *
 * The structured branches never consulted the cooldown, so an identical `catui_evolution` proposal
 * produced a fresh candidate on every turn — which is both ledger noise and, because each attempt
 * re-enters the promotion gate, repeated spend on evidence nothing changed. These tests drive the
 * real observer over real turns and count candidates in the real store, so the rate limit is
 * measured where it matters rather than by reading the return value alone.
 *
 * The limit is deliberately a bounded turn window keyed by the scope root being written to, not a
 * rule about the idea: the same proposal is free again once the window passes and after a restart,
 * which is what separates it from a blacklist.
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
} from "../extensions/optional/evolution/evolution-store.js";
import type { ExtensionContext } from "../core/extensions-host/types.js";

const SESSION_ID = "cooldown-test";

/** A structured declaration the observer accepts; the store gate is stubbed so this file is about the rate limit. */
function structuredNote(title: string, scope: "session" | "workspace" | "global" = "session"): string {
	return JSON.stringify({
		catui_evolution: { kind: "memory", title, content: `Prefer ${title}.`, scope },
	});
}

function lessonLine(lesson: string): string {
	return `Done. Reusable lesson: ${lesson}`;
}

interface Space {
	agentDir: string;
	cwd: string;
	dispose: () => void;
}

function space(): Space {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-cooldown-"));
	return {
		agentDir: join(root, "agent"),
		cwd: join(root, "work"),
		dispose: () => rmSync(root, { recursive: true, force: true }),
	};
}

function context(agentDir: string, cwd: string, sessionId = SESSION_ID): ExtensionContext {
	return {
		agentDir,
		cwd,
		sessionManager: { getSessionId: () => sessionId, getEntries: () => [] },
	} as unknown as ExtensionContext;
}

/** A gate that never passes, so nothing is promoted and only candidate creation is observed. */
const inertGate = async () => ({
	name: "evolved-harness-eval",
	passed: false,
	checkedAt: "2026-08-25T00:00:00.000Z",
	metrics: { passRate: 0, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
});

function observer(): EvolutionAutoObserver {
	return new EvolutionAutoObserver({ runGate: inertGate });
}

function sessionCandidates(agentDir: string, sessionId = SESSION_ID): number {
	return inspectEvolution(getEvolutionScopeRoot(agentDir, { scope: "session", sessionId })).candidates.length;
}

test("a repeated structured proposal does not create a new candidate each turn", async () => {
	const s = space();
	try {
		const ctx = context(s.agentDir, s.cwd);
		// One observer for the whole run: the limit lives in memory on the instance, so a second
		// one would start with an empty map and prove nothing.
		const cooldown = new EvolutionAutoObserver({ runGate: inertGate });
		const first = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 1, message: { content: structuredNote("short-circuit") } } as never, ctx);
		assert.ok(first.candidateId, "the first proposal creates a candidate");
		assert.equal(sessionCandidates(s.agentDir), 1);

		// Two more turns carrying the identical declaration.
		for (const turnIndex of [2, 3]) {
			const result = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex, message: { content: structuredNote("short-circuit") } } as never, ctx);
			assert.equal(result.skipped, "cooldown", `turn ${turnIndex} must report why nothing was created`);
			assert.equal(result.candidateId, undefined, "a cooled-down turn must not report a candidate");
		}
		assert.equal(sessionCandidates(s.agentDir), 1, "the ledger gained no records while the window was open");
	} finally {
		s.dispose();
	}
});

test("the cooldown is keyed by the root a proposal writes to, not by session", async () => {
	const s = space();
	try {
		const cooldown = new EvolutionAutoObserver({ runGate: inertGate });
		const first = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 1, message: { content: structuredNote("global-note", "global") } } as never, context(s.agentDir, s.cwd, "session-a"));
		assert.ok(first.candidateId);

		// A different session proposing to the same global scope shares that scope's limit.
		const second = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 2, message: { content: structuredNote("global-note", "global") } } as never, context(s.agentDir, s.cwd, "session-b"));
		assert.equal(second.skipped, "cooldown", "a global scope's limit is that scope's, not a session's");

		// A different scope is unaffected by what the global scope did.
		const workspace = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 2, message: { content: structuredNote("workspace-note", "workspace") } } as never, context(s.agentDir, s.cwd, "session-b"));
		assert.ok(workspace.candidateId, "an unrelated workspace must not be muted by the global scope");
	} finally {
		s.dispose();
	}
});

test("the same proposal is allowed again once the window passes", async () => {
	const s = space();
	try {
		const cooldown = new EvolutionAutoObserver({ runGate: inertGate });
		const ctx = context(s.agentDir, s.cwd);
		await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 1, message: { content: structuredNote("retryable") } } as never, ctx);
		assert.equal(sessionCandidates(s.agentDir), 1);

		// Still inside the three-turn window at turn 3.
		const inside = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 3, message: { content: structuredNote("retryable") } } as never, ctx);
		assert.equal(inside.skipped, "cooldown");
		assert.equal(sessionCandidates(s.agentDir), 1);

		// Past it, the very same declaration is free to be made again. This is the difference
		// between a rate limit and a blacklist.
		const after = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 4, message: { content: structuredNote("retryable") } } as never, ctx);
		assert.ok(after.candidateId, "a bounded window must expire");
		assert.equal(sessionCandidates(s.agentDir), 2);
	} finally {
		s.dispose();
	}
});

test("a restart clears the limit", async () => {
	const s = space();
	try {
		const ctx = context(s.agentDir, s.cwd);
		const first = new EvolutionAutoObserver({ runGate: inertGate });
		await first.observeTurnEnd({ type: "turn_end", turnIndex: 1, message: { content: structuredNote("after-restart") } } as never, ctx);

		// A new observer holds no memory, so the same turn is not suppressed. Nothing is persisted
		// for this on purpose: a limit that outlived the process could outlive its justification.
		const fresh = new EvolutionAutoObserver({ runGate: inertGate });
		const result = await fresh.observeTurnEnd({ type: "turn_end", turnIndex: 1, message: { content: structuredNote("after-restart") } } as never, ctx);
		assert.ok(result.candidateId);
		assert.equal(sessionCandidates(s.agentDir), 2);
	} finally {
		s.dispose();
	}
});

test("the prose branch still honours the limit, and reports it", async () => {
	const s = space();
	try {
		const ctx = context(s.agentDir, s.cwd);
		const cooldown = new EvolutionAutoObserver({ runGate: inertGate });
		const first = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 1, message: { content: lessonLine("prefer the smaller change") } } as never, ctx);
		assert.ok(first.candidateId);

		const second = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 2, message: { content: lessonLine("prefer a different change") } } as never, ctx);
		assert.equal(second.skipped, "cooldown");
	} finally {
		s.dispose();
	}
});

test("a turn with no lesson is still reported as such, not as a cooldown", async () => {
	// Distinct reasons stay distinct: a quiet turn must not be reported as a suppressed one.
	const s = space();
	try {
		const result = await observer().observeTurnEnd({ type: "turn_end", turnIndex: 1, message: { content: "just did some work" } } as never, context(s.agentDir, s.cwd));
		assert.equal(result.skipped, "no_lesson");
	} finally {
		s.dispose();
	}
});

test("the limit only suppresses creation; it relaxes no promotion gate", async () => {
	// The point of the guarantee: a cooled-down turn creates nothing, so nothing can be promoted,
	// and a turn that does create a candidate still faces the real gate. Here the gate refuses and
	// the candidate stays inactive.
	const s = space();
	try {
		const ctx = context(s.agentDir, s.cwd);
		const result = await observer().observeTurnEnd({ type: "turn_end", turnIndex: 1, message: { content: structuredNote("never-promoted") } } as never, ctx);
		assert.ok(result.candidateId, "a candidate exists");
		assert.deepEqual(loadActiveEvolutionArtifacts(getEvolutionScopeRoot(s.agentDir, { scope: "session", sessionId: SESSION_ID })), [], "a failed gate must leave it inactive");
	} finally {
		s.dispose();
	}
});

test("an eval_fixture proposal is covered by the same limit", async () => {
	// The third structured branch. It is a different artifact kind, but it still creates a
	// candidate in the same root, so leaving it out would have been the same gap again.
	const s = space();
	try {
		const root = join(s.cwd, "trace.jsonl");
		const { mkdirSync, writeFileSync } = await import("node:fs");
		mkdirSync(s.cwd, { recursive: true });
		writeFileSync(root, `${JSON.stringify({ version: 1, eventId: "e1", sequence: 1, timestamp: 1, runId: "r", kind: "run.started", payload: { loopFramework: "standard", inputFingerprint: "sha256:a", outputFingerprint: "sha256:b" } })}\n`, "utf8");
		const ctx = context(s.agentDir, s.cwd);
		const cooldown = new EvolutionAutoObserver({ runGate: inertGate });
		const message = { content: JSON.stringify({ catui_evolution: { kind: "eval_fixture", title: "Fixture", scope: "workspace", tracePath: root, applicability: "future replays" } }) };

		const first = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 1, message } as never, ctx);
		assert.ok(first.candidateId, "the first fixture proposal creates a candidate");

		const second = await cooldown.observeTurnEnd({ type: "turn_end", turnIndex: 2, message } as never, ctx);
		assert.equal(second.skipped, "cooldown", "a repeated fixture proposal must not create another candidate");
	} finally {
		s.dispose();
	}
});
