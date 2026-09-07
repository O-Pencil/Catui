/**
 * [WHO]: Regression coverage for shared Goal/Grub dispatch, cancellation, resume and budgets
 * [FROM]: Production extension hooks/controllers and host continuation lease factory
 * [TO]: Critical harness and CI; uses no model calls
 * [HERE]: test/goal-grub-lifecycle.test.ts - cross-extension lifecycle acceptance
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import goalExtension from "../extensions/builtin/goal/index.js";
import grubExtension from "../extensions/builtin/grub/index.js";
import { GoalController } from "../extensions/builtin/goal/goal-controller.js";
import { GoalStore } from "../extensions/builtin/goal/goal-store.js";
import { createExtensionRuntime } from "../core/extensions-host/loader.js";
import { GrubController } from "../extensions/builtin/grub/grub-controller.js";
import { discoverActiveTasks } from "../extensions/builtin/grub/grub-persistence.js";
import type { ExtensionAPI } from "../core/extensions-host/types.js";

async function fixture(t: test.TestContext) {
	const root = mkdtempSync(join(tmpdir(), "catui-lifecycle-"));
	const hooks = new Map<string, Function[]>();
	const commands = new Map<string, any>();
	const queue: string[] = [];
	const messages: any[] = [];
	const runtime = createExtensionRuntime();
	let idle = true;
	const api = {
		agentDir: root, cwd: root, events: {},
		on: (name: string, fn: Function) => hooks.set(name, [...(hooks.get(name) ?? []), fn]),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerTool: () => {}, registerMessageRenderer: () => {}, appendEntry: () => {},
		claimContinuation: runtime.claimContinuation,
		isIdle: () => idle,
		clearFollowUpQueue: (matches?: (text: string) => boolean) => {
			for (let i = queue.length - 1; i >= 0; i--) if (!matches || matches(queue[i])) queue.splice(i, 1);
		},
		sendUserMessage: (prompt: string) => { queue.push(prompt); },
		sendMessage: (message: any) => messages.push(message),
	} as unknown as ExtensionAPI;
	const ctx: any = {
		agentDir: root, cwd: root, hasUI: false, getSettings: () => ({ locale: "en" }),
		sessionManager: { getSessionId: () => "thread" },
		ui: { notify: () => {}, confirm: async () => true },
		isIdle: () => idle, hasPendingMessages: () => queue.length > 0, abort: () => {},
	};
	const emit = async (name: string, event: any = {}) => {
		for (const hook of hooks.get(name) ?? []) await hook(event, ctx);
	};
	await grubExtension(api);
	await goalExtension(api);
	await emit("session_start");
	t.after(async () => { await emit("session_shutdown"); rmSync(root, { recursive: true, force: true }); });
	return {
		root, api, ctx, queue, messages, emit, store: new GoalStore(root, "thread"),
		command: (name: string, args: string) => commands.get(name).handler(args, ctx),
		setIdle: (value: boolean) => { idle = value; },
		begin: async () => {
			const prompt = queue.shift()!; assert.ok(prompt); idle = false;
			await emit("before_agent_start", { prompt }); await emit("agent_start");
			await emit("turn_start", { turnIndex: 0, timestamp: Date.now() }); return prompt;
		},
		end: async (text = "", stopReason = "completed") => {
			await emit("turn_end", { turnIndex: 0 });
			await emit("agent_result", { stopReason, turnCount: 1, toolCallCount: 0, durationMs: 1 });
			idle = true;
			await emit("agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text }] }] });
		},
	};
}

test("an inactive goal never deletes queued user or foreign extension work", async t => {
	const h = await fixture(t);
	h.store.replace_goal("Old task", "paused", null);
	h.queue.push("User follow-up", "[GRUB:foreign:1] work");
	await h.emit("turn_start", { turnIndex: 0, timestamp: Date.now() });
	await h.emit("turn_end", { turnIndex: 0 });
	assert.deepEqual(h.queue, ["User follow-up", "[GRUB:foreign:1] work"]);
});

test("goal pause cancels only its own dispatch and resume starts exactly once", async t => {
	const h = await fixture(t);
	await h.command("goal", "Finish feature");
	h.queue.push("User follow-up");
	await h.command("goal", "pause");
	assert.deepEqual(h.queue, ["User follow-up"]);
	h.queue.length = 0;
	await h.command("goal", "resume");
	await h.command("goal", "resume");
	assert.equal(h.queue.length, 1); assert.match(h.queue[0], /^\[GOAL:/);
});

test("budget crossing delivers exactly one steering instruction", async t => {
	const h = await fixture(t);
	h.store.replace_goal("Budget task", "active", 10);
	await h.emit("turn_start", { turnIndex: 0, timestamp: Date.now() });
	await h.emit("message_end", { message: { role: "assistant", usage: { totalTokens: 11 } } });
	await h.emit("message_end", { message: { role: "assistant", usage: { totalTokens: 12 } } });
	assert.equal(h.store.get_goal()?.status, "budget_limited");
	assert.equal(h.messages.filter(m => m.details?.kind === "budget_limit").length, 1);
});

test("Grub abort does not dispatch or attribute a stale run, and persisted work resumes", async t => {
	const h = await fixture(t);
	await h.command("grub", "Implement feature --max-iter 2");
	await h.begin();
	await h.emit("agent_abort");
	await h.end("", "aborted");
	assert.equal(h.queue.length, 0);
	const stopped = discoverActiveTasks(h.root, true)[0].task;
	assert.equal(stopped.status, "stopped");
	assert.equal(stopped.cumulativeTurnCount, 1);
	await h.command("grub", "resume");
	await h.command("grub", "resume");
	assert.equal(h.queue.length, 1);
	assert.equal(discoverActiveTasks(h.root)[0].task.id, stopped.id);
});

test("busy Grub start waits for idle and never charges or advances the foreign run", async t => {
	const h = await fixture(t); h.setIdle(false);
	await h.command("grub", "Implement feature");
	await h.command("grub", "resume");
	assert.equal(h.queue.length, 0);
	await h.end("Unrelated user response");
	assert.equal(h.queue.length, 1);
	const task = discoverActiveTasks(h.root)[0].task;
	assert.equal(task.currentIteration, 1); assert.equal(task.cumulativeTurnCount, 0);
});

test("stopping queued Grub work does not abort the user's current run", async t => {
	const h = await fixture(t); h.setIdle(false);
	let aborted = false; h.ctx.abort = () => { aborted = true; };
	await h.command("grub", "Implement feature");
	await h.command("grub", "stop");
	assert.equal(aborted, false);
	await h.end("User response");
	assert.equal(h.queue.length, 0);
});

test("continuation leases are isolated across session runtimes", () => {
	const first = createExtensionRuntime(), second = createExtensionRuntime();
	let revoked = 0;
	const old = first.claimContinuation(() => { revoked++; old.release(); });
	const independent = second.claimContinuation(() => assert.fail("foreign session revoked"));
	const next = first.claimContinuation(() => {});
	assert.equal(revoked, 1); assert.equal(old.isCurrent(), false);
	assert.equal(next.isCurrent(), true); assert.equal(independent.isCurrent(), true);
	next.release(); assert.equal(next.isCurrent(), false);
});

test("shutting down one Goal host preserves another host's queued work", async t => {
	const first = await fixture(t), second = await fixture(t);
	await first.command("goal", "First session");
	await second.command("goal", "Second session");
	await first.emit("session_shutdown");
	assert.equal(first.queue.length, 0);
	assert.equal(second.queue.length, 1);
	await second.begin(); await second.end();
	assert.equal(second.queue.length, 1);
});

test("explicit driver changes pause prior work, preserve user messages, and reject stale ends", async t => {
	const h = await fixture(t);
	await h.command("goal", "Goal work");
	h.queue.push("User follow-up");
	await h.command("grub", "Structured work");
	assert.equal(h.store.get_goal()?.status, "paused");
	assert.deepEqual(h.queue, ["User follow-up"]);
	h.queue.length = 0;
	await h.end(); assert.equal(h.queue.length, 1);
	await h.begin();
	await h.command("goal", "resume");
	assert.equal(discoverActiveTasks(h.root, true)[0].task.status, "stopped");
	assert.equal(h.queue.length, 0);
	await h.end();
	assert.equal(h.queue.length, 1); assert.match(h.queue[0], /^\[GOAL:/);
});

test("assistant tool cycles do not reset consecutive run limits and explicit resume renews allowance", async t => {
	const root = mkdtempSync(join(tmpdir(), "catui-goal-run-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const controller = new GoalController({ agentDir: root, sendUserMessage: () => {} } as any, "runs");
	await controller.set_objective("Long work", "ConfirmIfExists");
	for (let run = 0; run < 10; run++) {
		controller.on_run_start();
		for (let cycle = 0; cycle < 2; cycle++) { controller.on_turn_start(`${run}-${cycle}`, "normal", 0); await controller.on_turn_end(); }
		assert.equal(controller.maybe_dispatch_continuation({ hasPendingMessages: false }).dispatched, true);
	}
	controller.on_run_start(); controller.on_turn_start("last", "normal", 0); await controller.on_turn_end();
	assert.equal(controller.maybe_dispatch_continuation({ hasPendingMessages: false }).reason, "continuation_limit_reached");
	await controller.set_status("active");
	assert.equal(controller.kickOffContinuation(), true);
});

test("failed Grub recovery renews its configured allowance without losing identity or cost", t => {
	const root = mkdtempSync(join(tmpdir(), "catui-grub-resume-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const controller = new GrubController();
	const task = controller.start("Task", root, { maxIterations: 2 });
	controller.accumulateRunResult({ turnCount: 3 }); controller.stop("Limit reached", "failed");
	const persisted = discoverActiveTasks(root, true)[0].task;
	const resumed = controller.adoptResumedTask(persisted, true);
	assert.equal(resumed.id, task.id); assert.equal(resumed.cumulativeTurnCount, 3);
	assert.equal(resumed.maxIterations - resumed.currentIteration + 1, 2);
	assert.equal(resumed.consecutiveFailures, 0);
});

test("the total Goal continuation cap is renewable without resetting recorded usage", async t => {
	const root = mkdtempSync(join(tmpdir(), "catui-goal-total-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const controller = new GoalController({ agentDir: root, sendUserMessage: () => {} } as any, "total");
	await controller.set_objective("Long work", "ConfirmIfExists");
	for (let run = 0; run < 30; run++) {
		controller.on_run_start();
		// A real user run between automatic runs renews only the consecutive cap.
		controller.on_run_start();
		controller.on_turn_start(`run-${run}`, "normal", 0);
		controller.on_token_usage(10);
		await controller.on_turn_end();
		assert.equal(controller.maybe_dispatch_continuation({ hasPendingMessages: false }).dispatched, true);
	}
	controller.on_run_start(); controller.on_run_start();
	assert.equal(controller.maybe_dispatch_continuation({ hasPendingMessages: false }).reason, "total_continuation_limit_reached");
	const before = await controller.get_goal();
	await controller.set_status("active");
	assert.equal(controller.kickOffContinuation(), true);
	controller.on_run_start(); controller.on_turn_start("resumed", "normal", 0); await controller.on_turn_end();
	assert.equal(controller.maybe_dispatch_continuation({ hasPendingMessages: false }).dispatched, true);
	assert.equal((await controller.get_goal())?.tokens_used, before?.tokens_used);
});
