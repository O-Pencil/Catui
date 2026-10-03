/**
 * [WHO]: Daily reservation ledger for the extension's only model call, refused before the call is made and serialized across processes by an identity-checked exclusive lock
 * [FROM]: Depends on Node fs/path and no model or network access
 * [TO]: Consumed by evolution-refiner, the only caller of completeSimple in this extension
 * [HERE]: extensions/optional/evolution/evolution-budget.ts - reserve-before-call budget guard
 *
 * The point of reserving rather than checking is the ordering. If the cap is consulted and only
 * charged afterwards, two callers in the same tick both read a state that still has room, both
 * spend, and the cap is exceeded by exactly the amount it was supposed to prevent. So the
 * reservation is written first and the call follows it; a caller that cannot reserve never reaches
 * the model at all.
 *
 * A reservation that is never spent — the call throws, or the process dies — stays charged. That is
 * deliberate. This ledger measures attempts, not successes, because whether a failed completion
 * billed anything is not knowable from here, and under-counting is the direction that lets a runaway
 * loop run up a bill. Over-counting a failed call is recoverable the next day; an uncounted one is
 * not.
 *
 * Token and cost figures here are estimates reserved against a daily cap, never measurements. They
 * exist to bound a loop, not to bill anyone.
 */

import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface EvolutionBudgetPolicy {
	schemaVersion: 1;
	/** Calls allowed per UTC day. The hard cap; the estimate below is a second, softer limit. */
	dailyCallBudget: number;
	estimatedTokensPerCall: number;
	dailyEstimatedTokenBudget: number;
}

export interface EvolutionBudgetState {
	schemaVersion: 1;
	day: string;
	calls: number;
	estimatedTokens: number;
}

/**
 * The two caps are kept in agreement on purpose: 5 calls at 8,000 estimated tokens each is exactly
 * the 40,000-token daily reservation the source-side policy already documents. An earlier version set
 * the call cap to 20 against the same token budget, which made 20 unreachable and left a reader to
 * work out which limit actually binds. A cap nobody can reason about is a cap nobody trusts.
 */
export const DEFAULT_EVOLUTION_BUDGET: Readonly<EvolutionBudgetPolicy> = {
	schemaVersion: 1,
	dailyCallBudget: 5,
	estimatedTokensPerCall: 8_000,
	dailyEstimatedTokenBudget: 40_000,
};

export type BudgetReservation =
	| { reserved: true; day: string; calls: number; remainingCalls: number }
	| { reserved: false; reason: "budget_exhausted" | "budget_locked"; day: string; calls: number; message: string };

/** Under the existing evolution root, beside the other private state. No new directory, no daemon, no timer. */
function budgetPath(agentDir: string): string {
	return resolve(agentDir, "evolution", "v1", "budget.json");
}

function utcDay(now: Date): string {
	return now.toISOString().slice(0, 10);
}

function freshState(now: Date): EvolutionBudgetState {
	return { schemaVersion: 1, day: utcDay(now), calls: 0, estimatedTokens: 0 };
}

/**
 * Reads the ledger. Purely a read: it touches no file, renames nothing, and writes nothing.
 *
 * Everything with a side effect lives in `reserveEvolutionModelCall`. That split is not tidiness. A
 * reporting function that quarantines a corrupt ledger deletes the very file the next reservation
 * needs to see, so *asking* about the budget would clear a corruption block it did not create.
 */
