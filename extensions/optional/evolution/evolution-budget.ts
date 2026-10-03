/**
 * [WHO]: Daily reservation ledger for the extension's only model call, refused before the call is made
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
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
	| { reserved: false; reason: "budget_exhausted"; day: string; calls: number; message: string };

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
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
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
