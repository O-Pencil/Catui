/**
 * [WHO]: Local-model profile lifecycle, evidence recovery, payload, and permission regressions
 * [FROM]: Real extension loader/runner/wrapper, SessionManager, tools, registry, and local-model helpers
 * [TO]: Consumed by node:test and test:runtime-owners
 * [HERE]: test/local-model-enhancement.test.ts - offline constrained-model acceptance
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@catui/agent-core";
import type { AssistantMessage, AssistantMessageEvent, Model, ToolResultMessage } from "@catui/ai/types";
import { EventStream } from "@catui/ai/events";
import { Type } from "@sinclair/typebox";
import { builtInExtensions, getBuiltinExtensionPaths } from "../builtin-extensions.js";
import { createExtensionRuntime, loadExtensionFromFactory, loadExtensions } from "../core/extensions-host/loader.js";
import { ExtensionRunner } from "../core/extensions-host/runner.js";
import { wrapToolWithExtensions } from "../core/extensions-host/wrapper.js";
import { createEventBus } from "../core/runtime/event-bus.js";
import { evaluatePlanModeToolCall } from "../core/runtime/plan-mode-permissions.js";
import { SessionManager } from "../core/session/session-manager.js";
import { createReadTool } from "../core/tools/read.js";
import { AuthStorage } from "../core/platform/config/auth-storage.js";
import { createAgentSession } from "../core/runtime/sdk.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";
import { DefaultResourceLoader } from "../core/platform/config/resource-loader.js";
import localModelEnhancement from "../extensions/optional/local-model-enhancement/index.js";
import { defaultToolInput, resultBudget } from "../extensions/optional/local-model-enhancement/budget.js";
import { projectToolResults, readResultPage, RESULT_READER } from "../extensions/optional/local-model-enhancement/results.js";

async function fixture(t: TestContext, existing?: SessionManager) {
  const dir = mkdtempSync(join(tmpdir(), "catui-local-model-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const session = existing ?? SessionManager.create(dir, dir);
  const runtime = createExtensionRuntime();
  const extension = await loadExtensionFromFactory(localModelEnhancement, dir, dir, createEventBus(), runtime);
  const runner = new ExtensionRunner([extension], runtime, dir, dir, session, {} as never);
  const state = { idle: true, window: 16384 };
  const notifications: string[] = [];
  const forbidden = () => { throw new Error("Unexpected model call or settings/tool mutation"); };
  runner.bindCore({
    sendMessage: forbidden, sendUserMessage: forbidden, executeCommand: forbidden,
    appendEntry: (type, data) => { session.appendCustomEntry(type, data); },
    setSessionName: forbidden, getSessionName: () => undefined, setLabel: forbidden,
    getActiveTools: () => [], getAllTools: () => [], setActiveTools: forbidden, getCommands: () => [],
    setModel: forbidden, getThinkingLevel: () => "off", setThinkingLevel: forbidden,
  }, {
    getModel: () => ({ contextWindow: state.window } as never), completeSimple: forbidden,
    isIdle: () => state.idle, abort: forbidden, clearFollowUpQueue: forbidden,
    hasPendingMessages: () => false, shutdown: forbidden, getContextUsage: () => undefined,
    compact: forbidden, getSystemPrompt: () => "Project rules", getSoulManager: () => undefined,
    getSettings: () => ({}), getSkills: () => [],
  });
  runner.setUIContext({ ...runner.getUIContext(), notify: (text) => notifications.push(text) });
  runner.onError((error) => { throw new Error(error.message); });
  const command = (args: string) => extension.commands.get("local-model-enhancement")!.handler(args, runner.createCommandContext());
  const readback = (input: { tool_call_id: string; offset?: number; limit?: number }) =>
    extension.tools.get(RESULT_READER)!.definition.execute("reader", input, undefined, undefined, runner.createContext());
  return { dir, session, runner, extension, state, notifications, command, readback };
}

function result(id: string, text: string, extras: Partial<ToolResultMessage> = {}): ToolResultMessage {
  return { role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text }],
    isError: false, timestamp: 1, ...extras };
}
const outputText = (message: AgentMessage) => message.role === "toolResult"
  ? message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";

function assistant(): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text: "Next step" }],
    api: "openai-completions", provider: "test", model: "local", stopReason: "stop", timestamp: 1,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

test("profile is cataloged but not default-loaded, and loads through the real file loader", async (t) => {
  const f = await fixture(t);
  assert.equal(builtInExtensions.find((e) => e.id === "local-model-enhancement")?.defaultEnabled, false);
  assert.ok(!getBuiltinExtensionPaths().some((path) => /\/optional\/local-model-enhancement\//.test(path)));
  const loaded = await loadExtensions([join(process.cwd(), "extensions/optional/local-model-enhancement/index.ts")], f.dir, f.dir);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.ok(loaded.extensions[0].commands.has("local-model-enhancement"));
  assert.equal(f.extension.tools.get(RESULT_READER)!.definition.readOnly, true);
});

test("real wrapped read gets a bounded default, respects explicit ranges, and restores defaults when off", async (t) => {
  const f = await fixture(t);
  const path = join(f.dir, "sample.txt");
  writeFileSync(path, Array.from({ length: 400 }, (_, i) => `line-${i + 1}`).join("\n"));
  const read = wrapToolWithExtensions(createReadTool(f.dir), f.runner);
  const limited = await read.execute("read-1", { path });
  const limitedText = limited.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  assert.match(limitedText, /line-120/);
  assert.doesNotMatch(limitedText, /line-121/);
  const explicit = await read.execute("read-2", { path, offset: 200, limit: 3 });
  assert.match((explicit.content[0] as any).text, /line-202/);
  assert.doesNotMatch((explicit.content[0] as any).text, /line-203/);
  await f.command("off");
  const full = await read.execute("read-3", { path });
  assert.match((full.content[0] as any).text, /line-400/);
});

test("explicit arguments, aliases, invalid values, and unrelated tools are never overwritten", () => {
  for (const input of [{ limit: 500 }, { limit: 0 }, { limit: null }, { head_limit: 60 }]) {
    assert.equal(defaultToolInput("grep", input), undefined);
  }
  const input = { path: ".", pattern: "needle", offset: 5 };
  assert.deepEqual(defaultToolInput("grep", input), { ...input, limit: 30 });
  assert.deepEqual(input, { path: ".", pattern: "needle", offset: 5 });
  assert.equal(defaultToolInput("custom:read", {}), undefined);
  assert.equal(defaultToolInput("bash", { command: "run tests" }), undefined);
});

test("runner previews preserve original journal, error flags, pairing, non-text content, and middle evidence", async (t) => {
  const f = await fixture(t);
  const text = "H".repeat(12000) + "MIDDLE_FAILURE" + "T".repeat(12000);
  const image = { type: "image" as const, data: "AA==", mimeType: "image/png" };
  const original = result("failed-check", text, { isError: true, details: { exitCode: 1 },
    content: [{ type: "text", text }, image] });
  const user: AgentMessage = { role: "user", content: "Preserve the public API", timestamp: 0 };
  f.session.appendMessage(user);
  f.session.appendMessage(original);
  const before = JSON.stringify(f.session.getBranch());
  const projected = await f.runner.emitContext([user, original]);
  assert.deepEqual(projected[0], user);
  assert.equal(projected[1].role, "toolResult");
  const preview = projected[1] as ToolResultMessage;
  assert.equal(preview.toolCallId, "failed-check");
  assert.equal(preview.isError, true);
  assert.deepEqual(preview.details, { exitCode: 1 });
  assert.deepEqual(preview.content[1], image);
  assert.ok(outputText(preview).length < 5000);
  assert.match(outputText(preview), /local_model_read_result/);
  assert.doesNotMatch(outputText(preview), /MIDDLE_FAILURE/);
  assert.equal(JSON.stringify(f.session.getBranch()), before);
  assert.equal(outputText(original), text);
  t.diagnostic(`Tool text projection: ${text.length} -> ${outputText(preview).length} characters; original journal unchanged.`);
  const page = await f.readback({ tool_call_id: "failed-check", offset: 12000, limit: 100 });
  assert.match((page.content[0] as any).text, /MIDDLE_FAILURE/);
  assert.match((page.content[0] as any).text, /error=true/);
  await f.command("off");
  assert.deepEqual(await f.runner.emitContext([user, original]), [user, original]);
  assert.match((await f.readback({ tool_call_id: "failed-check", offset: 12000 })).content[0].text, /MIDDLE_FAILURE/);
});

test("budgets prioritize recent evidence, keep small output intact, and adapt when switching models", async (t) => {
  const f = await fixture(t);
  const messages = Array.from({ length: 9 }, (_, i) => result(`call-${i}`, `${i}`.repeat(10000)));
  messages.forEach((m) => f.session.appendMessage(m));
  f.state.window = 8192;
  const small = await f.runner.emitContext(messages);
  f.state.window = 32768;
  const large = await f.runner.emitContext(messages);
  assert.ok(outputText(small.at(-1)!).length < outputText(large.at(-1)!).length);
  assert.ok(outputText(small[0]).length < outputText(small.at(-1)! ).length);
  assert.ok(small.reduce((sum, m) => sum + outputText(m).length, 0) < 12000);
  for (const m of small) assert.match(outputText(m), /Use local_model_read_result/);
  const short = result("short", "exit code 1");
  f.session.appendMessage(short);
  assert.deepEqual((await f.runner.emitContext([...messages, short])).at(-1), short);
  const tiny = projectToolResults(messages, f.session.getBranch(), resultBudget(32));
  assert.match(outputText(tiny.messages[0]), /limit=1000/);
  assert.deepEqual(resultBudget(NaN), resultBudget(undefined));
});

test("appending tool batches preserves previously projected prefixes", async (t) => {
  const f = await fixture(t);
  const first: AgentMessage[] = [assistant(), ...Array.from({ length: 6 }, (_, i) => result(`first-${i}`, "x".repeat(10000)))];
  first.forEach((m) => f.session.appendMessage(m as any));
  const before = await f.runner.emitContext(first);
  const later: AgentMessage[] = [assistant(), ...Array.from({ length: 6 }, (_, i) => result(`later-${i}`, "y".repeat(10000)))];
  later.forEach((m) => f.session.appendMessage(m as any));
  const after = await f.runner.emitContext([...first, ...later]);
  assert.deepEqual(after.slice(0, first.length), before);
});

test("readback pages are bounded, not previewed again, and cannot cross branches or expose assistant text", async (t) => {
  const f = await fixture(t);
  const root = f.session.appendMessage({ role: "user", content: "root", timestamp: 1 });
  f.session.appendMessage(result("sibling", "private sibling evidence"));
  f.session.branch(root);
  const id = f.session.appendMessage(result("active", "a".repeat(2500)));
  f.session.appendCompaction("handoff", id, 10000);
  const page = readResultPage(f.session.getBranch(), "active");
  assert.equal(page.split("\n").slice(1).join("\n").length, 1000);
  assert.match(page, /next_offset=1000/);
  assert.match(readResultPage(f.session.getBranch(), "active", 2000), /next_offset=none/);
  assert.throws(() => readResultPage(f.session.getBranch(), "sibling"), /not found/);
  assert.throws(() => readResultPage(f.session.getBranch(), root), /not found/);
  for (const [offset, limit] of [[-1, 1], [0, 1001], [1.5, 2], [0, 0], [Infinity, 5]]) {
    assert.throws(() => readResultPage(f.session.getBranch(), "active", offset, limit), /integer/);
  }
  const readerResult = result("reader", page, { toolName: RESULT_READER });
  f.session.appendMessage(readerResult);
  f.state.window = 32;
  assert.deepEqual(await f.runner.emitContext([readerResult]), [readerResult]);
});

test("unrecoverable or previously transformed results remain intact", async (t) => {
  const f = await fixture(t);
  const original = result("stored", "x".repeat(12000));
  f.session.appendMessage(original);
  const changed = result("stored", "redacted " + "r".repeat(12000));
  const missing = result("not-stored", "y".repeat(12000));
  assert.deepEqual(await f.runner.emitContext([changed, missing]), [changed, missing]);
});

test("on/off state follows session ancestry and survives reload; commands do not mutate during a run", async (t) => {
  const f = await fixture(t);
  const root = f.session.appendMessage({ role: "user", content: "root", timestamp: 1 });
  f.session.appendMessage(assistant());
  await f.command("off");
  const offBranch = f.session.getLeafId()!;
  assert.equal(await f.runner.emitBeforeAgentStart("task", undefined, "Project rules"), undefined);
  const reloaded = await fixture(t, SessionManager.open(f.session.getSessionFile()!));
  assert.equal(await reloaded.runner.emitBeforeAgentStart("task", undefined, "Project rules"), undefined);
  f.session.branch(root);
  const prompt = await f.runner.emitBeforeAgentStart("task", undefined, "Project rules");
  assert.ok(prompt?.systemPrompt?.startsWith("Project rules\n\n"));
  assert.match(prompt!.systemPrompt!, /one verifiable step/);
  f.session.branch(offBranch);
  f.state.idle = false;
  const count = f.session.getEntries().length;
  await f.command("on");
  assert.equal(f.session.getEntries().length, count);
  assert.match(f.notifications.at(-1)!, /Wait for the current run/);
  await f.command("unexpected");
  assert.equal(f.session.getEntries().length, count);
  f.state.idle = true;
  await f.command("on");
  assert.match((await f.runner.emitBeforeAgentStart("task", undefined, "Project rules"))!.systemPrompt!, /enhancement is active/);
  await f.command("status");
  assert.match(f.notifications.at(-1)!, /on/);
});

test("readback is available under plan permission policy while workspace writes stay denied", () => {
  const call = (toolName: string) => ({ toolName, requestedToolName: toolName, toolCallId: "test", input: { path: "src/index.ts" }, rawInput: {} });
  assert.equal(evaluatePlanModeToolCall(call(RESULT_READER), process.cwd()).decision, "allow");
  assert.equal(evaluatePlanModeToolCall(call("edit"), process.cwd()).decision, "deny");
});

test("SDK loop previews a real tool result, recovers omitted evidence, and keeps its complete journal", async (t) => {
  const f = await fixture(t);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: f.dir, agentDir: f.dir, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [localModelEnhancement], systemPrompt: "Preserve project rules.",
    agentsFilesOverride: () => ({ agentsFiles: [] }) });
  await loader.reload();
  const auth = AuthStorage.create(join(f.dir, "auth.json"));
  auth.setRuntimeApiKey("test", "offline-test-key");
  const model: Model<"openai-completions"> = { id: "test", name: "Test", api: "openai-completions", provider: "test",
    baseUrl: "https://example.invalid", reasoning: false, input: ["text"], contextWindow: 16384, maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const log = "h".repeat(12000) + "REAL_FAILURE" + "t".repeat(12000);
  const { session } = await createAgentSession({ cwd: f.dir, agentDir: f.dir, sessionManager: f.session,
    settingsManager: settings, authStorage: auth, resourceLoader: loader, model, enableSoul: false, enableMCP: false,
    tools: [], customTools: [{ name: "fixture_log", label: "Fixture log", description: "Return fixture evidence", parameters: Type.Object({}),
      execute: async () => ({ content: [{ type: "text", text: log }], details: {} }) }] });
  t.after(() => session.dispose());
  let calls = 0;
  session.agent.streamFn = (_model, context) => {
    calls++;
    assert.ok(calls <= 3, "No extra summarization or continuation calls");
    assert.match(context.systemPrompt!, /Preserve project rules/);
    assert.match(context.systemPrompt!, /Local model enhancement is active/);
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
      (event) => event.type === "done" || event.type === "error",
      (event) => event.type === "done" ? event.message : (event as any).error);
    let message = assistant();
    if (calls === 1) {
      message = { ...message, stopReason: "toolUse", content: [{ type: "toolCall", id: "log-call", name: "fixture_log", arguments: {} }] };
    } else if (calls === 2) {
      const projected = context.messages.find((m) => m.role === "toolResult" && m.toolCallId === "log-call")!;
      assert.match(outputText(projected), /Local model preview/);
      assert.doesNotMatch(outputText(projected), /REAL_FAILURE/);
      message = { ...message, stopReason: "toolUse", content: [{ type: "toolCall", id: "recover-call", name: RESULT_READER,
        arguments: { tool_call_id: "log-call", offset: 12000, limit: 50 } }] };
    } else {
      const recovered = context.messages.find((m) => m.role === "toolResult" && m.toolCallId === "recover-call")!;
      assert.match(outputText(recovered), /REAL_FAILURE/);
    }
    queueMicrotask(() => stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }));
    return stream;
  };
  await session.prompt("Inspect the fixture log and recover its omitted failure.");
  assert.equal(calls, 3, JSON.stringify(session.agent.state.messages.at(-1)));
  const stored = f.session.getBranch().find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === "log-call");
  assert.ok(stored?.type === "message");
  assert.equal(outputText(stored.message), log);
});
