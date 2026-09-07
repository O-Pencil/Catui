/**
 * [WHO]: Regression tests for persisted working-window handoffs and both agent loop frameworks
 * [FROM]: Depends on SessionManager, ContextWindowController, private agent loops, and fake AI streams
 * [TO]: Consumed by node:test and the default-extension lifecycle contract
 * [HERE]: test/context-window.test.ts - offline continuity and safe-boundary acceptance
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@catui/agent-core";
import type { AssistantMessage } from "@catui/ai/types";
import { SessionManager } from "../core/session/session-manager.js";
import { ContextWindowController } from "../core/runtime/context-window-controller.js";
import { Agent } from "../core/lib/agent-core/src/agent.js";
import { EventStream } from "@catui/ai/events";
import { Type } from "@sinclair/typebox";
import type { AssistantMessageEvent, Model } from "@catui/ai/types";
import { createAgentSession } from "../core/runtime/sdk.js";
import { DefaultResourceLoader } from "../core/platform/config/resource-loader.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";
import { AuthStorage } from "../core/platform/config/auth-storage.js";
import contextManagementExtension from "../extensions/builtin/context-management/index.js";

const usage = { input: 20000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20010,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (text: string, id?: string): AssistantMessage => ({ role: "assistant", api: "openai-completions",
  provider: "test", model: "test", content: id ? [{ type: "toolCall", id, name: "read", arguments: {} }] : [{ type: "text", text }],
  usage, stopReason: id ? "toolUse" : "stop", timestamp: Date.now() });

function fixture(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const dir = mkdtempSync(join(tmpdir(), "catui-window-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const session = SessionManager.create(dir, dir);
  session.appendMessage({ role: "user", content: "Fix the bug. Do not publish. Preserve the API.", timestamp: 1 });
  for (let i = 0; i < 12; i++) session.appendMessage(assistant(`Evidence ${i}: ${"x".repeat(5000)}`));
  let window = 32000;
  let fail = false;
  const controller = new ContextWindowController({
    getSessionId: () => session.getSessionId(), getBranch: () => session.getBranch(),
    getContextWindow: () => window, getPromptTokens: () => 100,
    appendCheckpoint: (summary, first, tokens, details) => {
      if (fail) throw new Error("disk full");
      session.appendCompaction(summary, first, tokens, details, true);
    }, rebuildContext: () => session.buildSessionContext(),
  });
  return { session, controller, setWindow: (value: number) => { window = value; },
    failWrites: () => { fail = true; } };
}

test("handoff retains complete tool batch, original user request, and raw history after reopening", (t) => {
  const { session, controller } = fixture(t);
  session.appendMessage(assistant("", "call-1"));
  assert.equal(controller.request("Fixed parser; tests pending. Never publish. Next: run tests."), true);
  let messages = session.buildSessionContext().messages;
  assert.equal(controller.prepare(messages), messages, "pending tool result prevents a checkpoint");
  session.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "Found parser" }], isError: false, timestamp: 2 });
  messages = session.buildSessionContext().messages;
  const originalCount = session.getEntries().length;
  const prepared = controller.prepare(messages);
  assert.ok(prepared.length < messages.length);
  assert.equal(session.getEntries().length, originalCount + 1);
  assert.match(JSON.stringify(prepared), /Do not publish/);
  assert.equal(prepared.filter((message) => message.role === "toolResult").length, 1);
  assert.ok(prepared.some((message) => message.role === "assistant" && message.content.some((block) => block.type === "toolCall" && block.id === "call-1")));
  const reopened = SessionManager.open(session.getSessionFile()!);
  assert.equal(reopened.getSessionId(), session.getSessionId());
  assert.deepEqual(reopened.buildSessionContext(), session.buildSessionContext());
  assert.ok(reopened.getEntries().some((entry) => entry.type === "message" && JSON.stringify(entry.message).includes("Evidence 0")));
  assert.equal(controller.prepare(prepared), prepared, "request consumed exactly once");
});

test("handoff defers until newest message is journaled and rejects sibling-branch requests", (t) => {
  const { session, controller } = fixture(t);
  controller.request("Continue testing");
  const unpersisted = [...session.buildSessionContext().messages, assistant("not journaled")];
  assert.equal(controller.prepare(unpersisted), unpersisted);
  session.branch(session.getBranch()[0].id);
  const sibling = session.buildSessionContext().messages;
  assert.equal(controller.prepare(sibling), sibling);
  assert.equal(session.getEntries().filter((entry) => entry.type === "compaction").length, 0);
});

test("unknown/small windows, cancellation, and disk failures retain original context", (t) => {
  for (const window of [0, 2048]) {
    const f = fixture(t);
    f.setWindow(window);
    f.controller.request("Continue testing");
    const messages = f.session.buildSessionContext().messages;
    assert.equal(f.controller.prepare(messages), messages);
  }
  const f = fixture(t);
  f.controller.request("Continue testing");
  f.controller.cancel();
  const messages = f.session.buildSessionContext().messages;
  assert.equal(f.controller.prepare(messages), messages);
  f.controller.request("Continue testing");
  f.failWrites();
  assert.throws(() => f.controller.prepare(messages), /disk full/);
  assert.deepEqual(f.session.buildSessionContext().messages, messages);
});

test("journal append failure rolls back in-memory checkpoint and branch leaf", (t) => {
  const { session } = fixture(t);
  const before = session.getEntries();
  const leaf = session.getLeafId();
  session._persist = () => { throw new Error("disk full"); };
  assert.throws(() => session.appendCompaction("handoff", before[0].id, 100), /disk full/);
  assert.deepEqual(session.getEntries(), before);
  assert.equal(session.getLeafId(), leaf);
});

test("repeated windows preserve all checkpoints and notes without resetting the session", (t) => {
  const { session, controller } = fixture(t);
  const id = session.getSessionId();
  for (let round = 0; round < 3; round++) {
    controller.request(`Round ${round}: keep API; continue tests.`);
    const messages = session.buildSessionContext().messages;
    assert.notEqual(controller.prepare(messages), messages);
    for (let i = 0; i < 8; i++) session.appendMessage(assistant("More evidence " + "y".repeat(5000)));
  }
  assert.equal(session.getSessionId(), id);
  assert.equal(session.getEntries().filter((entry) => entry.type === "compaction").length, 3);
});

for (const framework of ["standard", "weak-model-compatible"] as const) {
  test(`${framework}: handoff commits in-loop, preserves tool results, and keeps transient hints out of state`, async (t) => {
    const { session, controller } = fixture(t);
    let calls = 0;
    let executions = 0;
    const model: Model<"openai-completions"> = { id: "test", name: "Test", api: "openai-completions", provider: "test",
      baseUrl: "https://example.invalid", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const agent = new Agent({
      initialState: { model, messages: session.buildSessionContext().messages,
        tools: [{ name: "read", description: "Continue", parameters: Type.Object({}),
          execute: async () => {
            executions++;
            if (executions === 1) assert.equal(controller.request("Preserve API. Read completed; continue verification."), true);
            return { content: [{ type: "text", text: `Result ${executions}` }], details: {} };
          } }] },
      agentLoopFramework: framework,
      prepareContext: (messages) => controller.prepare(messages),
      transformContext: async (messages) => [...messages, { role: "user", content: "transient budget hint", timestamp: 5 }],
      streamFn: (_model, context) => {
        calls++;
        if (calls > 1) {
          assert.ok(!JSON.stringify(context.messages).includes("Evidence 0"), "old window must stay removed on every subsequent request");
          assert.ok(JSON.stringify(context.messages).includes("Result 1"), "completed result must cross the boundary");
        }
        const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
          (event) => event.type === "done" || event.type === "error",
          (event) => event.type === "done" ? event.message : (event as any).error,
        );
        const message = calls <= 2 ? assistant("", `loop-${calls}`) : assistant("Verified");
        queueMicrotask(() => stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }));
        return stream;
      },
    });
    agent.subscribe((event) => {
      if (event.type === "message_end" && (event.message.role === "user" || event.message.role === "assistant" || event.message.role === "toolResult")) {
        session.appendMessage(event.message);
      }
    });
    await agent.prompt("Continue verification");
    assert.equal(calls, 3);
    assert.equal(executions, 2);
    assert.ok(!JSON.stringify(agent.state.messages).includes("Evidence 0"));
    assert.ok(!JSON.stringify(agent.state.messages).includes("transient budget hint"));
    assert.equal(session.getEntries().filter((entry) => entry.type === "compaction").length, 1);
    assert.equal(agent.state.lastResult?.stopReason, "stop");
  });
}

test("SDK wires new_context through the actual extension host and persists a same-session handoff", async (t) => {
  const { session: journal } = fixture(t);
  const cwd = journal.getCwd();
  const settings = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [contextManagementExtension], systemPrompt: "Continue the task.",
    agentsFilesOverride: () => ({ agentsFiles: [] }) });
  await loader.reload();
  const auth = AuthStorage.create(join(cwd, "auth.json"));
  auth.setRuntimeApiKey("test", "offline-test-key");
  const model: Model<"openai-completions"> = { id: "test", name: "Test", api: "openai-completions", provider: "test",
    baseUrl: "https://example.invalid", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const { session } = await createAgentSession({ cwd, agentDir: cwd, sessionManager: journal, settingsManager: settings,
    authStorage: auth, resourceLoader: loader, model, enableSoul: false, enableMCP: false, tools: [] });
  let calls = 0;
  session.agent.streamFn = (_model, context) => {
    calls++;
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
      (event) => event.type === "done" || event.type === "error",
      (event) => event.type === "done" ? event.message : (event as any).error);
    let message = assistant("Continued without asking the user.");
    if (calls === 1) {
      message = { ...message, stopReason: "toolUse", content: [{ type: "toolCall", id: "handoff-tool", name: "new_context",
        arguments: { handoff: "Preserve API. Evidence gathered. Next: verify changes; do not repeat completed work." } }] };
    } else {
      assert.ok(!JSON.stringify(context.messages).includes("Evidence 0"));
      assert.match(JSON.stringify(context.messages), /accepted.*true/);
    }
    queueMicrotask(() => stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }));
    return stream;
  };
  await session.prompt("Continue with the current task.");
  assert.equal(calls, 2);
  assert.equal(journal.getEntries().filter((entry) => entry.type === "compaction").length, 1);
  assert.ok(session.getAllTools().some((tool) => tool.name === "session_history"));
  session.dispose();
});
