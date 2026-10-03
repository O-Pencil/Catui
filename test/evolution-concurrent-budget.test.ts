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
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_EVOLUTION_BUDGET,
	readEvolutionBudget,
	reserveEvolutionModelCall,
} from "../extensions/optional/evolution/evolution-budget.js";
import { EvolutionAutoObserver } from "../extensions/optional/evolution/evolution-auto.js";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	inspectEvolution,
	loadActiveEvolutionArtifacts,
	loadCurrentEvolution,
	recordEvolutionGateFailure,
} from "../extensions/optional/evolution/evolution-store.js";
import type { ExtensionContext } from "../core/extensions-host/types.js";
import type { EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";

const FAILING_GATE: EvolutionGateReport = {
	name: "evolved-harness-eval",
	passed: false,
	checkedAt: "2026-08-25T00:00:00.000Z",
	metrics: { passRate: 0, replayDivergences: 1, policyViolations: 0, unpairedToolCalls: 0 },
};

const HELPER = fileURLToPath(new URL("./helpers/reserve-model-call.ts", import.meta.url));
const HOLDER = fileURLToPath(new URL("./helpers/hold-budget-lock.ts", import.meta.url));
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

/** An in-process reservation, for the cases that do not need a second process. */
function reserveInProcess(agentDir: string, policy: Partial<typeof DEFAULT_EVOLUTION_BUDGET> = {}) {
	return reserveEvolutionModelCall(agentDir, { ...DEFAULT_EVOLUTION_BUDGET, ...policy });
}

function sleep(ms: number): Promise<void> {
	return new Promise((done) => setTimeout(done, ms));
}

/** Polls until `ready` or the budget runs out, so the test does not depend on spawn timing. */
async function waitFor(ready: () => boolean, timeoutMs: number): Promise<boolean> {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		if (ready()) return true;
		await sleep(25);
	}
	return ready();
}

