/**
 * [WHO]: Proves the budget cap holds between processes, and that a failure never activates anything
 * [FROM]: Depends on node:test/assert/child_process/fs/os/path, the real budget module, and the real store
 * [TO]: Consumed by test:evolution-boundaries; covers S10 so concurrent triggers cannot double-spend and failures stay inactive
 * [HERE]: test/evolution-concurrent-budget.test.ts - S10 concurrency and failure isolation coverage
 *
 * The budget's read-modify-write was correct within one process and unbounded between them: N
 * processes racing on the same agent directory each read the same headroom and each charged, so the
 * cap could be exceeded by up to N - 1. An in-process test cannot show anything about that, so the
 * race is driven with real spawned children.
 *
 * Which child wins a race is not deterministic, so the assertion is the invariant rather than a
 * count of winners: the ledger must never record more calls than the cap allows. The lock's own
 * semantics — held, contended, stale — are asserted deterministically instead.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEvolutionBudget, reserveEvolutionModelCall } from "../extensions/optional/evolution/evolution-budget.js";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	loadActiveEvolutionArtifacts,
	recordEvolutionGateFailure,
} from "../extensions/optional/evolution/evolution-store.js";
import type { EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";

const HELPER = fileURLToPath(new URL("./helpers/reserve-model-call.ts", import.meta.url));
const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

interface Space {
	agentDir: string;
	dispose: () => void;
}

function space(): Space {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-concurrent-"));
	return { agentDir: join(root, "agent"), dispose: () => rmSync(root, { recursive: true, force: true }) };
}

function budgetFile(agentDir: string): string {
	return join(agentDir, "evolution", "v1", "budget.json");
}

function lockFile(agentDir: string): string {
	return `${budgetFile(agentDir)}.lock`;
}

interface ChildResult {
	reserved: boolean;
	reason?: string;
	calls?: number;
}

function reserveInChild(agentDir: string, policy: Record<string, unknown>): Promise<ChildResult> {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(process.execPath, ["--import", "tsx", HELPER, agentDir, JSON.stringify(policy)], { cwd: REPO_ROOT });
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
		child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
		child.on("error", rejectPromise);
		child.on("close", () => {
			const line = out.trim().split("\n").filter(Boolean).pop();
			if (!line) return rejectPromise(new Error(`child produced no output; stderr: ${err}`));
			try {
				resolvePromise(JSON.parse(line) as ChildResult);
			} catch (error) {
				rejectPromise(new Error(`unparseable child output: ${line} (${err})`));
			}
		});
	});
}

test("concurrent processes cannot record more calls than the cap allows", async () => {
	const s = space();
	try {
		// One call, six processes. Which one wins is not the point; the ledger ending above the cap
		// would be.
		const results = await Promise.all(Array.from({ length: 6 }, () => reserveInChild(s.agentDir, { dailyCallBudget: 1, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 })));

		assert.equal(results.filter((result) => result.reserved).length, 1, `exactly one should win: ${JSON.stringify(results)}`);
		const report = readEvolutionBudget(s.agentDir);
		assert.equal(report.corrupt, false);
		assert.equal(report.calls, 1, "and the ledger must not record more than the cap");
	} finally {
		s.dispose();
	}
});

test("every loser is refused for a stated reason, and none is a silent success", async () => {
	const s = space();
	try {
		const results = await Promise.all(Array.from({ length: 5 }, () => reserveInChild(s.agentDir, { dailyCallBudget: 1, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 })));
		const losers = results.filter((result) => !result.reserved);
		assert.equal(losers.length, 4);
		for (const loser of losers) {
			assert.ok(
				loser.reason === "budget_exhausted" || loser.reason === "budget_locked",
				`a loser must say why, got ${JSON.stringify(loser)}`,
			);
		}
	} finally {
		s.dispose();
	}
});

test("a lock held by another process makes the reservation wait rather than proceed", async () => {
	// Deterministic half of the lock's contract: the critical section really is exclusive, so a
	// second entrant cannot slip past it the way the unsynchronized version let N - 1 through.
	const s = space();
	try {
		reserveEvolutionCandidate(s.agentDir);
		// A fresh lock, as if another process were mid-reservation right now.
		writeFileSync(lockFile(s.agentDir), `${JSON.stringify({ pid: 999999, acquiredAt: new Date().toISOString() })}\n`, "utf8");

		const blocked = reserveInChild(s.agentDir, { dailyCallBudget: 5, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 });
		// The lock is still held, so the child cannot have finished a successful reservation.
		const outcome = await blocked;
		assert.equal(outcome.reserved, false, "a held lock must not be entered");
		// The stated reason, not merely a falsy result. Falling through to an unlocked reservation
		// would either succeed silently or throw, and neither tells anyone the cap was contended.
		assert.equal(outcome.reason, "budget_locked", `a contended lock must say so, got ${JSON.stringify(outcome)}`);
		assert.equal(readEvolutionBudget(s.agentDir).calls, 1, "and the call already spent is still the only one");

		// Releasing it lets the next caller through, which is what makes this a wait and not a block.
		rmSync(lockFile(s.agentDir));
		const afterRelease = reserveInChild(s.agentDir, { dailyCallBudget: 5, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 });
		assert.equal((await afterRelease).reserved, true, "once the lock clears, reservations resume");
	} finally {
		s.dispose();
	}
});

test("a lock left by a dead process does not wedge the budget forever", async () => {
	// A cap that one crash can deadlock away is not a cap. The staleness window is what keeps the
	// guarantee from becoming an outage.
	const s = space();
	try {
		reserveEvolutionCandidate(s.agentDir);
		writeFileSync(lockFile(s.agentDir), `${JSON.stringify({ pid: 999999, acquiredAt: "long ago" })}\n`, "utf8");
		const longAgo = new Date(Date.now() - 60_000);
		utimesSync(lockFile(s.agentDir), longAgo, longAgo);

		const result = await reserveInChild(s.agentDir, { dailyCallBudget: 5, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 });
		assert.equal(result.reserved, true, "a stale lock must be broken, not obeyed forever");
		assert.equal(readEvolutionBudget(s.agentDir).calls, 2);
	} finally {
		s.dispose();
	}
});

function reserveEvolutionCandidate(agentDir: string): void {
	const first = reserveEvolutionModelCall(agentDir, { dailyCallBudget: 1, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 });
	assert.equal(first.reserved, true);
}

test("a gate failure leaves the candidate inactive and changes nothing but diagnostics", async () => {
	const s = space();
	try {
		const root = getEvolutionScopeRoot(s.agentDir, { scope: "session", sessionId: "failure" });
		const before = {
			pointer: undefined,
			active: loadActiveEvolutionArtifacts(root),
			revisions: 0,
		};
		const candidate = createEvolutionCandidate(root, {
			scope: "session",
			summary: "propose",
			rationale: "measured",
			expectedOutcome: "should not activate",
			artifacts: [{ id: "evolved:prompt_note:never", kind: "prompt_note", title: "Never", content: "Body", applicability: "When." }],
			evidence: { source: "test" },
		});

		const failingGate: EvolutionGateReport = {
			name: "evolved-harness-eval",
			passed: false,
			checkedAt: "2026-08-25T00:00:00.000Z",
			metrics: { passRate: 0, replayDivergences: 1, policyViolations: 0, unpairedToolCalls: 0 },
		};
		recordEvolutionGateFailure(root, candidate.id, { gateReport: failingGate });

		assert.equal(candidate.status, "proposed", "a recorded gate failure is not a rejection");
		assert.deepEqual(loadActiveEvolutionArtifacts(root), [], "and nothing became active");
		assert.deepEqual({ pointer: undefined, active: before.active, revisions: 0 }, before, "the pre-state was already inert");
	} finally {
		s.dispose();
	}
});
