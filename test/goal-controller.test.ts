import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GoalController } from "../extensions/builtin/goal/goal-controller.js";
import { GoalStore } from "../extensions/builtin/goal/goal-store.js";
import { parseGoalCommand } from "../extensions/builtin/goal/goal-parser.js";
import {
	formatGoalElapsedSeconds,
	formatTokens,
	goalStatusIndicator,
	goalSummaryLines,
	shouldConfirmBeforeReplacing,
	validateBudget,
	validateObjective,
} from "../extensions/builtin/goal/goal-format.js";

function createTempAgentDir(): string {
	return mkdtempSync(join(tmpdir(), "nanopencil-goal-"));
}

function fakeApi(agentDir: string): any {
	return {
		cwd: agentDir,
		agentDir,
		events: {},
		sendUserMessage: () => {},
		sendMessage: () => {},
		appendEntry: () => {},
	};
}

function makeController(agentDir: string): GoalController {
	const api = fakeApi(agentDir);
	const controller = new GoalController(api, "thread-test");
	(controller as any).api = api;
	return controller;
}

test("GoalStore: replace / get / delete lifecycle", async () => {
	const agentDir = createTempAgentDir();
	try {
		const store = new GoalStore(agentDir, "thread-1");
		assert.equal(store.get_goal(), null);

		const goal = store.replace_goal("Ship feature X", "active", 1000);
		assert.equal(goal.objective, "Ship feature X");
		assert.equal(goal.status, "active");
		assert.equal(goal.token_budget, 1000);
		assert.equal(goal.tokens_used, 0);

		const fetched = store.get_goal();
		assert.ok(fetched);
		assert.equal(fetched?.objective, "Ship feature X");
		assert.equal(fetched?.goal_id, goal.goal_id);

		const deleted = store.delete_goal();
		assert.equal(deleted, true);
		assert.equal(store.get_goal(), null);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("GoalStore: insert blocks when an unfinished goal exists", async () => {
	const agentDir = createTempAgentDir();
	try {
		const store = new GoalStore(agentDir, "thread-2");
		const first = store.insert_goal("First", "active", null);
		assert.ok(first);
		const second = store.insert_goal("Second", "active", null);
		assert.equal(second, null);
		const complete = store.replace_goal("Done", "complete", null);
		assert.equal(complete.status, "complete");
		const replaced = store.insert_goal("Third", "active", null);
		assert.ok(replaced);
		assert.equal(replaced?.objective, "Third");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("GoalStore: account_usage accumulates and auto-downgrades on budget", async () => {
	const agentDir = createTempAgentDir();
	try {
		const store = new GoalStore(agentDir, "thread-3");
		store.replace_goal("Build", "active", 100);
		const first = store.account_usage(2, 60, "ActiveStatusOnly");
		assert.equal(first.kind, "Updated");
		assert.equal(first.kind === "Updated" ? first.goal.tokens_used : -1, 60);
		assert.equal(first.kind === "Updated" ? first.goal.status : "", "active");

		const second = store.account_usage(1, 50, "ActiveStatusOnly");
		assert.equal(second.kind, "Updated");
		assert.equal(second.kind === "Updated" ? second.goal.status : "", "budget_limited");
		assert.equal(second.kind === "Updated" ? second.goal.tokens_used : -1, 110);

		const third = store.account_usage(0, 1, "ActiveStatusOnly");
		assert.equal(third.kind, "Unchanged");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("GoalStore: account_usage respects status filter per mode", async () => {
	const agentDir = createTempAgentDir();
	try {
		const store = new GoalStore(agentDir, "thread-4");
		store.replace_goal("Paused goal", "paused", null);
		const res = store.account_usage(1, 10, "ActiveOnly");
		assert.equal(res.kind, "Unchanged");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("GoalStore: update preserves budget_limited against non-resume mutations", async () => {
	const agentDir = createTempAgentDir();
	try {
		const store = new GoalStore(agentDir, "thread-5");
		store.replace_goal("X", "active", 10);
		store.account_usage(0, 10, "ActiveStatusOnly");
		const fetched = store.get_goal();
		assert.equal(fetched?.status, "budget_limited");
		const tried = store.update_goal({ status: "paused" });
		assert.equal(tried?.status, "budget_limited");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("GoalStore: optimistic lock with expectedGoalId", async () => {
	const agentDir = createTempAgentDir();
	try {
		const store = new GoalStore(agentDir, "thread-6");
		const created = store.replace_goal("Y", "active", null);
		const updated = store.update_goal({ status: "paused", expectedGoalId: created.goal_id });
		assert.equal(updated?.status, "paused");
		const blocked = store.update_goal({ status: "active", expectedGoalId: "wrong-id" });
		assert.equal(blocked?.status, "paused");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("GoalController: set_objective with ConfirmIfExists escalates when active exists", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("First", "ConfirmIfExists", { tokenBudget: 100 });
		const second = await controller.set_objective("Second", "ConfirmIfExists", { tokenBudget: 200 });
		assert.equal(second.kind, "confirm_required");
		const replaced = await controller.set_objective("Second", "ReplaceExisting", { tokenBudget: 200 });
		assert.equal(replaced.kind, "ok");
		assert.equal(replaced.goal?.objective, "Second");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("GoalController: pause / resume lifecycle", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Goal A", "ConfirmIfExists");
		const paused = await controller.set_status("paused");
		assert.equal(paused?.status, "paused");
		const resumed = await controller.set_status("active");
		assert.equal(resumed?.status, "active");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("GoalController: clear removes persisted goal and bookkeeping state", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Goal X", "ConfirmIfExists");
		controller.on_turn_start("turn-1", "normal", 0);
		const cleared = await controller.clear();
		assert.equal(cleared, true);
		assert.equal(await controller.get_goal(), null);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("GoalController: blocked signal escalates only after 3 consecutive turns", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Blockable", "ConfirmIfExists");

		const first = controller.record_blocked_signal();
		assert.equal(first.escalated, false);
		assert.equal(first.consecutiveBlocked, 1);

		const second = controller.record_blocked_signal();
		assert.equal(second.escalated, false);
		assert.equal(second.consecutiveBlocked, 2);

		const third = controller.record_blocked_signal();
		assert.equal(third.escalated, true);
		assert.equal(third.consecutiveBlocked, 3);

		const goal = await controller.get_goal();
		assert.equal(goal?.status, "blocked");

		controller.reset_blocked_signal();
		assert.equal(controller.currentState.consecutiveBlocked, 0);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("GoalController: token usage accrues via on_token_usage and budget crosses", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Token goal", "ConfirmIfExists", { tokenBudget: 50 });
		controller.on_turn_start("turn-1", "normal", 0);
		controller.on_token_usage(30);
		controller.on_token_usage(60);
		const goal = await controller.get_goal();
		assert.equal(goal?.status, "budget_limited");
		assert.equal(goal?.tokens_used, 60);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("Parser: parse /goal subcommands", () => {
	assert.equal(parseGoalCommand("").type, "help");
	assert.equal(parseGoalCommand("clear").type, "clear");
	assert.equal(parseGoalCommand("CLEAR").type, "clear");
	assert.equal(parseGoalCommand("edit").type, "edit");
	assert.equal(parseGoalCommand("pause").type, "pause");
	assert.equal(parseGoalCommand("resume").type, "resume");
	assert.equal(parseGoalCommand("Ship feature X").type, "set");
	assert.equal(parseGoalCommand("Ship feature X").type === "set" ? parseGoalCommand("Ship feature X").objective : "", "Ship feature X");
});

test("Format: validateObjective / validateBudget / format helpers", () => {
	const ok = validateObjective("  Hello  ");
	assert.equal(ok.ok, true);
	assert.equal(ok.ok ? ok.value : "", "Hello");

	const empty = validateObjective("   ");
	assert.equal(empty.ok, false);

	const tooLong = validateObjective("x".repeat(5000));
	assert.equal(tooLong.ok, false);

	const goodBudget = validateBudget(100);
	assert.equal(goodBudget.ok, true);
	assert.equal(goodBudget.ok ? goodBudget.value : -1, 100);

	const badBudget = validateBudget(0);
	assert.equal(badBudget.ok, false);

	const noBudget = validateBudget(null);
	assert.equal(noBudget.ok, true);
	assert.equal(noBudget.ok ? noBudget.value : "not-null", null);
});

test("Format: formatGoalElapsedSeconds / formatTokens", () => {
	assert.equal(formatGoalElapsedSeconds(0), "0.0s");
	assert.equal(formatGoalElapsedSeconds(45), "45.0s");
	assert.equal(formatGoalElapsedSeconds(60), "1m");
	assert.equal(formatGoalElapsedSeconds(3600), "1h");
	assert.equal(formatGoalElapsedSeconds(3600 * 25), "1d 1h 0m");
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1_500), "1.5K");
	assert.equal(formatTokens(150_000), "150K");
});

test("Format: shouldConfirmBeforeReplacing + goalSummaryLines + indicator", () => {
	const active = {
		thread_id: "t",
		goal_id: "g",
		objective: "O",
		status: "active" as const,
		token_budget: 100,
		tokens_used: 30,
		time_used_seconds: 90,
		created_at: 0,
		updated_at: 0,
	};
	assert.equal(shouldConfirmBeforeReplacing(active), true);
	const complete = { ...active, status: "complete" as const };
	assert.equal(shouldConfirmBeforeReplacing(complete), false);

	const lines = goalSummaryLines(active);
	assert.ok(lines.some((l) => l.includes("Status: active")));
	assert.ok(lines.some((l) => l.includes("Tokens used")));

	const indicator = goalStatusIndicator(active, null);
	assert.equal(indicator.type, "Active");
});

test("Controller: apply_update_goal with status=complete moves goal to complete", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Done", "ConfirmIfExists");
		controller.on_turn_start("turn-1", "normal", 0);
		controller.on_token_usage(10);
		const updated = await controller.apply_update_goal({ status: "complete" });
		assert.equal(updated?.status, "complete");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("Controller: apply_update_goal returns null when no goal exists", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		const updated = await controller.apply_update_goal({ status: "blocked" });
		assert.equal(updated, null);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("Controller: turn_end does accounting only; dispatch happens at agent_end", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Pull model goal", "ConfirmIfExists");

		controller.on_turn_start("turn-1", "normal", 0);
		controller.on_token_usage(100);
		const turnOutcome = await controller.on_turn_end();
		assert.equal(turnOutcome.reason, "active");
		// Accounting happened, but no continuation was dispatched yet.
		assert.equal((controller as any).totalContinuationTurns, 0);

		const dispatched = controller.maybe_dispatch_continuation({ hasPendingMessages: false });
		assert.equal(dispatched.dispatched, true);
		assert.equal((controller as any).totalContinuationTurns, 1);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("Controller: total continuation limit pauses goal after 30 dispatches", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Long running task", "ConfirmIfExists");

		// Directly set the total continuation counter to just below the limit
		// to avoid fighting with the consecutive counter in the simulation.
		(controller as any).totalContinuationTurns = 29;

		// Simulate an idle point that dispatches the 30th continuation
		controller.on_turn_start("turn-29", "normal", 0);
		controller.on_token_usage(100);
		await controller.on_turn_end();
		const dispatched = controller.maybe_dispatch_continuation({ hasPendingMessages: false });
		assert.equal(dispatched.dispatched, true);
		assert.equal((controller as any).totalContinuationTurns, 30);

		// Next idle point should hit the total limit
		controller.on_turn_start("turn-30", "normal", 0);
		controller.on_token_usage(200);
		await controller.on_turn_end();
		const finalOutcome = controller.maybe_dispatch_continuation({ hasPendingMessages: false });
		assert.equal(finalOutcome.dispatched, false);
		assert.equal(finalOutcome.reason, "total_continuation_limit_reached");

		const goal = await controller.get_goal();
		assert.equal(goal?.status, "paused");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("Controller: dispatch skipped while messages are still queued", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Busy goal", "ConfirmIfExists");

		controller.on_turn_start("turn-1", "normal", 0);
		controller.on_token_usage(100);
		await controller.on_turn_end();

		// A user followUp is already queued — let it drive the next turn instead.
		const skipped = controller.maybe_dispatch_continuation({ hasPendingMessages: true });
		assert.equal(skipped.dispatched, false);
		assert.equal(skipped.reason, "pending_messages");

		// Once the queue is empty, dispatch proceeds as usual.
		const dispatched = controller.maybe_dispatch_continuation({ hasPendingMessages: false });
		assert.equal(dispatched.dispatched, true);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("Controller: dispatch refused for paused/terminal goals (continue_if_idle semantics)", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Pausable goal", "ConfirmIfExists");
		await controller.set_status("paused");

		const outcome = controller.maybe_dispatch_continuation({ hasPendingMessages: false });
		assert.equal(outcome.dispatched, false);
		assert.equal(outcome.reason, "not_active_status");

		await controller.apply_update_goal({ status: "complete" });
		const completeOutcome = controller.maybe_dispatch_continuation({ hasPendingMessages: false });
		assert.equal(completeOutcome.dispatched, false);
		assert.equal(completeOutcome.reason, "not_active_status");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("Controller: on_turn_error blocks an active goal but never a terminal one", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Erroring goal", "ConfirmIfExists");

		const blocked = controller.on_turn_error();
		assert.equal(blocked?.status, "blocked");

		// A completed goal must not be demoted to blocked by a later run error.
		await controller.set_objective("Second goal", "ReplaceExisting");
		await controller.apply_update_goal({ status: "complete" });
		const stillComplete = controller.on_turn_error();
		assert.equal(stillComplete?.status, "complete");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("Controller: total continuation counter resets on new goal", async () => {
	const agentDir = createTempAgentDir();
	try {
		const controller = makeController(agentDir);
		await controller.set_objective("Task 1", "ConfirmIfExists");

		// Exhaust continuation dispatches (consecutive limit stops them first)
		for (let i = 0; i < 15; i++) {
			controller.on_turn_start(`turn-${i}`, "normal", 0);
			controller.on_token_usage(100 * (i + 1));
			await controller.on_turn_end();
			controller.maybe_dispatch_continuation({ hasPendingMessages: false });
		}

		// Set a new goal — counter should reset
		await controller.set_objective("Task 2", "ReplaceExisting");

		// First continuation on new goal should work
		controller.on_turn_start("turn-new-0", "normal", 0);
		controller.on_token_usage(100);
		await controller.on_turn_end();
		const outcome = controller.maybe_dispatch_continuation({ hasPendingMessages: false });
		assert.equal(outcome.dispatched, true);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
