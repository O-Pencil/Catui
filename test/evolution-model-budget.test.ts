/**
 * [WHO]: Proves the extension's only model call is reserved before it happens, and refused at zero cost
 * [FROM]: Depends on node:test/assert/fs/os/path, the real refiner, and the real budget ledger
 * [TO]: Consumed by test:evolution-boundaries; covers S10.4 so an exhausted budget means no model call
 * [HERE]: test/evolution-model-budget.test.ts - S10.4 reserve-before-call coverage
 *
 * "Check then charge" looks equivalent to "reserve" until two callers arrive in the same tick, both
 * read a ledger that still has room, and the cap is exceeded by exactly what it was meant to
 * prevent. These tests assert the ordering directly: a refused reservation must leave the completion
 * function untouched, and the call count it records must be zero.
 *
 * The ledger lives under the existing evolution root with no daemon and no timer, so it is only ever
 * consulted where a call is about to happen. The turn-end observer needs no budget at all, and a test
 * says so rather than leaving it as an assumption.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_EVOLUTION_BUDGET,
	readEvolutionBudget,
	reserveEvolutionModelCall,
} from "../extensions/optional/evolution/evolution-budget.js";
import { planEvolutionCandidate } from "../extensions/optional/evolution/evolution-refiner.js";
import { EvolutionAutoObserver } from "../extensions/optional/evolution/evolution-auto.js";
import type { ExtensionCommandContext } from "../core/extensions-host/types.js";

const SESSION_ID = "budget-test";

interface Space {
	agentDir: string;
	cwd: string;
	dispose: () => void;
}

function space(): Space {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-budget-"));
	return {
		agentDir: join(root, "agent"),
		cwd: join(root, "work"),
		dispose: () => rmSync(root, { recursive: true, force: true }),
	};
}

function budgetFile(agentDir: string): string {
	return join(agentDir, "evolution", "v1", "budget.json");
}

function context(agentDir: string, cwd: string, counters: { modelCalls: number }, response = "{}"): ExtensionCommandContext {
	return {
		agentDir,
		cwd,
		sessionManager: { getSessionId: () => SESSION_ID, getEntries: () => [] },
		completeSimple: async () => {
			counters.modelCalls += 1;
			return response;
		},
	} as unknown as ExtensionCommandContext;
}

const GOOD_RESPONSE = JSON.stringify({
	summary: "s",
	rationale: "r",
	expectedOutcome: "e",
	artifacts: [],
});

test("a reservation is written before the call and the call happens once", async () => {
	const s = space();
	try {
		const counters = { modelCalls: 0 };
		const result = reserveEvolutionModelCall(s.agentDir, DEFAULT_EVOLUTION_BUDGET, new Date("2026-08-25T00:00:00.000Z"));
		assert.equal(result.reserved, true);
		if (result.reserved) assert.equal(result.calls, 1);

		// The ledger exists on disk before anything could have called a model, which is the whole
		// ordering claim: the cap is spent first, not reported afterwards.
		assert.equal(existsSync(budgetFile(s.agentDir)), true);
		assert.equal(readEvolutionBudget(s.agentDir, new Date("2026-08-25T00:00:00.000Z")).calls, 1);

		// The refiner reserves against the real clock, so it opens its own day rather than joining the
		// one seeded above. Reading without a fixed date is what keeps the two comparable.
		await planEvolutionCandidate(context(s.agentDir, s.cwd, counters, GOOD_RESPONSE), "session", "refine").catch(() => undefined);
		assert.equal(counters.modelCalls, 1, "a reserved call still makes its call");
		assert.equal(readEvolutionBudget(s.agentDir).calls, 1);
	} finally {
		s.dispose();
	}
});

test("an exhausted budget makes zero model calls and says why", async () => {
	const s = space();
	try {
		// Filled against the real clock, because the refiner reserves against the real clock too;
		// seeding a different UTC day would be a fresh allowance and prove nothing.
		for (let i = 0; i < DEFAULT_EVOLUTION_BUDGET.dailyCallBudget; i += 1) {
			assert.equal(reserveEvolutionModelCall(s.agentDir).reserved, true, `call ${i + 1} should be reserved`);
		}

		const counters = { modelCalls: 0 };
		await assert.rejects(
			() => planEvolutionCandidate(context(s.agentDir, s.cwd, counters, GOOD_RESPONSE), "session", "refine"),
			/budget exhausted for \d{4}-\d{2}-\d{2}: .* No model call was made/,
		);
		assert.equal(counters.modelCalls, 0, "the completion function must not be reached at all");
	} finally {
		s.dispose();
	}
});

test("an exhausted token estimate refuses even when the call cap has room", () => {
	// Two independent caps, so a policy that only honours one of them is caught. Pinned at the
	// ledger level, because the refiner always uses the default policy and cannot be given a tighter
	// one from the outside.
	const s = space();
	try {
		const day = new Date("2026-08-25T00:00:00.000Z");
		const policy = { ...DEFAULT_EVOLUTION_BUDGET, dailyCallBudget: 100, dailyEstimatedTokenBudget: 8_000, estimatedTokensPerCall: 8_000 };
		assert.equal(reserveEvolutionModelCall(s.agentDir, policy, day).reserved, true);

		const refused = reserveEvolutionModelCall(s.agentDir, policy, day);
		assert.equal(refused.reserved, false);
		if (!refused.reserved) {
			assert.equal(refused.reason, "budget_exhausted");
			assert.match(refused.message, /estimated-token budget exhausted/);
			assert.match(refused.message, /No model call was made/);
			assert.equal(refused.calls, 1, "the refusal reports usage without changing it");
		}
		assert.equal(readEvolutionBudget(s.agentDir, day).calls, 1, "a refusal is not a charge");
	} finally {
		s.dispose();
	}
});

test("the last reservation cannot be spent twice", () => {
	// The ordering the whole design exists for, at the level it lives. `reserveEvolutionModelCall` is
	// synchronous precisely so two refinements cannot both read a ledger that still has room between
	// the read and the charge; this pins the property that buys rather than staging a race it makes
	// impossible. The refiner-level consequence — one call, one model hit — is covered above.
	const s = space();
	try {
		const policy = { ...DEFAULT_EVOLUTION_BUDGET, dailyCallBudget: 1, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 };
		const first = reserveEvolutionModelCall(s.agentDir, policy);
		const second = reserveEvolutionModelCall(s.agentDir, policy);

		assert.equal(first.reserved, true);
		assert.equal(second.reserved, false, "the second caller must be refused, not both allowed");
		if (first.reserved) assert.equal(first.remainingCalls, 0);
		assert.equal(readEvolutionBudget(s.agentDir).calls, 1, "and the refusal did not move the count");
	} finally {
		s.dispose();
	}
});

test("two refinements in flight cannot both pass the last reservation", async () => {
	// The refiner-level version, and the one that actually discriminates. `planEvolutionCandidate`
	// awaits the completion between any check and any charge, so a check-then-charge implementation
	// would let both of these see headroom and both spend. Reserving first means one is refused and
	// the ledger never exceeds its cap.
	const s = space();
	try {
		for (let i = 0; i < DEFAULT_EVOLUTION_BUDGET.dailyCallBudget - 1; i += 1) reserveEvolutionModelCall(s.agentDir);
		assert.equal(readEvolutionBudget(s.agentDir).calls, DEFAULT_EVOLUTION_BUDGET.dailyCallBudget - 1);

		const counters = { modelCalls: 0 };
		const ctx = context(s.agentDir, s.cwd, counters, GOOD_RESPONSE);
		const attempts = await Promise.allSettled([
			planEvolutionCandidate(ctx, "session", "refine"),
			planEvolutionCandidate(ctx, "session", "refine"),
		]);

		assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1, "exactly one reservation survives");
		assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
		assert.equal(counters.modelCalls, 1, "and exactly one model call was paid for");
		assert.equal(
			readEvolutionBudget(s.agentDir).calls,
			DEFAULT_EVOLUTION_BUDGET.dailyCallBudget,
			"the ledger must not exceed its cap",
		);
	} finally {
		s.dispose();
	}
});

test("the default cap stops a run of refinements with no further model call", async () => {
	// The end-to-end shape: spend the real default allowance, then confirm the next refinement is
	// refused before it reaches the model rather than complaining after it has been paid for.
	const s = space();
	try {
		const counters = { modelCalls: 0 };
		const ctx = context(s.agentDir, s.cwd, counters, GOOD_RESPONSE);
		for (let i = 0; i < DEFAULT_EVOLUTION_BUDGET.dailyCallBudget; i += 1) {
			await planEvolutionCandidate(ctx, "session", "refine");
		}
		assert.equal(counters.modelCalls, DEFAULT_EVOLUTION_BUDGET.dailyCallBudget);

		await assert.rejects(() => planEvolutionCandidate(ctx, "session", "refine"), /budget exhausted/);
		assert.equal(counters.modelCalls, DEFAULT_EVOLUTION_BUDGET.dailyCallBudget, "the refused one added no call");
	} finally {
		s.dispose();
	}
});

test("the two default caps agree, so neither is silently unreachable", () => {
	const budget = DEFAULT_EVOLUTION_BUDGET;
	assert.equal(
		budget.dailyCallBudget * budget.estimatedTokensPerCall,
		budget.dailyEstimatedTokenBudget,
		"the call cap and the token cap must describe the same allowance, or one of them is a lie",
	);
});

test("a new UTC day starts the allowance over", async () => {
	const s = space();
	try {
		const policy = { ...DEFAULT_EVOLUTION_BUDGET, dailyCallBudget: 1, dailyEstimatedTokenBudget: 1_000_000, estimatedTokensPerCall: 1 };
		assert.equal(reserveEvolutionModelCall(s.agentDir, policy, new Date("2026-08-25T23:59:00.000Z")).reserved, true);
		assert.equal(reserveEvolutionModelCall(s.agentDir, policy, new Date("2026-08-25T23:59:30.000Z")).reserved, false);

		const nextDay = reserveEvolutionModelCall(s.agentDir, policy, new Date("2026-08-26T00:01:00.000Z"));
		assert.equal(nextDay.reserved, true, "a ledger left over from yesterday must not silence the extension");
		if (nextDay.reserved) assert.equal(nextDay.day, "2026-08-26");
	} finally {
		s.dispose();
	}
});

test("an unreadable ledger fails closed for the day and is kept aside", () => {
	// Reading a corrupt file as "nothing spent yet" hands a runaway loop a fresh allowance every
	// time it corrupts the file. Reading it as fully spent forever would be a permanent block nobody
	// could diagnose, so the file is preserved and the day is treated as spent — which heals at the
	// UTC boundary like any other allowance.
	const s = space();
	try {
		mkdirSync(join(s.agentDir, "evolution", "v1"), { recursive: true, mode: 0o700 });
		writeFileSync(budgetFile(s.agentDir), "{ this is not json", "utf8");

		const day = new Date("2026-08-25T00:00:00.000Z");
		const refused = reserveEvolutionModelCall(s.agentDir, DEFAULT_EVOLUTION_BUDGET, day);
		assert.equal(refused.reserved, false, "a corrupt ledger must not authorize a call");
		if (!refused.reserved) {
			assert.match(refused.message, /ledger was unreadable and has been set aside/);
			assert.match(refused.message, /No model call was made/);
			assert.equal(refused.calls, 0, "and it does not invent a usage figure");
		}

		// The evidence is kept, under a name that says what happened.
		const kept = readdirSync(join(s.agentDir, "evolution", "v1"));
		assert.ok(kept.some((name) => /^budget\.json\.corrupt-/.test(name)), `expected a quarantined copy, found ${kept.join(", ")}`);
		const quarantined = kept.find((name) => /^budget\.json\.corrupt-/.test(name))!;
		assert.equal(
			readFileSync(join(s.agentDir, "evolution", "v1", quarantined), "utf8"),
			"{ this is not json",
			"the corrupt content is preserved as the only evidence of what happened",
		);

		// The suppression has to outlive the first attempt. The corrupt file was moved aside, so a
		// ledger has to be written back — otherwise the next call finds no file and is handed a
		// fresh allowance, making the fail-closed window exactly one call long.
		assert.equal(reserveEvolutionModelCall(s.agentDir, DEFAULT_EVOLUTION_BUDGET, day).reserved, false, "still refused on the second attempt");
		assert.equal(existsSync(budgetFile(s.agentDir)), true, "an exhausted ledger is written back");

		// And the next day starts clean, so this is a day's suppression rather than a block.
		assert.equal(reserveEvolutionModelCall(s.agentDir, DEFAULT_EVOLUTION_BUDGET, new Date("2026-08-26T00:01:00.000Z")).reserved, true);
	} finally {
		s.dispose();
	}
});

test("reporting leaves the filesystem untouched and never repairs anything", () => {
	// Regression from supervisor review. `readEvolutionBudget` shared the load path with the
	// reservation, which quarantined a corrupt ledger on the way past. Asking about the budget then
	// deleted the very file the next reservation needed, so reading *cleared* a corruption block it
	// had not created, and the next call was handed a fresh allowance.
	const s = space();
	try {
		mkdirSync(join(s.agentDir, "evolution", "v1"), { recursive: true, mode: 0o700 });
		const corrupt = "{ this is not json";
		writeFileSync(budgetFile(s.agentDir), corrupt, "utf8");

		for (let i = 0; i < 3; i += 1) {
			const report = readEvolutionBudget(s.agentDir);
			assert.equal(report.corrupt, true, "corruption is reported as its own fact");
			assert.equal(report.calls, null, "and never as a confident zero");
			assert.equal(report.estimatedTokens, null);
			assert.deepEqual(readdirSync(join(s.agentDir, "evolution", "v1")), ["budget.json"], "reporting moves nothing aside");
			assert.equal(readFileSync(budgetFile(s.agentDir), "utf8"), corrupt, "and rewrites nothing");
		}

		// The block still holds after any number of reads.
		const refused = reserveEvolutionModelCall(s.agentDir);
		assert.equal(refused.reserved, false, "reading the budget must not clear the block it found");
		assert.equal(reserveEvolutionModelCall(s.agentDir).reserved, false, "and the refusal outlives the first attempt");
	} finally {
		s.dispose();
	}
});

test("reporting a healthy ledger reports real usage and changes nothing", async () => {
	const s = space();
	try {
		reserveEvolutionModelCall(s.agentDir);
		const before = readFileSync(budgetFile(s.agentDir), "utf8");

		const report = readEvolutionBudget(s.agentDir);
		assert.equal(report.corrupt, false);
		assert.equal(report.calls, 1);
		assert.equal(readFileSync(budgetFile(s.agentDir), "utf8"), before, "a report is not a write");
	} finally {
		s.dispose();
	}
});

test("the ledger is private, under the existing evolution root, with no daemon or timer", async () => {
	const s = space();
	try {
		reserveEvolutionModelCall(s.agentDir, DEFAULT_EVOLUTION_BUDGET, new Date("2026-08-25T00:00:00.000Z"));
		const file = budgetFile(s.agentDir);
		assert.equal(existsSync(file), true);
		assert.ok(file.startsWith(join(s.agentDir, "evolution", "v1")), "the ledger belongs to the existing evolution root");
		assert.equal(existsSync(join(s.agentDir, "evolution", "v1", "budget.json.tmp")), false, "the temporary file must not survive");

		assert.equal(statSync(file).mode & 0o777, 0o600, "usage data is owner-only, like the rest of the store");
		const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		assert.deepEqual(Object.keys(written).sort(), ["calls", "day", "estimatedTokens", "schemaVersion"]);
	} finally {
		s.dispose();
	}
});

test("reading the budget cannot spend it", async () => {
	const s = space();
	try {
		const day = new Date("2026-08-25T00:00:00.000Z");
		reserveEvolutionModelCall(s.agentDir, DEFAULT_EVOLUTION_BUDGET, day);
		for (let i = 0; i < 5; i += 1) readEvolutionBudget(s.agentDir, day);
		assert.equal(readEvolutionBudget(s.agentDir, day).calls, 1);
	} finally {
		s.dispose();
	}
});

test("a failed call still consumes its reservation", async () => {
	// Attempts are counted, not successes. Whether a failed completion billed anything is not
	// knowable from here, and under-counting is what lets a loop run up a bill.
	const s = space();
	try {
		const counters = { modelCalls: 0 };
		const ctx = {
			agentDir: s.agentDir,
			cwd: s.cwd,
			sessionManager: { getSessionId: () => SESSION_ID, getEntries: () => [] },
			completeSimple: async () => {
				counters.modelCalls += 1;
				throw new Error("upstream refused");
			},
		} as unknown as ExtensionCommandContext;

		await assert.rejects(() => planEvolutionCandidate(ctx, "session", "refine"), /upstream refused/);
		assert.equal(counters.modelCalls, 1);
		assert.equal(readEvolutionBudget(s.agentDir).calls, 1, "the reservation is not returned after a failure");
	} finally {
		s.dispose();
	}
});

test("the turn-end observer needs no budget, because it makes no model call", async () => {
	// Last round established the observer is inert by default. This pins the other half: spending
	// nothing means needing no allowance, so a budget check there would be pure overhead.
	const s = space();
	try {
		const counters = { modelCalls: 0 };
		const ctx = {
			agentDir: s.agentDir,
			cwd: s.cwd,
			sessionManager: { getSessionId: () => SESSION_ID, getEntries: () => [] },
			completeSimple: async () => {
				counters.modelCalls += 1;
				return "{}";
			},
		} as unknown as ExtensionCommandContext;
		const observer = new EvolutionAutoObserver({ runGate: async () => ({ name: "g", passed: false, checkedAt: "2026-08-25T00:00:00.000Z", metrics: { passRate: 0, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 } }) });

		for (let turnIndex = 1; turnIndex <= 30; turnIndex += 1) {
			await observer.observeTurnEnd({ type: "turn_end", turnIndex, message: { content: "Reusable lesson: keep the change small." } } as never, ctx);
		}

		assert.equal(counters.modelCalls, 0, "thirty lesson turns cost nothing");
		assert.equal(existsSync(budgetFile(s.agentDir)), false, "and never touched the ledger");
	} finally {
		s.dispose();
	}
});


