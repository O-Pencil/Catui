/**
 * [WHO]: Verifies queue cancellation, event ordering, recovery and trace cleanup
 * [FROM]: Runtime owners and node:test/fs; no live model calls
 * [TO]: Runtime refactoring acceptance suite
 * [HERE]: test/session-runtime-owners.test.ts
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@catui/ai/types";
import type { ExtensionRunner } from "../core/extensions-host/index.js";
import { SessionMessageQueue } from "../core/runtime/session-message-queue.js";
import { SessionEventHandler, type SessionEventContext } from "../core/runtime/session-event-handler.js";
import { SessionRunTrace } from "../core/runtime/session-run-trace.js";
import { getContextUsage, getSessionStats } from "../core/runtime/session-queries.js";
import { Agent } from "@catui/agent-core";
import { EventStream } from "@catui/ai/events";
import type { AssistantMessageEvent, Model } from "@catui/ai/types";
import type { ExtensionAPI } from "../core/extensions-host/types.js";
import { createAgentSession } from "../core/runtime/sdk.js";
import { SessionManager } from "../core/session/session-manager.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";
import { DefaultResourceLoader } from "../core/platform/config/resource-loader.js";
import { AuthStorage } from "../core/platform/config/auth-storage.js";
import { Type } from "@sinclair/typebox";

const assistant: AssistantMessage = {
  role: "assistant", content: [{ type: "text", text: "done" }], api: "openai-completions",
  provider: "test", model: "test", stopReason: "stop", timestamp: 1,
  usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, totalTokens: 17,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 } },
};

test("queue delivery removes one matching item; scoped cancellation preserves unrelated work", () => {
  const queue = new SessionMessageQueue();
  queue.enqueue("steer", "same"); queue.enqueue("followUp", "same");
  queue.enqueue("followUp", "keep"); queue.delivered("same");
  assert.deepEqual(queue.steering, []);
  assert.deepEqual(queue.followUp, ["same", "keep"]);
  queue.clearFollowUp(text => text === "same");
  queue.nextTurn({ role: "custom", customType: "context", content: "evidence", display: false, timestamp: 1 });
  assert.equal(queue.pendingCount, 1);
  assert.deepEqual(queue.clear(), { steering: [], followUp: ["keep"] });
  assert.equal(queue.drainNextTurn().length, 1, "clearing user queues preserves next-turn context");
  assert.equal(queue.drainNextTurn().length, 0);
});

function eventFixture(retry = false) {
  const calls: string[] = [];
  let journaled = false;
  const runner = { emit: async (event: { type: string }) => {
    if (event.type === "message_end") assert.ok(journaled, "persist before async hooks");
    calls.push(`hook:${event.type}`);
  } } as unknown as ExtensionRunner;
  const context: SessionEventContext = {
    appendMessage: () => { journaled = true; calls.push("journal"); return "id"; },
    appendCustomMessageEntry: () => "id",
    delivered: () => calls.push("delivered"), emit: event => calls.push(`ui:${event.type}`),
    getExtensionRunner: () => runner, onSuccess: () => calls.push("success"),
    isRetryableError: () => retry, handleError: async () => { calls.push("retry"); return true; },
    checkCompaction: async () => { calls.push("compact"); }, debug: () => {}, logError: () => {},
    abortAgent: () => calls.push("abort"),
  };
  return { calls, handler: new SessionEventHandler(context) };
}

test("journaling precedes hooks and compaction precedes stable extension agent_end", async () => {
  const { calls, handler } = eventFixture();
  await handler.handle({ type: "message_start", message: { role: "user", content: "next", timestamp: 1 } });
  assert.ok(calls.indexOf("delivered") < calls.indexOf("ui:message_start"));
  await handler.handle({ type: "message_end", message: assistant });
  await handler.handle({ type: "agent_end", messages: [assistant] });
  await handler.waitForCompletion();
  assert.ok(calls.indexOf("journal") < calls.indexOf("hook:message_end"));
  assert.ok(calls.indexOf("compact") < calls.indexOf("hook:agent_end"));
});

test("retry suppresses premature compaction and stable completion hooks", async () => {
  const { calls, handler } = eventFixture(true);
  await handler.handle({ type: "message_end", message: { ...assistant, stopReason: "error" } });
  await handler.handle({ type: "agent_end", messages: [] });
  await handler.waitForCompletion();
  assert.ok(calls.includes("retry"));
  assert.ok(!calls.includes("compact"));
  assert.ok(!calls.includes("hook:agent_end"));
});

function assistantStream(message = assistant) {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    event => event.type === "done" || event.type === "error",
    event => event.type === "done" ? event.message : (event as { error: AssistantMessage }).error);
  queueMicrotask(() => stream.push({ type: "done", reason: message.stopReason as "stop", message }));
  return stream;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("actual Agent dispatch preserves immediate rendering and ordered hooks before compaction", async () => {
  const gate = deferred();
  const started = deferred();
  const calls: string[] = [];
  const runner = { emit: async (event: { type: string; turnIndex?: number }) => {
    if (event.type === "message_end") { started.resolve(); await gate.promise; }
    calls.push(`hook:${event.type}:${event.turnIndex ?? ""}`);
  } } as unknown as ExtensionRunner;
  const handler = new SessionEventHandler({
    appendMessage: () => "id", appendCustomMessageEntry: () => "id", delivered: () => {},
    emit: event => calls.push(`ui:${event.type}`), getExtensionRunner: () => runner,
    onSuccess: () => {}, isRetryableError: () => false, handleError: async () => false,
    checkCompaction: async () => { calls.push("compact"); }, debug: () => {}, logError: () => {}, abortAgent: () => {},
  });
  const agent = new Agent({ initialState: { model: { id: "test", api: "openai-completions" } as Model<any> },
    streamFn: () => assistantStream() });
  agent.subscribe(handler.handle);
  await agent.prompt("inspect");
  await started.promise;
  assert.ok(calls.includes("ui:agent_end"), "a slow hook must not delay rendering");
  assert.ok(!calls.includes("compact"));
  assert.ok(!calls.some(call => call.startsWith("hook:agent_end")));
  gate.resolve();
  await handler.waitForCompletion();
  assert.ok(calls.indexOf("hook:turn_end:0") < calls.indexOf("compact"));
  assert.ok(calls.indexOf("compact") < calls.indexOf("hook:agent_end:"));
});

async function sdkEventFixture(t: TestContext, factory?: (api: ExtensionAPI) => void) {
  const dir = mkdtempSync(join(tmpdir(), "catui-event-reliability-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manager = SessionManager.create(dir, dir);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: factory ? [factory] : [], agentsFilesOverride: () => ({ agentsFiles: [] }) });
  await loader.reload();
  const auth = AuthStorage.create(join(dir, "auth.json"));
  auth.setRuntimeApiKey("test", "offline");
  const model: Model<"openai-completions"> = { id: "test", name: "Test", api: "openai-completions", provider: "test",
    baseUrl: "https://example.invalid", reasoning: false, input: ["text"], contextWindow: 16384, maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, sessionManager: manager,
    settingsManager: settings, authStorage: auth, resourceLoader: loader, model, tools: [], enableMCP: false, enableSoul: false });
  t.after(() => session.dispose());
  session.agent.streamFn = () => assistantStream();
  return { session, manager };
}

test("SDK prompt rejects a journal failure, aborts before model work and does not continue autonomously", async t => {
  let stableEnds = 0;
  const { session, manager } = await sdkEventFixture(t, api => api.on("agent_end", () => { stableEnds++; }));
  let modelCalls = 0;
  session.agent.streamFn = () => { modelCalls++; return assistantStream(); };
  const writeFailure = new Error("simulated ENOSPC");
  const append = manager.appendMessage.bind(manager);
  manager.appendMessage = () => { throw writeFailure; };
  const errors: unknown[] = [];
  session.subscribe(event => { if (event.type === "sdk:error" && event.source === "session") errors.push(event.error); });
  await assert.rejects(session.prompt("unsaved request"), error => error === writeFailure);
  assert.equal(modelCalls, 0);
  assert.equal(stableEnds, 0);
  assert.deepEqual(errors, [writeFailure]);
  assert.equal(session.isStreaming, false);
  assert.equal(manager.getBranch().filter(entry => entry.type === "message").length, 0);
  manager.appendMessage = append;
  await session.prompt("retry after storage is repaired");
  assert.equal(modelCalls, 1);
  assert.equal(stableEnds, 1);
});

test("SDK session switch waits for old notifications and suppresses pending recovery", async t => {
  const gate = deferred(); const started = deferred();
  const messages: string[] = [];
  let stableEnds = 0;
  const { session, manager } = await sdkEventFixture(t, api => {
    api.on("message_end", async (_event, ctx) => {
      started.resolve(); await gate.promise; messages.push(ctx.sessionManager.getSessionId());
    });
    api.on("agent_end", () => { stableEnds++; });
  });
  const oldId = manager.getSessionId();
  const run = session.prompt("old session");
  await started.promise;
  const switching = session.newSession();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.getSessionId(), oldId);
  gate.resolve();
  await Promise.all([run, switching]);
  assert.ok(messages.every(id => id === oldId));
  assert.notEqual(manager.getSessionId(), oldId);
  assert.equal(stableEnds, 0);
});

test("a lifecycle hook can cancel the agent without waiting on its own notification queue", async t => {
  const { session } = await sdkEventFixture(t, api => {
    api.on("message_end", async (_event, ctx) => { await ctx.abort(); });
  });
  await session.prompt("cancel from hook");
  assert.equal(session.isStreaming, false);
});

test("SDK permission pipeline executes the composed tool input and preserves a later no-op", async t => {
  let executed: unknown;
  const { session } = await sdkEventFixture(t, api => {
    api.registerTool({ name: "probe", label: "Probe", description: "Offline probe", parameters: Type.Object({ limit: Type.Optional(Type.Integer()) }),
      execute: async (_id, input) => { executed = input; return { content: [{ type: "text", text: "ok" }], details: {} }; } });
    api.on("tool_call", event => ({ input: { ...event.input, limit: 120 } }));
    api.on("tool_call", event => { assert.equal(event.input.limit, 120); return { block: false }; });
  });
  let calls = 0;
  session.agent.streamFn = () => assistantStream(++calls === 1
    ? { ...assistant, stopReason: "toolUse", content: [{ type: "toolCall", id: "probe-1", name: "probe", arguments: {} }] }
    : assistant);
  await session.prompt("run probe");
  assert.deepEqual(executed, { limit: 120 });
  assert.equal(calls, 2);
});

test("trace detaches on failed execution and preserves the original failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "catui-trace-owner-"));
  try {
    const trace = new SessionRunTrace();
    const recorders: unknown[] = [];
    await assert.rejects(trace.run(dir, "test", value => recorders.push(value),
      async () => { throw new Error("model failed"); }, () => {}), /model failed/);
    assert.ok(recorders[0]);
    assert.equal(recorders.at(-1), undefined);
    assert.ok(trace.snapshot);
    assert.equal(trace.path, undefined, "an empty trace has no persisted run ID");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("queries preserve usage accounting and unknown model behavior", () => {
  const stats = getSessionStats([assistant], undefined, "test");
  assert.equal(stats.tokens.total, 17);
  assert.equal(stats.cost, 0.1);
  assert.equal(stats.assistantMessages, 1);
  assert.equal(getContextUsage([assistant], undefined, []), undefined);
});