function peekState(path: string, now: Date): { state: EvolutionBudgetState; corrupt: boolean } {
	if (!existsSync(path)) return { state: freshState(now), corrupt: false };
	const read = (): EvolutionBudgetState | undefined => {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		if (
			parsed?.schemaVersion !== 1
			|| typeof parsed.day !== "string"
			|| !/^\d{4}-\d{2}-\d{2}$/.test(parsed.day)
			|| !Number.isInteger(parsed.calls) || (parsed.calls as number) < 0
			|| !Number.isInteger(parsed.estimatedTokens) || (parsed.estimatedTokens as number) < 0
		) {
			return undefined;
		}
		return parsed as unknown as EvolutionBudgetState;
	};
	let state: EvolutionBudgetState | undefined;
	try {
		state = read();
	} catch {
		state = undefined;
	}
	if (!state) {
		// The reported numbers are placeholders, not usage. A reader that cannot parse the ledger
		// must not print a confident zero, which is indistinguishable from "nothing spent today".
		return { state: { schemaVersion: 1, day: utcDay(now), calls: Number.MAX_SAFE_INTEGER, estimatedTokens: Number.MAX_SAFE_INTEGER }, corrupt: true };
	}
	// A new UTC day starts the allowance over, so a ledger left over from yesterday cannot silence
	// the extension forever.
	return { state: state.day === utcDay(now) ? state : freshState(now), corrupt: false };
}

function saveState(path: string, state: EvolutionBudgetState): void {
	// A unique temporary name, not a fixed ".tmp". A fixed name means two processes write the same
	// scratch file and one of them renames the other's half-written ledger into place.
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, path);
	} catch (error) {
		try {
			unlinkSync(temporary);
		} catch {
			// Nothing to clean up.
		}
		throw error;
	}
}

/** Moves a corrupt ledger aside, keeping it as the only evidence of what happened. */
function quarantineCorruptLedger(path: string): void {
	try {
		renameSync(path, `${path}.corrupt-${createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12)}`);
	} catch {
		// Already gone or unreadable; the day is treated as spent either way.
	}
}

/**
 * An exclusive lock around the read-modify-write, so the cap is a cap across processes and not
 * just within one.
 *
 * `open(..., "wx")` is the primitive: it creates the file or fails, atomically, which is the one
 * filesystem operation the platform already guarantees is exclusive. The lock carries a staleness
 * window because a process that dies inside the critical section would otherwise wedge the budget
 * permanently — a cap that can be deadlocked away by one crash is not a cap.
 *
 * The wait is synchronous because the reservation has to be atomic with respect to the caller's
 * next `await`, which means it cannot be an async function. `Atomics.wait` on a scratch buffer is
 * the only synchronous sleep available, and the alternative — a busy spin — would burn a core in
 * exactly the situation where a process is already struggling.
 */
const LOCK_STALE_MS = 5_000;
const LOCK_ATTEMPTS = 60;
const LOCK_BACKOFF_MS = 20;

/** Enough of a file's identity to tell "the same lock" from "someone replaced it". */
export interface LockIdentity {
	dev: number;
	ino: number;
}

function identityOf(path: string): LockIdentity {
	const stats = statSync(path);
	return { dev: stats.dev, ino: stats.ino };
}

/**
 * Two observations of the same lock file, not of the same lock.
 *
 * A path is not an identity. Once a stale lock is broken, the file at that path is a different
 * file belonging to a different owner, and anything still holding a reference to the old one must
 * not act on the new one. This is the whole reason both the release and the break check the file
 * they are about rather than the path they once used.
 */
export function sameLockIdentity(a: LockIdentity, b: LockIdentity): boolean {
	return a.dev === b.dev && a.ino === b.ino;
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockContention(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}

/**
 * Whether the process that wrote this lock is still running on this host.
 *
 * Age is not proof of death. A process that is stopped, a host that is suspended, or a filesystem
 * that stalled can all leave a lock looking arbitrarily old while its owner is alive and about to
 * resume. Breaking such a lock hands two processes the right to charge the same headroom, and the
 * owner — unaware it had been dispossessed — then releases the lock its replacement now holds.
 *
 * So liveness is asked, not inferred. `EPERM` means the process exists and we may not signal it,
 * which is a live owner. Anything else that is not `ESRCH` is treated as live too, because the
 * conservative failure of a budget is a visible refusal, not an overspend.
 */
export function lockOwnerIsAlive(lockPath: string): boolean {
	let raw: string;
	try {
		raw = readFileSync(lockPath, "utf8");
	} catch {
		// Unreadable: no owner we can vouch for, so age is all we have.
		return false;
	}
	let pid: unknown;
	try {
		pid = (JSON.parse(raw) as { pid?: unknown }).pid;
	} catch {
		return false;
	}
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException)?.code === "EPERM";
	}
}

