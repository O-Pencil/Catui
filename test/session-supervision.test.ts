/**
 * [WHO]: Cross-mode delegated command, decision and HTTP acceptance tests
 * [FROM]: Real extension loader/runner, Plan/Goal/Grub owners and bridge transport
 * [TO]: CI test:tools; no provider requests or real user configuration
 * [HERE]: test/session-supervision.test.ts - supervisor execution boundary
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createExtensionRuntime, loadExtensionFromFactory } from "../core/extensions-host/loader.js";
import { ExtensionRunner } from "../core/extensions-host/runner.js";
import { createEventBus } from "../core/runtime/event-bus.js";
import { SessionManager } from "../core/session/session-manager.js";
import grub from "../extensions/builtin/grub/index.js";
import goal from "../extensions/builtin/goal/index.js";
import plan from "../extensions/builtin/plan/index.js";
import { createAskUserQuestionTool } from "../extensions/builtin/ask-user-question/ask-user-question-tool.js";
import { getPlan, writePlan, resetPlansDirectoryCache } from "../extensions/builtin/plan/plan-file-manager.js";
import { BridgeController } from "../extensions/optional/session-bridge/controller.js";
import { startBridgeServer } from "../extensions/optional/session-bridge/server.js";
import { callBridge, readDescriptor } from "../extensions/optional/session-bridge/plugin/client.js";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "catui-supervised-"));
  const runtime = createExtensionRuntime(), bus = createEventBus();
  const manager = SessionManager.inMemory(root);
  const queue: string[] = [];
  let idle = true;
  const extensions = [];
  resetPlansDirectoryCache();
  for (const factory of [grub, goal, plan]) extensions.push(await loadExtensionFromFactory(factory, root, root, bus, runtime));
  const runner = new ExtensionRunner(extensions, runtime, root, root, manager, {} as any);
  runner.bindCore({
    sendUserMessage: (text: string) => { queue.push(text); }, sendMessage: () => {},
    appendEntry: (type: string, value: unknown) => manager.appendCustomEntry(type, value),
    getActiveTools: () => [], getCommands: () => [],
  } as any, {
    getModel: () => undefined,
    isIdle: () => idle, hasPendingMessages: () => queue.length > 0,
    clearFollowUpQueue: (matches?: (text: string) => boolean) => {
      for (let i = queue.length - 1; i >= 0; i--) if (!matches || matches(queue[i])) queue.splice(i, 1);
    },
    getSettings: () => ({ locale: "en", plansDirectory: ".plans" }),
    abort: () => { void runner.emit({ type: "agent_abort" } as any); },
  } as any);
  runner.setUIContext({
    notify: () => {}, setStatus: () => {}, setWidget: () => {},
    select: async () => { throw new Error("Unexpected local selector"); },
    confirm: async () => { throw new Error("Unexpected local confirmation"); },
    input: async () => { throw new Error("Unexpected local input"); },
  } as any);
  await runner.emit({ type: "session_start" } as any);
  const id = manager.getSessionId();
  runtime.supervision.start(id);
  const controller = new BridgeController({ supervision: runtime.supervision, sessionId: () => id,
    isIdle: () => idle, hasPendingMessages: () => queue.length > 0, send: text => queue.push(text), abort: () => {} });
  const transport = await startBridgeServer(controller, root, join(root, "bridges"));
  const descriptor = await readDescriptor(transport.bridgeId, join(root, "bridges"));
  let sequence = 0;
  const progress = () => callBridge(descriptor) as Promise<any>;
  const settle = async (requestId: string) => {
    for (let i = 0; i < 50; i++) {
      const p = await progress();
      const receipt = p.supervision.operations.find((o: any) => o.requestId === requestId);
      if (receipt?.status !== "running") return receipt;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error("Operation failed to settle");
  };
  const command = async (name: string, args = "") => {
    const revision = (await progress()).supervision.revision;
    const requestId = `op-${++sequence}`;
    await callBridge(descriptor, { action: "execute", sessionId: id, requestId, name, args, revision });
    return requestId;
  };
  const decision = async () => {
    for (let i = 0; i < 50; i++) {
      const requests = (await progress()).supervision.pendingDecisions;
      if (requests.length) return requests[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error("No pending decision");
  };
  const answer = (decisionId: string, value: unknown) => callBridge(descriptor, {
    action: "answer", sessionId: id, requestId: `answer-${++sequence}`, decisionId, value,
  });
  t.after(async () => { await transport.close(); await runner.emit({ type: "session_shutdown" } as any); await rm(root, { recursive: true, force: true }); resetPlansDirectoryCache(); });
  return { root, runtime, runner, bus, id, queue, descriptor, controller, progress, settle, command, decision, answer, setIdle: (value: boolean) => { idle = value; } };
}

test("live catalog separates remote owners from local commands; actual Goal/Grub commands coordinate continuation", async t => {
  const f = await fixture(t);
  const catalog: any = await callBridge(f.descriptor, undefined, "/capabilities");
  assert.equal(catalog.commands.find((c: any) => c.name === "goal").remote, true);
  assert.equal(catalog.commands.find((c: any) => c.name === "settings").remote, false);
  assert.equal((await f.settle(await f.command("goal", "Implement a small feature"))).status, "handler_finished");
  assert.equal((await f.progress()).supervision.states.goal.status, "active");
  assert.match(f.queue[0], /^\[GOAL:/);
  assert.equal((await f.settle(await f.command("goal", "pause"))).status, "handler_finished");
  assert.equal(f.queue.length, 0);
  assert.equal((await f.settle(await f.command("grub", "Implement a feature --max-iter 2"))).status, "handler_finished");
  let states = (await f.progress()).supervision.states;
  assert.equal(states.grub.active.maxIterations, 2);
  assert.match(f.queue[0], /^\[GRUB:/);
  await f.settle(await f.command("grub", "stop"));
  assert.equal(f.queue.length, 0);
  await f.settle(await f.command("grub", "resume"));
  assert.equal(f.queue.length, 1);
  await f.settle(await f.command("goal", "resume"));
  states = (await f.progress()).supervision.states;
  assert.equal(states.goal.status, "active");
  assert.equal(states.grub.active, undefined);
  assert.equal(f.queue.length, 1);
  assert.match(f.queue[0], /^\[GOAL:/);
});

test("busy commands, local-only commands, stale revisions and changed retry payloads fail without mutation", async t => {
  const f = await fixture(t);
  f.setIdle(false);
  assert.match((await f.settle(await f.command("grub", "New task"))).error, /idle/);
  assert.match((await f.settle(await f.command("settings"))).error, /not enabled/);
  f.setIdle(true);
  const old = (await f.progress()).supervision.revision;
  await f.settle(await f.command("goal", "First objective"));
  const input = { action: "execute", sessionId: f.id, requestId: "stale", name: "goal", args: "clear", revision: old };
  await callBridge(f.descriptor, input);
  assert.match((await f.settle("stale")).error, /state changed/);
  await callBridge(f.descriptor, input);
  await assert.rejects(callBridge(f.descriptor, { ...input, args: "pause" }), /409/);
  assert.equal((await f.progress()).supervision.states.goal.objective, "First objective");
});

test("remote Plan approval exposes full text, blocks elevation, and leaves planning on rejection", async t => {
  const f = await fixture(t);
  await f.settle(await f.command("plan"));
  const content = `# Plan\n${"Evidence and implementation details.\n".repeat(70)}`;
  await writePlan(f.bus, content);
  const op = await f.command("plan", "exit");
  const pending = await f.decision();
  assert.ok(pending.title.includes(content));
  assert.deepEqual(pending.options, ["Execute plan (standard)", "Keep planning", "Reject plan"]);
  await f.answer(pending.id, "Reject plan");
  await f.settle(op);
  assert.equal((await f.progress()).supervision.states.plan.mode, "plan");
  const approved = await f.command("plan", "exit");
  await f.answer((await f.decision()).id, "Execute plan (standard)");
  await f.settle(approved);
  assert.equal((await f.progress()).supervision.states.plan.mode, "default");
});

test("changed plans and disconnected decisions never grant approval", async t => {
  const f = await fixture(t);
  await f.settle(await f.command("plan"));
  await writePlan(f.bus, "Initial plan");
  const op = await f.command("plan", "exit");
  const pending = await f.decision();
  await writePlan(f.bus, "Changed plan");
  await f.answer(pending.id, "Execute plan (standard)");
  await f.settle(op);
  const snapshot = (await f.progress()).supervision;
  assert.equal(snapshot.states.plan.mode, "plan");
  assert.ok(snapshot.notifications.some((x: any) => /changed/.test(x.message)));
  const waiting = f.runtime.supervision.request({ kind: "confirm", title: "Proceed?" });
  const rejected = assert.rejects(waiting, /disconnected/);
  f.controller.revoke();
  await rejected;
  assert.throws(() => f.runtime.supervision.answer(pending.id, true), /no longer active/);
  assert.equal(getPlan(f.bus), "Changed plan");
});

test("AskUserQuestion and Goal replacement round-trip through decisions, with duplicate answers rejected", async t => {
  const f = await fixture(t);
  const tool = createAskUserQuestionTool();
  const resultPromise = tool.execute("question", { questions: [{ question: "Which scope?", header: "Scope", options: [
    { label: "Small", description: "One module" }, { label: "Large", description: "All modules" },
  ] }] }, undefined, undefined, f.runner.createContext());
  const pending = await f.decision();
  await f.answer(pending.id, "Small — One module");
  assert.equal((await resultPromise).details.answers["Which scope?"], "Small");
  assert.throws(() => f.runtime.supervision.answer(pending.id, "Small — One module"), /stale/);
  await f.settle(await f.command("goal", "First objective"));
  const replace = await f.command("goal", "Second objective");
  const confirm = await f.decision();
  assert.equal(confirm.kind, "confirm");
  await f.answer(confirm.id, true);
  await f.settle(replace);
  assert.equal((await f.progress()).supervision.states.goal.objective, "Second objective");
});

test("ordinary steering remains separate from commands and stopping supervision cancels questions on abort", async t => {
  const f = await fixture(t);
  await callBridge(f.descriptor, { action: "send", sessionId: f.id, requestId: "feedback", message: "Only fix failing tests", mode: "steer" });
  assert.match(f.queue[0], /Only fix failing tests/);
  const waiting = f.runtime.supervision.request({ kind: "input", title: "Clarify" });
  const rejected = assert.rejects(waiting, /interrupted/);
  await f.runner.emit({ type: "agent_abort" } as any);
  await rejected;
  assert.equal((await f.progress()).supervision.pendingDecisions.length, 0);
});

test("MCP subprocess discovers owners, executes once on retry, and answers a pending replacement", async t => {
  const f = await fixture(t);
  const child = spawn(process.execPath, ["extensions/optional/session-bridge/plugin/server.js"], {
    env: { ...process.env, CATUI_BRIDGE_DIR: join(f.root, "bridges") }, stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); });
  const waiting = new Map<number, (value: any) => void>();
  const lines = createInterface({ input: child.stdout });
  t.after(() => lines.close());
  lines.on("line", line => { const result = JSON.parse(line); waiting.get(result.id)?.(result); });
  let sequence = 0;
  const rpc = (method: string, params: any) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error("MCP timeout")), 5000);
    waiting.set(id, value => { clearTimeout(timer); waiting.delete(id); resolve(value); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  await rpc("initialize", { protocolVersion: "2025-06-18" });
  const call = async (name: string, args: any) => {
    const response = (await rpc("tools/call", { name, arguments: args })).result;
    assert.equal(response.isError, false, JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  };
  const target = { bridge_id: f.descriptor.bridgeId, session_id: f.id };
  const catalog = await call("get_capabilities", target);
  assert.ok(catalog.commands.some((c: any) => c.name === "plan" && c.remote));
  const args = { ...target, request_id: "mcp-goal", name: "goal", args: "Build feature", revision: (await f.progress()).supervision.revision };
  await call("execute_command", args);
  await f.settle("mcp-goal");
  await call("execute_command", args);
  assert.equal(f.queue.length, 1);
  const replace = { ...args, request_id: "mcp-replace", args: "Revise feature", revision: (await f.progress()).supervision.revision };
  await call("execute_command", replace);
  const pending = await f.decision();
  assert.match((await f.settle(await f.command("goal", "clear"))).error, /still running/);
  await call("answer_decision", { ...target, request_id: "mcp-answer", decision_id: pending.id, value: true });
  await f.settle("mcp-replace");
  assert.equal((await call("get_progress", target)).supervision.states.goal.objective, "Revise feature");
});
