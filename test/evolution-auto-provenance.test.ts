/**
 * [WHO]: Verifies turn-end observed candidates record honest provenance and cannot self-promote
 * [FROM]: Depends on node:test/assert/fs/os/path, the real EvolutionAutoObserver, and the real store
 * [TO]: Consumed by test:evolution-boundaries; covers S06.2 and S06.8
 * [HERE]: test/evolution-auto-provenance.test.ts - outcome discrimination coverage
 *
 * Both turn-end sources originate in the assistant's own output. This file asserts that the
 * observer records that fact rather than labelling either branch "verified", and that a prose
 * self-report never reaches promotion on its own.
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
	loadCurrentEvolution,
} from "../extensions/optional/evolution/evolution-store.js";
import type { ExtensionContext, TurnEndEvent } from "../core/extensions-host/types.js";

const SESSION_ID = "provenance-test";

function withScope(run: (scopeRoot: string, ctx: ExtensionContext) => Promise<void>): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-provenance-"));
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

function candidateEvidence(scopeRoot: string, candidateId: string): Record<string, unknown> {
	const found = inspectEvolution(scopeRoot).candidates.find((entry) => entry.id === candidateId);
	assert.ok(found, `candidate ${candidateId} should exist`);
	return (found as { evidence?: Record<string, unknown> }).evidence ?? {};
}

test("a prose self-report is recorded as such, never as verified", async () => {
	await withScope(async (scopeRoot, ctx) => {
		// The gate is stubbed to fail so the observer records the candidate and stops at the
		// failure branch. Whether a prose self-report may promote at all is a separate concern
		// covered by s06-unverified-cannot-auto-promote; here we only assert the recorded mark.
		const observer = new EvolutionAutoObserver({ runGate: async () => failingGate() });
		const result = await observer.observeTurnEnd(
			turnEnd(5, "Reusable lesson: prefer focused regression tests"),
			ctx,
		);
		assert.ok(result.candidateId, "a prose lesson should still produce an inactive candidate");

		const evidence = candidateEvidence(scopeRoot, result.candidateId);
		assert.equal(evidence.provenance, "model_prose_self_report");
		assert.equal(evidence.source, "turn_end");
		assert.equal(
			evidence.verified,
			undefined,
			"a model self-report must never carry a verified flag",
		);
		assert.equal(loadCurrentEvolution(scopeRoot), undefined, "nothing may become active");
	});
});

test("a structured declaration is recorded distinctly from a prose self-report", async () => {
	await withScope(async (scopeRoot, ctx) => {
		const observer = new EvolutionAutoObserver({ runGate: async () => failingGate() });
		const result = await observer.observeTurnEnd(
			turnEnd(5, JSON.stringify({
				catui_evolution: {
					scope: "session",
					kind: "memory",
					title: "Structured preference",
					content: "Prefer focused regression tests.",
				},
			})),
			ctx,
		);
		assert.ok(result.candidateId);

		const evidence = candidateEvidence(scopeRoot, result.candidateId);
		assert.equal(evidence.provenance, "model_structured_declaration");
		assert.equal(
			evidence.verified,
			undefined,
			"a structured declaration is still a self-declaration and must not claim verification",
		);
	});
});

test("the two turn-end sources produce distinguishable provenance", async () => {
	await withScope(async (scopeRoot, ctx) => {
		const observer = new EvolutionAutoObserver({ runGate: async () => failingGate() });
		const prose = await observer.observeTurnEnd(turnEnd(5, "Reusable lesson: one"), ctx);
		const structured = await observer.observeTurnEnd(
			turnEnd(9, JSON.stringify({
				catui_evolution: { scope: "session", kind: "memory", title: "T", content: "C" },
			})),
			ctx,
		);
		assert.notEqual(
			candidateEvidence(scopeRoot, prose.candidateId!).provenance,
			candidateEvidence(scopeRoot, structured.candidateId!).provenance,
		);
	});
});

test("turns with no lesson and malformed proposals create no candidate and change no active state", async () => {
	await withScope(async (scopeRoot, ctx) => {
		const observer = new EvolutionAutoObserver({ runGate: async () => failingGate() });

		const noLesson = await observer.observeTurnEnd(turnEnd(5, "Just a normal answer with no marker."), ctx);
		assert.equal(noLesson.candidateId, undefined);
		assert.equal(noLesson.skipped, "no_lesson");

		const malformed = await observer.observeTurnEnd(turnEnd(9, '{"catui_evolution": {"kind": '), ctx);
		assert.equal(malformed.candidateId, undefined);
		assert.equal(malformed.skipped, "no_lesson");

		assert.equal(inspectEvolution(scopeRoot).candidates.length, 0, "no candidate may be created");
		assert.equal(loadCurrentEvolution(scopeRoot), undefined, "active state must be untouched");
	});
});

function failingGate() {
	return {
		name: "builtin-harness-eval",
		passed: false,
		checkedAt: "2026-08-25T01:00:00.000Z",
		metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
	};
}