/**
 * Removes the lock only if the file at the path is still the one we looked at.
 *
 * Exported because this is the rule that stops a displaced owner from deleting its replacement's
 * lock, and an untested guard on a concurrency path is a comment rather than a guarantee. Callers
 * pass the identity they observed; if the path now holds a different file, nothing is removed.
 */
export function unlinkIfSameLock(lockPath: string, observed: LockIdentity): void {
	try {
		if (sameLockIdentity(identityOf(lockPath), observed)) unlinkSync(lockPath);
	} catch {
		// Already gone, or replaced between the check and now. Either way it is not ours to remove.
	}
}

/**
 * Runs `run` holding the lock, or reports that the lock could not be taken.
 *
 * A lock is only broken when its owner is demonstrably gone. A lock whose owner is alive is waited
 * on, and waiting past the attempts becomes a stated refusal — a live-but-stalled owner costs one
 * refused reservation, which is recoverable, where breaking its lock costs an unenforced cap.
 *
 * Exhausting the attempts is reported rather than proceeded through: proceeding unlocked is the
 * exact race this exists to remove, and a budget that is occasionally unenforced is worse than one
 * that occasionally refuses, because the refusal is visible and the unenforced call is not.
 */
function withBudgetLock<T>(path: string, now: Date, run: () => T): { ok: true; value: T } | { ok: false; reason: "lock_unavailable" } {
	const lockPath = `${path}.lock`;
	for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
		let handle: number | undefined;
		try {
			handle = openSync(lockPath, "wx", 0o600);
		} catch (error) {
			if (!lockContention(error)) throw error;
			// One stat, for both the identity and the age. Statting twice leaves a window in which a
			// competing waiter's removal turns ordinary contention into a thrown ENOENT — which is
			// how a queue turns into a crash.
			let observed: LockIdentity;
			let ageMs: number;
			try {
				const stats = statSync(lockPath);
				observed = { dev: stats.dev, ino: stats.ino };
				ageMs = now.getTime() - stats.mtimeMs;
			} catch {
				// Vanished between the failed open and here; retry immediately.
				continue;
			}
			if (ageMs > LOCK_STALE_MS && !lockOwnerIsAlive(lockPath)) {
				// Only the file we judged, and only while it is still that file: two waiters can
				// observe the same stale lock, and the loser must not remove the winner's new one.
				unlinkIfSameLock(lockPath, observed);
			}
			sleepSync(LOCK_BACKOFF_MS);
			continue;
		}
		let ours: LockIdentity;
		try {
			ours = identityOf(lockPath);
			writeFileSync(handle, `${JSON.stringify({ pid: process.pid, acquiredAt: now.toISOString() })}\n`, { encoding: "utf8" });
		} catch (error) {
			try {
				unlinkSync(lockPath);
			} catch {
				// Nothing to clean up.
			}
			throw error;
		}
		try {
			return { ok: true, value: run() };
		} finally {
			try {
				closeSync(handle);
			} catch {
				// Already closed; the identity check below is what matters.
			}
			// Our lock, or the one that replaced it after somebody decided we were dead. Removing
			// the latter would hand a third party a window with no lock at all.
			unlinkIfSameLock(lockPath, ours);
		}
	}
	return { ok: false, reason: "lock_unavailable" };
}

/**
 * Reserves one model call, or refuses.
 *
 * Synchronous on purpose: within one process the read and the charge cannot be separated by an
 * await, so two concurrent refinements cannot both see the same headroom.
 *
 * Across processes it is not safe, and the earlier version of this comment claimed otherwise. The
 * read-modify-write here has no mutual exclusion, so N processes racing on the same agent directory
 * can each observe the same count and each charge, overshooting by up to N - 1 rather than by one.
 * That is a real gap and it is not fixed here: it needs serialized or atomic reservation, which is
 * separate work. Until then this is a *per-process* cap that is advisory between processes, and the
 * number of concurrent Catui processes sharing an agent directory is assumed to be one.
 */
