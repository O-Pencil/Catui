/**
 * [WHO]: Verifies queue cancellation, event ordering, recovery and trace cleanup
 * [FROM]: Runtime owners and node:test/fs; no live model calls
 * [TO]: Runtime refactoring acceptance suite
 * [HERE]: test/session-runtime-owners.test.ts
 */
import test from "node:test";
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
  };
  return { calls, handler: new SessionEventHandler(context) };
}

test("journaling precedes hooks and compaction precedes stable extension agent_end", async () => {
  const { calls, handler } = eventFixture();
  await handler.handle({ type: "message_start", message: { role: "user", content: "next", timestamp: 1 } });
  assert.ok(calls.indexOf("delivered") < calls.indexOf("ui:message_start"));
  await handler.handle({ type: "message_end", message: assistant });
  await handler.handle({ type: "agent_end", messages: [assistant] });
  assert.ok(calls.indexOf("journal") < calls.indexOf("hook:message_end"));
  assert.ok(calls.indexOf("compact") < calls.indexOf("hook:agent_end"));
});

test("retry suppresses premature compaction and stable completion hooks", async () => {
  const { calls, handler } = eventFixture(true);
  await handler.handle({ type: "message_end", message: { ...assistant, stopReason: "error" } });
  await handler.handle({ type: "agent_end", messages: [] });
  assert.ok(calls.includes("retry"));
  assert.ok(!calls.includes("compact"));
  assert.ok(!calls.includes("hook:agent_end"));
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
