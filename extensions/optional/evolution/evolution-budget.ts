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

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
 * Reads the ledger, reporting corruption rather than guessing at it.
 *
 * A truncated or corrupt file must not be read as "nothing spent yet": that is the reading which
 * hands a runaway loop a fresh allowance every time it corrupts the file. It is also not read as
 * spent, which would be a permanent block on a machine nobody can diagnose. The corrupt file is kept
 * aside and the day is treated as exhausted, which fails closed for today and heals at the UTC
 * boundary like any other allowance.
 */
function loadState(path: string, now: Date): { state: EvolutionBudgetState; corrupt: boolean } {
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
		// Kept, not deleted: this is the only evidence of what happened to the file.
		try {
			renameSync(path, `${path}.corrupt-${createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12)}`);
		} catch {
			// Already gone or unreadable; the day is exhausted either way.
		}
		return { state: { schemaVersion: 1, day: utcDay(now), calls: Number.MAX_SAFE_INTEGER, estimatedTokens: Number.MAX_SAFE_INTEGER }, corrupt: true };
	}
	// A new UTC day starts the allowance over, so a ledger left over from yesterday cannot silence
	// the extension forever.
	return { state: state.day === utcDay(now) ? state : freshState(now), corrupt: false };
}

function saveState(path: string, state: EvolutionBudgetState): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, path);
}

/**
 * Reserves one model call, or refuses.
 *
 * Synchronous on purpose: the reservation has to land before the caller's next await, or two
 * concurrent refinements could both read the same headroom. It does not make the limit exact across
 * *processes* sharing an agent directory — a benign race that can overshoot by one call — and that is
 * stated rather than papered over with a lock file that would outlive the problem.
 */
export function reserveEvolutionModelCall(
	agentDir: string,
	policy: Readonly<EvolutionBudgetPolicy> = DEFAULT_EVOLUTION_BUDGET,
	now: Date = new Date(),
): BudgetReservation {
	const path = budgetPath(agentDir);
	const { state, corrupt } = loadState(path, now);
	if (corrupt) {
		// The corrupt file has been moved aside, so nothing is left at the ledger path. Without
		// writing an exhausted ledger back, the very next call would find no file at all and be
		// handed a fresh allowance — the suppression would last exactly one attempt.
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

/** Read-only view for reporting; never reserves, so it cannot spend. */
export function readEvolutionBudget(
	agentDir: string,
	now: Date = new Date(),
): { day: string; calls: number; estimatedTokens: number; file: string } {
	const path = budgetPath(agentDir);
	const { state, corrupt } = loadState(path, now);
	return { day: state.day, calls: corrupt ? 0 : state.calls, estimatedTokens: corrupt ? 0 : state.estimatedTokens, file: path };
}