export function reserveEvolutionModelCall(
	agentDir: string,
	policy: Readonly<EvolutionBudgetPolicy> = DEFAULT_EVOLUTION_BUDGET,
	now: Date = new Date(),
): BudgetReservation {
	const path = budgetPath(agentDir);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const locked = withBudgetLock(path, now, () => settleReservation(path, policy, now));
	if (!locked.ok) {
		return {
			reserved: false,
			reason: "budget_locked",
			day: utcDay(now),
			calls: 0,
			message: `Evolution budget ledger is held by another process; no model call was made. Try again once it clears.`,
		};
	}
	return locked.value;
}

/** The whole read-decide-write sequence, which only ever runs while the lock is held. */
function settleReservation(
	path: string,
	policy: Readonly<EvolutionBudgetPolicy>,
	now: Date,
): BudgetReservation {
	const { state, corrupt } = peekState(path, now);
	if (corrupt) {
		// The repair lives here rather than in the reader, and the exhausted ledger is written back
		// rather than only the bad file moved aside: with nothing at the ledger path, the very next
		// call would find no file and be handed a fresh allowance, and the suppression would last
		// exactly one attempt.
		quarantineCorruptLedger(path);
		saveState(path, { schemaVersion: 1, day: state.day, calls: Number.MAX_SAFE_INTEGER, estimatedTokens: Number.MAX_SAFE_INTEGER });
		return {
			reserved: false,
			reason: "budget_exhausted",
			day: state.day,
			calls: 0,
			message: `Evolution budget ledger was unreadable and has been set aside; the ${state.day} allowance is treated as spent. No model call was made.`,
		};
	}
	const nextCalls = state.calls + 1;
	const nextTokens = state.estimatedTokens + policy.estimatedTokensPerCall;
	const overCalls = nextCalls > policy.dailyCallBudget;
	const overTokens = nextTokens > policy.dailyEstimatedTokenBudget;

	if (overCalls || overTokens) {
		return {
			reserved: false,
			reason: "budget_exhausted",
			day: state.day,
			calls: state.calls,
			message: overCalls
				? `Evolution model-call budget exhausted for ${state.day}: ${state.calls} of ${policy.dailyCallBudget} calls used. No model call was made.`
				: `Evolution estimated-token budget exhausted for ${state.day}: ${state.estimatedTokens} of ${policy.dailyEstimatedTokenBudget} estimated tokens reserved. No model call was made.`,
		};
	}

	const reserved: EvolutionBudgetState = { schemaVersion: 1, day: state.day, calls: nextCalls, estimatedTokens: nextTokens };
	saveState(path, reserved);
	return { reserved: true, day: reserved.day, calls: nextCalls, remainingCalls: policy.dailyCallBudget - nextCalls };
}

export interface EvolutionBudgetReport {
	day: string;
	/** null when the ledger is unreadable. Never a fabricated zero. */
	calls: number | null;
	estimatedTokens: number | null;
	corrupt: boolean;
	file: string;
}

/**
 * A view for reporting, and nothing else: it reserves nothing and touches no file.
 *
 * `corrupt` is reported as its own field and the usage fields become null, because a reader that
 * cannot parse the ledger must not present "0 calls used" as fact. That number is what a
 * corruption-blocked budget looks like, and a status display that prints it is indistinguishable
 * from a fresh allowance.
 */
export function readEvolutionBudget(agentDir: string, now: Date = new Date()): EvolutionBudgetReport {
	const path = budgetPath(agentDir);
	const { state, corrupt } = peekState(path, now);
	return {
		day: state.day,
		calls: corrupt ? null : state.calls,
		estimatedTokens: corrupt ? null : state.estimatedTokens,
		corrupt,
		file: path,
	};
}
