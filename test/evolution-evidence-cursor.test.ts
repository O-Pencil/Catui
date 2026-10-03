/**
 * [WHO]: Proves the observer's turn position survives a restart instead of being re-consumed
 * [FROM]: Depends on node:test/assert/fs/os/path, the real observer, and the real store
 * [TO]: Consumed by test:evolution-boundaries; covers S10.3 so a restart does not repeat processed evidence
 * [HERE]: test/evolution-evidence-cursor.test.ts - S10.3 persisted evidence cursor coverage
 *
 * The observer's last consumed turn used to live in a Map on the observer instance, so it was gone
 * the moment the process was — and with it the only record of which turns had already become
 * candidates. These tests drive the real observer across separate instances over the same agent
 * directory and count candidates in the real store.
 *
 * A cursor that survives a restart is only half the requirement. The other half is that it must not
 * become a standing verdict: it is scoped to one turn stream, it holds no opinion about an idea, and
 * it is written only when evidence is actually consumed — because writing it on every turn would
 * turn the default-inert observer from last round into one that creates state on every single turn.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvolutionAutoObserver } from "../extensions/optional/evolution/evolution-auto.js";
import {
	getEvolutionScopeRoot,
	inspectEvolution,
	readEvolutionEvidenceCursor,
	recordEvolutionEvidenceCursor,
} from "../extensions/optional/evolution/evolution-store.js";
import type { ExtensionContext } from "../core/extensions-host/types.js";

const SESSION_ID = "cursor-test";

interface Space {
	agentDir: string;
	cwd: string;
	dispose: () => void;
}

function space(): Space {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-cursor-"));
	return { agentDir: join(root, "agent"), cwd: join(root, "work"), dispose: () => rmSync(root, { recursive: true, force: true }) };
}

function context(agentDir: string, cwd: string, sessionId = SESSION_ID): ExtensionContext {
	return { agentDir, cwd, sessionManager: { getSessionId: () => sessionId, getEntries: () => [] } } as unknown as ExtensionContext;
}

const inertGate = async () => ({
	name: "evolved-harness-eval",
	passed: false,
	checkedAt: "2026-08-25T00:00:00.000Z",
	metrics: { passRate: 0, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
});

function observer(): EvolutionAutoObserver {
	return new EvolutionAutoObserver({ runGate: inertGate });
}

function sessionRoot(agentDir: string, sessionId = SESSION_ID): string {
	return getEvolutionScopeRoot(agentDir, { scope: "session", sessionId });
}

function sessionCandidates(agentDir: string, sessionId = SESSION_ID): number {
	return inspectEvolution(sessionRoot(agentDir, sessionId)).candidates.length;
}

function lesson(turnIndex: number, text: string) {
	return { type: "turn_end", turnIndex, message: { content: `Reusable lesson: ${text}` }, toolResults: [] } as never;
}

test("a restart does not turn the same evidence into a second candidate", async () => {
	const s = space();
	try {
		const ctx = context(s.agentDir, s.cwd);
		const before = observer();
		assert.ok((await before.observeTurnEnd(lesson(1, "check the failing test first"), ctx)).candidateId);
		assert.equal(sessionCandidates(s.agentDir), 1);

		// A brand new observer over the same agent directory: the process that consumed turn 1 is
		// gone, and the only thing that knows is the file.
		const afterRestart = observer();
		const repeat = await afterRestart.observeTurnEnd(lesson(1, "check the failing test first"), ctx);
		assert.equal(repeat.skipped, "cooldown", "the cursor outlives the instance that wrote it");
		assert.equal(sessionCandidates(s.agentDir), 1, "and the ledger gained nothing");

		const alsoRepeat = await afterRestart.observeTurnEnd(lesson(2, "an entirely different lesson"), ctx);
		assert.equal(alsoRepeat.skipped, "cooldown", "the whole window is inside the cursor, not just one turn");
		assert.equal(sessionCandidates(s.agentDir), 1);
	} finally {
		s.dispose();
	}
});

test("the cursor lands in the scope root the proposal writes to", async () => {
	const s = space();
	try {
		await observer().observeTurnEnd(lesson(4, "quote the output that shows the state"), context(s.agentDir, s.cwd));

		const root = sessionRoot(s.agentDir);
		assert.equal(existsSync(join(root, "evidence-cursor.json")), true, "the cursor is the scope's own state");
		assert.deepEqual(readdirSync(root).sort(), ["candidates", "evidence-cursor.json", "history.jsonl"], "one more file in the existing root, no new namespace and no new directory");
		assert.equal(readEvolutionEvidenceCursor(root, SESSION_ID)?.lastTurnIndex, 4);
	} finally {
		s.dispose();
	}
});

test("a cursor from a finished session does not silence the next one", async () => {
	// Turn indices restart with a session. A global or workspace scope is shared, so a cursor left at
	// turn 40 by a finished session would otherwise sit above every early turn of the next session.
	const s = space();
	try {
		const globalRoot = getEvolutionScopeRoot(s.agentDir, { scope: "global" });
		recordEvolutionEvidenceCursor(globalRoot, "finished-session", 40);

		assert.equal(readEvolutionEvidenceCursor(globalRoot, "finished-session")?.lastTurnIndex, 40);
		assert.equal(readEvolutionEvidenceCursor(globalRoot, "next-session"), undefined, "a different stream has no cursor to obey");

		const result = await observer().observeTurnEnd(
			{ type: "turn_end", turnIndex: 1, message: { content: '{"catui_evolution":{"kind":"memory","title":"Fresh","content":"Fresh evidence","scope":"global"}}' }, toolResults: [] } as never,
			context(s.agentDir, s.cwd, "next-session"),
		);
		assert.ok(result.candidateId, "the new session's first turn is new evidence");
	} finally {
		s.dispose();
	}
});

test("the cursor never rewinds", async () => {
	// Turns settle out of order when several finish at once, and a cursor that moved backwards would
	// re-admit evidence already consumed.
	const s = space();
	try {
		const root = sessionRoot(s.agentDir);
		recordEvolutionEvidenceCursor(root, SESSION_ID, 9);
		const outOfOrder = recordEvolutionEvidenceCursor(root, SESSION_ID, 3);

		assert.equal(outOfOrder.lastTurnIndex, 9);
		assert.equal(readEvolutionEvidenceCursor(root, SESSION_ID)?.lastTurnIndex, 9);
	} finally {
		s.dispose();
	}
});

test("a corrupt cursor reads as absent rather than as silence", async () => {
	// The two ways to be wrong are re-consuming one turn, which costs a duplicate candidate, and
	// refusing every turn, which costs the feature. Only the first is recoverable.
	const s = space();
	try {
		const root = sessionRoot(s.agentDir);
		recordEvolutionEvidenceCursor(root, SESSION_ID, 12);
		writeFileSync(join(root, "evidence-cursor.json"), "{ truncated", "utf8");

		assert.equal(readEvolutionEvidenceCursor(root, SESSION_ID), undefined, "an unreadable cursor is not obeyed");

		const result = await observer().observeTurnEnd(lesson(1, "proceed despite the damage"), context(s.agentDir, s.cwd));
		assert.ok(result.candidateId, "the observer keeps working rather than going permanently quiet");
	} finally {
		s.dispose();
	}
});

test("an inert turn writes no cursor, so the default path stays inert", async () => {
	// Last round pinned that the default observer creates nothing at all. Writing a cursor on every
	// turn would have quietly reversed that: the scope root and a file would appear on any turn with
	// no proposal in it.
	const s = space();
	try {
		const ctx = context(s.agentDir, s.cwd);
		for (let turnIndex = 1; turnIndex <= 12; turnIndex += 1) {
			const result = await observer().observeTurnEnd(
				{ type: "turn_end", turnIndex, message: { content: `just did some work, turn ${turnIndex}` }, toolResults: [] } as never,
				ctx,
			);
			assert.equal(result.skipped, "no_lesson");
		}
		assert.equal(existsSync(sessionRoot(s.agentDir)), false, "twelve quiet turns must not create the scope root");
		assert.equal(existsSync(join(s.agentDir, "evolution")), false);
	} finally {
		s.dispose();
	}
});

test("a rejected proposal still advances the cursor", async () => {
	// A turn that produced a candidate is consumed evidence whether or not the candidate was any
	// good. Not advancing would re-propose the same turn on every restart.
	const s = space();
	try {
		const ctx = context(s.agentDir, s.cwd);
		const first = observer();
		// The gate refuses, so the candidate stays proposed and inactive.
		const result = await first.observeTurnEnd(lesson(1, "a lesson whose gate will refuse"), ctx);
		assert.ok(result.candidateId);

		const afterRestart = observer();
		assert.equal((await afterRestart.observeTurnEnd(lesson(1, "a lesson whose gate will refuse"), ctx)).skipped, "cooldown");
		assert.equal(sessionCandidates(s.agentDir), 1);
	} finally {
		s.dispose();
	}
});

test("the cursor never blocks a gate decision or an activation", async () => {
	// The cursor governs when evidence is *read*. It must not become a way to suppress a promotion,
	// which is the one thing on this path that is not a rate limit.
	const s = space();
	try {
		const root = sessionRoot(s.agentDir);
		recordEvolutionEvidenceCursor(root, SESSION_ID, 99);
		assert.equal(inspectEvolution(root).revisions.length, 0, "a cursor is not a revision and confers nothing");
		assert.deepEqual(inspectEvolution(root).candidates, [], "and no candidate either");
	} finally {
		s.dispose();
	}
});
