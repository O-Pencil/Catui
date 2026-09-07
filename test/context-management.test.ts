/**
 * [WHO]: Default context extension registration, bounded retrieval, notes, and budget-hint tests
 * [FROM]: Depends on context-management extension, SessionManager, and builtin registry
 * [TO]: Consumed by node:test and default-extension lifecycle verification
 * [HERE]: test/context-management.test.ts - offline default UX and branch isolation
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtInExtensions, getBuiltinExtensionPaths } from "../builtin-extensions.js";
import { SessionManager } from "../core/session/session-manager.js";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "../core/extensions-host/types.js";
import contextManagementExtension from "../extensions/builtin/context-management/index.js";
import { readHistory } from "../extensions/builtin/context-management/history.js";
import { readNotes, writeNote } from "../extensions/builtin/context-management/notes.js";
import { evaluatePlanModeToolCall } from "../core/runtime/plan-mode-permissions.js";

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "catui-context-ext-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const session = SessionManager.create(dir, dir);
  const tools = new Map<string, ToolDefinition>();
  const hooks = new Map<string, Function>();
  const api = { registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    on: (name: string, handler: Function) => hooks.set(name, handler),
    appendEntry: (type: string, data: unknown) => session.appendCustomEntry(type, data) } as unknown as ExtensionAPI;
  contextManagementExtension(api);
  const ctx = { sessionManager: session, getContextUsage: () => ({ tokens: 25000, contextWindow: 32000, percent: 78 }),
    requestContextWindow: () => true } as unknown as ExtensionContext;
  const execute = async (name: string, input: unknown) => {
    const result = await tools.get(name)!.execute("test", input as never, undefined, undefined, ctx);
    return JSON.parse((result.content[0] as { text: string }).text);
  };
  return { session, hooks, tools, ctx, execute };
}

test("context continuity is default-enabled and discoverable without settings", () => {
  assert.equal(builtInExtensions.find((extension) => extension.id === "context-management")?.defaultEnabled, true);
  assert.ok(getBuiltinExtensionPaths().some((path) => path.includes("context-management")));
});

test("history retrieves original pre-checkpoint evidence with bounded pagination and no sibling/hidden content", (t) => {
  const { session } = fixture(t);
  const root = session.appendMessage({ role: "user", content: "original constraint " + "a".repeat(9000), timestamp: 1 });
  const sibling = session.appendMessage({ role: "user", content: "sibling secret", timestamp: 2 });
  session.branch(root);
  session.appendCompaction("current handoff", root, 1000);
  const branch = session.getBranch();
  const read = readHistory(branch, { action: "read", entry_id: root }) as any;
  assert.equal(read.text.length, 4000);
  assert.equal(read.next_offset, 4000);
  assert.equal((readHistory(branch, { action: "read", entry_id: sibling }) as any).error, "Entry not found in the active branch.");
  const found = readHistory(branch, { action: "search", query: "constraint" }) as any;
  assert.equal(found.items[0].entry_id, root);
  assert.ok(JSON.stringify(found).length < 1000);
  session.appendMessage({ role: "assistant", content: [{ type: "thinking", thinking: "hidden reasoning" }, { type: "text", text: "visible answer" }],
    api: "openai-completions", provider: "test", model: "test", stopReason: "stop", timestamp: 3,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  assert.equal((readHistory(session.getBranch(), { action: "search", query: "hidden reasoning" }) as any).total, 0);
});

test("notes survive reopening and replay revisions from selected ancestry", (t) => {
  const { session } = fixture(t);
  const save = (type: string, data: unknown) => { session.appendCustomEntry(type, data); };
  writeNote(session.getBranch(), "task", "Keep the API", false, save);
  const first = session.getLeafId()!;
  writeNote(session.getBranch(), "task", "Run tests", true, save);
  assert.equal(readNotes(SessionManager.open(session.getSessionFile()!).getBranch()).get("task")?.revision, 2);
  session.branch(first);
  assert.equal(readNotes(session.getBranch()).get("task")?.content, "Keep the API");
  assert.throws(() => writeNote(session.getBranch(), "../escape", "no", false, save), /Note name/);
  assert.throws(() => writeNote(session.getBranch(), "task", "x".repeat(12001), false, save), /12000/);
});

test("default tools save handoffs, bound note reads, and inject transient budget hints without LLM calls", async (t) => {
  const { execute, hooks, session, ctx } = fixture(t);
  await execute("working_notes", { action: "write", name: "task", content: "x".repeat(9000) });
  assert.equal((await execute("working_notes", { action: "read", name: "task" })).content.length, 4000);
  assert.equal((await execute("new_context", { handoff: "Tests remain; preserve the public API." })).accepted, true);
  assert.equal(readNotes(session.getBranch()).get("handoff")?.revision, 1);
  const messages = [{ role: "user", content: "Continue", timestamp: 1 }];
  const before = session.getEntries().length;
  const transformed = hooks.get("context")!({ messages }, ctx);
  assert.match(transformed.messages.at(-1).content, /handoff_recommended="true"/);
  assert.equal(messages.length, 1);
  assert.equal(session.getEntries().length, before);
  ctx.getContextUsage = () => ({ tokens: null, contextWindow: 32000, percent: null });
  assert.match(hooks.get("context")!({ messages }, ctx).messages.at(-1).content, /remaining_work_tokens="unknown"/);
  ctx.getContextUsage = () => undefined;
  assert.equal(hooks.get("context")!({ messages }, ctx), undefined);
});

test("continuity tools remain usable in plan mode without granting workspace writes", () => {
  for (const toolName of ["session_history", "working_notes", "new_context"]) {
    assert.equal(evaluatePlanModeToolCall({ toolName, toolCallId: "test", input: {}, rawInput: {} } as any, process.cwd(), {}).decision, "allow");
  }
  assert.equal(evaluatePlanModeToolCall({ toolName: "NotebookEdit", toolCallId: "test", input: {}, rawInput: {} } as any, process.cwd(), {}).decision, "deny");
});