interface ChildResult {
	reserved: boolean;
	reason?: string;
	calls?: number;
	message?: string;
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
		reserveInProcess(s.agentDir);
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

test("a lock left by a dead process is reported, never removed automatically", async () => {
	// This reverses the previous version of this file, and the reversal is the point. The old test
	// asserted that a stale lock was broken so the budget could recover. Recovery means one process
	// removing a file on the belief that it belongs to another, and the only check available is
	// stat-then-unlink, which is not atomic: a replacement installed in between is deleted, and the
	// process that installed it never learns. POSIX has no compare-and-remove, so there is no
	// version of automatic recovery that is also correct. The budget refuses and says who to ask.
	const s = space();
	try {
		reserveInProcess(s.agentDir);
		const lock = lockFile(s.agentDir);
		writeFileSync(lock, `${JSON.stringify({ pid: 2 ** 30, acquiredAt: "long ago" })}\n`, "utf8");
		const longAgo = new Date(Date.now() - 60_000);
		utimesSync(lock, longAgo, longAgo);

		const result = await reserveInChild(s.agentDir, { dailyCallBudget: 5, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 });
		assert.equal(result.reserved, false, "a lock this process did not take must not be taken over");
		assert.equal(readEvolutionBudget(s.agentDir).calls, 1, "and no call may be charged behind it");
	} finally {
		s.dispose();
	}
});

test("a dead owner's lock is refused with a message that names the recovery", async () => {
	const s = space();
	try {
		reserveInProcess(s.agentDir);
		const lock = lockFile(s.agentDir);
		writeFileSync(lock, `${JSON.stringify({ pid: 2 ** 30, acquiredAt: "long ago" })}\n`, "utf8");
		const longAgo = new Date(Date.now() - 60_000);
		utimesSync(lock, longAgo, longAgo);

		const result = reserveInProcess(s.agentDir);
		assert.equal(result.reserved, false);
		if (!result.reserved) {
			assert.equal(result.reason, "budget_locked");
			// The operator has to be told which situation they are in and what to do about it.
			assert.match(result.message, /no longer running/);
			assert.match(result.message, new RegExp(lock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the message must name the file to remove");
			assert.match(result.message, /No model call was made/);
		}
		assert.equal(existsSync(lock), true, "and the lock is left exactly where the dead owner left it");
	} finally {
		s.dispose();
	}
});

test("an unknown lock owner is treated as alive, not as abandoned", async () => {
	// Unreadable contents, a missing pid, or an unprobeable liveness are all unknown. Unknown is not
	// evidence of abandonment, and reading it that way is how two processes charge one headroom.
	for (const contents of ["{ not json", "{}", JSON.stringify({ pid: 0 }), JSON.stringify({ pid: "x" })]) {
		const s = space();
		try {
			reserveInProcess(s.agentDir);
			const lock = lockFile(s.agentDir);
			writeFileSync(lock, `${contents}\n`, "utf8");
			const longAgo = new Date(Date.now() - 60_000);
			utimesSync(lock, longAgo, longAgo);

			const result = await reserveInChild(s.agentDir, { dailyCallBudget: 5, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 });
			assert.equal(result.reserved, false, `contents ${contents} must not be read as a dead owner`);
			assert.equal(existsSync(lock), true, `contents ${contents} must leave the lock alone`);
			// The refusal and the untouched file are the same either way, so the only observable
			// difference between "alive" and "dead" is which repair the message recommends. Asserting
			// only the outcome would let the two be swapped freely.
			assert.ok(result.message?.includes("still running"), `an unknown owner must be described as running, got: ${result.message}`);
		} finally {
			s.dispose();
		}
	}
});

test("a lock owned by a live process is never broken, however old it looks", () => {
	// Age is not proof of death. A stopped process, a suspended host, or a stalled filesystem all
	// leave a lock looking arbitrarily old while its owner is alive and about to resume. The
	// recorded pid here is this very process, so it cannot be argued with.
	const s = space();
	try {
		reserveInProcess(s.agentDir);
		const lock = lockFile(s.agentDir);
		writeFileSync(lock, `${JSON.stringify({ pid: process.pid, acquiredAt: "long ago" })}\n`, "utf8");
		const longAgo = new Date(Date.now() - 60_000);
		utimesSync(lock, longAgo, longAgo);

		const result = reserveInProcess(s.agentDir);
		assert.equal(result.reserved, false, "a live owner's lock must not be broken");
		assert.equal(result.reason, "budget_locked", "and the refusal must say it was contention, not exhaustion");
		assert.equal(existsSync(lock), true, "the owner's lock must be left exactly where it was");
		assert.equal(readEvolutionBudget(s.agentDir).calls, 1, "no second call was charged");
	} finally {
		s.dispose();
	}
});

test("a real child holding the lock keeps everyone else out, and cleans up after itself", async () => {
	// The live-owner case across processes, using a child that takes the lock the way a real owner
	// does and holds it past the staleness window.
	const s = space();
	try {
		reserveInProcess(s.agentDir);
		// Held well past a waiter's full attempt budget (60 attempts x 20ms), so "respected" cannot
		// be confused with "the holder happened to leave first".
		const holder = spawn(process.execPath, ["--import", "tsx", HOLDER, s.agentDir, "2500"], { cwd: REPO_ROOT });
		try {
			const held = await waitFor(() => existsSync(lockFile(s.agentDir)), 5_000);
			assert.ok(held, "the child must have taken the lock");
			await sleep(150);
			utimesSync(lockFile(s.agentDir), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

			const refused = await reserveInChild(s.agentDir, { dailyCallBudget: 5, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 });
			assert.equal(refused.reserved, false, "a live child owner's lock must be respected");
			assert.equal(readEvolutionBudget(s.agentDir).calls, 1, "and no call was charged while it held it");
		} finally {
			holder.kill("SIGKILL");
		}
		// Killed, so its lock is orphaned. The next reservation must refuse it rather than take it
		// over: a lock this process did not create is never removed on a guess about who owned it.
		const afterDeath = await reserveInChild(s.agentDir, { dailyCallBudget: 5, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 });
		assert.equal(afterDeath.reserved, false, "an orphaned lock is not taken over automatically");
		assert.equal(existsSync(lockFile(s.agentDir)), true, "and it is left for an operator to remove");

		// Operator recovery is the documented step, and it is the only thing that clears it.
		rmSync(lockFile(s.agentDir));
		const afterRecovery = await reserveInChild(s.agentDir, { dailyCallBudget: 5, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 });
		assert.equal(afterRecovery.reserved, true, "once the orphaned lock is removed, reservations resume");
	} finally {
		s.dispose();
	}
});

test("two waiters contending for a dead owner's lock both refuse and neither removes it", async () => {
	// The competition the old design mishandled. Both waiters observe the same file, and under the
	// previous recovery both would have raced to delete it — with the loser's unlink landing on the
	// winner's fresh lock. Now nobody deletes it, so the ledger cannot be charged twice and the
	// file is still there for the operator.
	const s = space();
	try {
		reserveInProcess(s.agentDir);
		const lock = lockFile(s.agentDir);
		writeFileSync(lock, `${JSON.stringify({ pid: 2 ** 30, acquiredAt: "long ago" })}\n`, "utf8");
		const longAgo = new Date(Date.now() - 60_000);
		utimesSync(lock, longAgo, longAgo);
		const seeded = readEvolutionBudget(s.agentDir).calls ?? 0;

		const results = await Promise.all([
			reserveInChild(s.agentDir, { dailyCallBudget: 2, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 }),
			reserveInChild(s.agentDir, { dailyCallBudget: 2, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 }),
		]);

		assert.equal(results.filter((result) => result.reserved).length, 0, `neither waiter may take a lock it did not create: ${JSON.stringify(results)}`);
		for (const result of results) {
			assert.equal(result.reason, "budget_locked", `loser must say why: ${JSON.stringify(result)}`);
		}
		assert.equal(readEvolutionBudget(s.agentDir).calls, seeded, "the ledger is untouched by a lock nobody may take");
		assert.equal(existsSync(lock), true, "and the lock survives the contention");
	} finally {
		s.dispose();
	}
});

test("granted reservations and the ledger agree under contention", async () => {
	// Counting the ledger alone would miss a reservation that was granted and not recorded, or the
	// reverse. Both numbers are asserted against each other, not just the cap.
	const s = space();
	try {
		const cap = { dailyCallBudget: 3, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 };
		const results = await Promise.all(Array.from({ length: 5 }, () => reserveInChild(s.agentDir, cap)));
		const granted = results.filter((result) => result.reserved);

		assert.equal(granted.length, cap.dailyCallBudget, `the cap bounds grants, not just the ledger: ${JSON.stringify(results)}`);
		assert.equal(readEvolutionBudget(s.agentDir).calls, granted.length, "ledger and granted reservations must be the same number");
		// Each grant took a distinct cumulative position, with no gap and no two winners charged the
		// same slot. Summing the counters would mean nothing — they are positions, not increments.
		assert.deepEqual(
			granted.map((result) => result.calls).sort((a, b) => (a ?? 0) - (b ?? 0)),
			Array.from({ length: cap.dailyCallBudget }, (_, index) => index + 1),
			"every granted call must occupy its own position in the ledger",
		);
	} finally {
		s.dispose();
	}
});

test("a gate failure leaves the candidate inactive, checked by reloading from disk", () => {
	// The earlier version of this test asserted `candidate.status` on the object it already had in
	// hand, and compared a pre-state it had just reconstructed against itself. Neither can fail for
	// the reason it claims to check. Everything here is read back out of the store instead.
	const s = space();
	try {
		const root = getEvolutionScopeRoot(s.agentDir, { scope: "session", sessionId: "failure" });
		const candidate = createEvolutionCandidate(root, {
			scope: "session",
			summary: "propose",
			rationale: "measured",
			expectedOutcome: "should not activate",
			artifacts: [{ id: "evolved:prompt_note:never", kind: "prompt_note", title: "Never", content: "Body", applicability: "When." }],
			evidence: { source: "test" },
		});
		recordEvolutionGateFailure(root, candidate.id, { gateReport: FAILING_GATE });

		// Reloaded, not the in-memory record.
		const persisted = inspectEvolution(root).candidates.find((entry) => entry.id === candidate.id);
		assert.ok(persisted, "the candidate must still be on disk after a gate failure");
		assert.equal(persisted.status, "proposed", "a recorded gate failure is not a rejection");
		assert.deepEqual(persisted.validation?.errors, [], "a recorded failure is not a validation error");
		assert.ok(persisted.evidence.gateReport, "the failure is retained as a diagnostic");
		assert.deepEqual(loadActiveEvolutionArtifacts(root), [], "nothing became active");
		assert.equal(inspectEvolution(root).revisions.length, 0, "no revision was written");
		assert.equal(loadCurrentEvolution(root), undefined, "the active pointer never moved");
	} finally {
		s.dispose();
	}
});

test("an aborted gate run leaves nothing active and writes no revision", async () => {
	// The abort path, not a refusal. The gate throws rather than returning a failing report, which
	// is what a cancelled or crashed evaluation looks like to the store.
	const s = space();
	try {
		const root = getEvolutionScopeRoot(s.agentDir, { scope: "session", sessionId: "aborted" });
		const observer = new EvolutionAutoObserver({
			runGate: async () => {
				throw new Error("evaluation aborted");
			},
		});
		const ctx = { agentDir: s.agentDir, cwd: s.cwd, sessionManager: { getSessionId: () => "aborted", getEntries: () => [] } } as unknown as ExtensionContext;

		// The turn_end handler swallows observer errors, so drive the observer and swallow here the
		// same way production does.
		const outcome = await observer
			.observeTurnEnd({ type: "turn_end", turnIndex: 1, message: { content: "Reusable lesson: this one gets aborted" }, toolResults: [] } as never, ctx)
			.then((result) => result, () => undefined);

		assert.equal(outcome, undefined, "precondition: the abort propagated rather than returning a result");
		const persisted = inspectEvolution(root).candidates;
		assert.equal(persisted.length, 1, "the candidate was created before the gate ran");
		assert.equal(persisted[0]!.status, "proposed", "an aborted evaluation does not reject the candidate either");
		assert.deepEqual(loadActiveEvolutionArtifacts(root), [], "an abort must not activate anything");
		assert.equal(inspectEvolution(root).revisions.length, 0);
		assert.equal(loadCurrentEvolution(root), undefined, "and must not move the active pointer");
	} finally {
		s.dispose();
	}
});

test("an abort does not spend budget that no call was made for", async () => {
	// The observer makes no model call, so a budget ledger must not exist at all. An abort that
	// created one would mean something started paying for a path that costs nothing.
	const s = space();
	try {
		const root = getEvolutionScopeRoot(s.agentDir, { scope: "session", sessionId: "aborted-budget" });
		const observer = new EvolutionAutoObserver({ runGate: async () => { throw new Error("evaluation aborted"); } });
		const ctx = { agentDir: s.agentDir, cwd: s.cwd, sessionManager: { getSessionId: () => "aborted-budget", getEntries: () => [] } } as unknown as ExtensionContext;
		await observer
			.observeTurnEnd({ type: "turn_end", turnIndex: 1, message: { content: "Reusable lesson: aborted" }, toolResults: [] } as never, ctx)
			.catch(() => undefined);

		// The budget lives at the shared root, not under the session scope, so that is where its
		// absence has to be checked. The session root does exist — the candidate and cursor are there.
		const shared = join(s.agentDir, "evolution", "v1");
		const present = existsSync(shared) ? readdirSync(shared) : [];
		assert.deepEqual(present.filter((entry) => entry.startsWith("budget")), [], "no ledger, no lock, nothing spent");
		assert.ok(inspectEvolution(root).candidates.length > 0, "precondition: the candidate and cursor did land under the session scope");
	} finally {
		s.dispose();
	}
});
