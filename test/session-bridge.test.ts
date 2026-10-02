/**
 * [WHO]: Same-session bridge authority, lifecycle and real HTTP/MCP integration tests
 * [FROM]: Node test/fs/process, extension entry and private bridge implementation
 * [TO]: Repository focused verification and CI
 * [HERE]: test/session-bridge.test.ts - no live user data or provider requests
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readdir, chmod, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { BridgeController } from "../extensions/optional/session-bridge/controller.ts";
import { startBridgeServer } from "../extensions/optional/session-bridge/server.ts";
import sessionBridge from "../extensions/optional/session-bridge/index.ts";
import { callBridge, listSessions, readDescriptor } from "../extensions/optional/session-bridge/plugin/client.js";

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), "catui-bridge-"));
  await chmod(directory, 0o700);
  let session = "session-one", idle = true, aborted = 0;
  const sent: Array<{ text: string; mode: string }> = [];
  const controller = new BridgeController({ sessionId: () => session, isIdle: () => idle,
    hasPendingMessages: () => sent.length > 0, send: (text, mode) => { sent.push({ text, mode }); }, abort: () => { aborted++; } });
  const transport = await startBridgeServer(controller, "/example/workspace", directory);
  t.after(async () => { await transport.close(); await rm(directory, { recursive: true, force: true }); });
  const descriptor = await readDescriptor(transport.bridgeId, directory);
  return { directory, controller, transport, descriptor, sent, setSession: (id: string) => { session = id; },
    setIdle: (value: boolean) => { idle = value; }, aborted: () => aborted };
}
const sendCommand = (id = "message-1", message = "Review the first batch") => ({
  action: "send", sessionId: "session-one", requestId: id, message, mode: "followUp",
});

test("real HTTP targets the same host and separates submitted from observed receipts", async t => {
  const f = await fixture(t);
  const receipt: any = await callBridge(f.descriptor, sendCommand());
  assert.ok(f.transport.lastContactAt);
  assert.equal(receipt.status, "submitted");
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].mode, "followUp");
  f.controller.observe(f.sent[0].text);
  const repeated: any = await callBridge(f.descriptor, sendCommand());
  assert.equal(repeated.status, "observed");
  assert.equal(repeated.duplicate, true);
  assert.equal(f.sent.length, 1);
  await assert.rejects(callBridge(f.descriptor, sendCommand("message-1", "Different")), /409/);
  await assert.rejects(callBridge(f.descriptor, { ...sendCommand("two"), sessionId: "wrong" }), /409/);
});

test("authentication, browser origin, body limits and malformed inputs fail before dispatch", async t => {
  const f = await fixture(t);
  const url = `http://127.0.0.1:${f.descriptor.port}`;
  assert.equal((await fetch(`${url}/status`)).status, 401);
  assert.equal(f.transport.lastContactAt, undefined);
  assert.equal((await fetch(`${url}/status`, { headers: { Authorization: `Bearer ${f.descriptor.token}`, Origin: "https://example.com" } })).status, 403);
  const response = await fetch(`${url}/command`, { method: "POST", headers: { Authorization: `Bearer ${f.descriptor.token}`, "Content-Type": "application/json" }, body: "x".repeat(33000) });
  assert.equal(response.status, 413);
  await assert.rejects(callBridge(f.descriptor, { ...sendCommand(), mode: "shell" }), /400/);
  await assert.rejects(callBridge(f.descriptor, { ...sendCommand(), message: " " }), /400/);
  assert.equal(f.sent.length, 0);
});

test("steer is explicit and cancellation cannot affect a newer run", async t => {
  const f = await fixture(t);
  f.setIdle(false); f.controller.event("agent_start");
  const first = (f.controller.status() as any).runId;
  await callBridge(f.descriptor, { ...sendCommand(), mode: "steer" });
  assert.equal(f.sent[0].mode, "steer");
  f.controller.event("agent_end"); f.controller.event("agent_start");
  await assert.rejects(callBridge(f.descriptor, { action: "cancel", sessionId: "session-one", runId: first }), /409/);
  assert.equal(f.aborted(), 0);
  const current = (f.controller.status() as any).runId;
  assert.equal((await callBridge(f.descriptor, { action: "cancel", sessionId: "session-one", runId: current }) as any).status, "cancellation_requested");
  assert.equal(f.aborted(), 1);
});

test("session identity change revokes commands even before a lifecycle callback", async t => {
  const f = await fixture(t);
  f.setSession("session-two");
  await assert.rejects(callBridge(f.descriptor, sendCommand()), /410/);
  assert.equal(f.sent.length, 0);
  await f.transport.close();
  assert.deepEqual(await readdir(f.directory), []);
});

test("receipt limits do not evict idempotency keys or duplicate old submissions", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 8; i++) f.controller.dispatch(sendCommand(`pending-${i}`));
  assert.throws(() => f.controller.dispatch(sendCommand("ninth")), /unobserved/);
  for (const message of f.sent) f.controller.observe(message.text);
  for (let i = 8; i < 128; i++) {
    f.controller.dispatch(sendCommand(`message-${i}`));
    f.controller.observe(f.sent.at(-1)!.text);
  }
  assert.throws(() => f.controller.dispatch(sendCommand("overflow")), /Receipt limit/);
  f.controller.dispatch(sendCommand("pending-0"));
  assert.equal(f.sent.length, 128);
});

test("private registry skips dead endpoints and never returns tokens", async t => {
  const f = await fixture(t);
  const listed = await listSessions(f.directory);
  assert.equal(listed.sessions.length, 1);
  assert.equal(JSON.stringify(listed).includes(f.descriptor.token), false);
  const file = join(f.directory, `${f.transport.bridgeId}.json`);
  await chmod(file, 0o644);
  await assert.rejects(readDescriptor(f.transport.bridgeId, f.directory), /Unsafe/);
  await chmod(file, 0o600);
  const other = "00000000-0000-0000-0000-000000000000";
  await symlink(file, join(f.directory, `${other}.json`));
  await assert.rejects(readDescriptor(other, f.directory));
  assert.equal((await listSessions(f.directory)).unavailable, 1);
  await f.transport.close();
  await writeFile(file, JSON.stringify(f.descriptor), { mode: 0o600 });
  const stale = await listSessions(f.directory);
  assert.equal(stale.sessions.length, 0);
  assert.equal(stale.unavailable, 2);
});

test("bounded progress accepts a full window of multibyte assistant text", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 20; i++) f.controller.event("assistant_message", "测".repeat(4000));
  assert.equal((await callBridge(f.descriptor) as any).recent.length, 20);
});

test("extension is inert until start and closes on switch/fork/shutdown", async t => {
  const directory = await mkdtemp(join(tmpdir(), "catui-bridge-extension-"));
  const previous = process.env.CATUI_BRIDGE_DIR;
  process.env.CATUI_BRIDGE_DIR = directory;
  t.after(async () => { if (previous === undefined) delete process.env.CATUI_BRIDGE_DIR; else process.env.CATUI_BRIDGE_DIR = previous; await rm(directory, { recursive: true, force: true }); });
  const hooks = new Map<string, Function>(); let command: any;
  const sent: string[] = [];
  const ctx = { sessionManager: { getSessionId: () => "live-session" }, cwd: "/live",
    isIdle: () => true, hasPendingMessages: () => false, abort: () => {}, ui: { notify: () => {} } };
  sessionBridge({ on: (name: string, hook: Function) => hooks.set(name, hook),
    registerCommand: (_name: string, value: any) => { command = value; }, sendUserMessage: (text: string) => { sent.push(text); } } as any);
  assert.deepEqual(await readdir(directory), []);
  for (const event of ["session_switch", "session_fork", "session_shutdown"]) {
    await command.handler("start", ctx);
    const id = (await readdir(directory))[0].slice(0, -5);
    const descriptor = await readDescriptor(id, directory);
    await callBridge(descriptor, { ...sendCommand(event), sessionId: "live-session" });
    hooks.get("message_start")!({ message: { role: "user", content: sent.at(-1) } });
    const progress: any = await callBridge(descriptor);
    assert.equal(progress.receipts[0].status, "observed");
    await hooks.get(event)!();
    assert.deepEqual(await readdir(directory), []);
  }
});

test("malformed descriptor errors never expose credentials", async t => {
  const f = await fixture(t);
  const file = join(f.directory, `${f.transport.bridgeId}.json`);
  await writeFile(file, `{"token":"${f.descriptor.token}", broken`);
  await assert.rejects(readDescriptor(f.transport.bridgeId, f.directory), error => {
    assert.equal((error as Error).message, "Invalid bridge descriptor JSON");
    assert.equal(String(error).includes(f.descriptor.token), false);
    return true;
  });
});

test("bridge menu gives first-use setup and honest waiting/contact/disconnect status", async t => {
  const directory = await mkdtemp(join(tmpdir(), "catui-bridge-ui-"));
  const previous = process.env.CATUI_BRIDGE_DIR;
  process.env.CATUI_BRIDGE_DIR = directory;
  let command: any, confirmations = 0;
  const messages: string[] = [], badges: Array<string | undefined> = [];
  const ctx = { hasUI: true, cwd: "/ui-project", sessionManager: { getSessionId: () => "ui-session" },
    isIdle: () => true, hasPendingMessages: () => false, abort: () => {}, ui: {
      select: async () => "Start connection", confirm: async () => { confirmations++; return false; },
      notify: (message: string) => messages.push(message), setStatus: (_key: string, message: string | undefined) => badges.push(message),
    } };
  sessionBridge({ on: () => {}, registerCommand: (_name: string, value: any) => { command = value; }, sendUserMessage: () => {} } as any);
  t.after(async () => {
    await command.handler("stop", ctx);
    if (previous === undefined) delete process.env.CATUI_BRIDGE_DIR; else process.env.CATUI_BRIDGE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  assert.deepEqual(badges, []);
  await command.handler("", ctx);
  assert.equal(confirmations, 1);
  assert.equal(badges.at(-1), "Bridge: waiting for Codex");
  const descriptor = await readDescriptor((await readdir(directory))[0].slice(0, -5), directory);
  assert.ok(messages.some(message => message.includes(`Connect to Catui bridge ${descriptor.bridgeId}`)));
  await callBridge(descriptor);
  assert.equal(badges.at(-1), "Bridge: client seen");
  await command.handler("status", ctx);
  assert.ok(messages.at(-1)?.includes("Last client contact:"));
  await command.handler("stop", ctx);
  assert.equal(badges.at(-1), undefined);
});

test("SDK-loaded bridge submits into the same AgentSession queues and reload revokes it", async t => {
  const { AuthStorage } = await import("../core/platform/config/auth-storage.js");
  const { DefaultResourceLoader } = await import("../core/platform/config/resource-loader.js");
  const { SettingsManager } = await import("../core/platform/config/settings-manager.js");
  const { ModelRegistry } = await import("../core/model-registry.js");
  const { createAgentSession } = await import("../core/runtime/sdk.js");
  const { SessionManager } = await import("../core/session/session-manager.js");
  const directory = await mkdtemp(join(tmpdir(), "catui-bridge-sdk-"));
  const previous = process.env.CATUI_BRIDGE_DIR;
  process.env.CATUI_BRIDGE_DIR = join(directory, "bridges");
  t.after(async () => {
    if (previous === undefined) delete process.env.CATUI_BRIDGE_DIR; else process.env.CATUI_BRIDGE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const agentDir = join(directory, "agent");
  const settingsManager = SettingsManager.create(directory, agentDir);
  const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: [resolve("extensions/optional/session-bridge/index.ts")] });
  await resourceLoader.reload();
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  const { session } = await createAgentSession({ cwd: directory, agentDir, settingsManager, resourceLoader,
    sessionManager: SessionManager.create(directory, agentDir), authStorage,
    modelRegistry: new ModelRegistry(authStorage, join(agentDir, "models.json")) });
  try {
    assert.equal(await session.tryExecuteExtensionCommand("/bridge start"), true);
    const registry = join(directory, "bridges");
    const id = (await readdir(registry))[0].slice(0, -5);
    const descriptor = await readDescriptor(id, registry);
    assert.equal(descriptor.sessionId, session.sessionManager.getSessionId());
    // Simulate a busy provider without starting one; all submission/queue logic is real.
    session.agent.state.isStreaming = true;
    for (const mode of ["followUp", "steer"]) {
      await callBridge(descriptor, { ...sendCommand(`sdk-${mode}`), sessionId: descriptor.sessionId, mode });
    }
    const deadline = Date.now() + 2000;
    while (session.pendingMessageCount < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.equal(session.pendingMessageCount, 2);
    const queued = session.clearQueue();
    assert.match(queued.followUp[0], /sdk-followUp/);
    assert.match(queued.steering[0], /sdk-steer/);
    assert.equal((await callBridge(descriptor) as any).receipts.every((r: any) => r.status === "submitted"), true);
    session.agent.state.isStreaming = false;
    await session.reload();
    assert.deepEqual(await readdir(registry), []);
  } finally {
    session.agent.state.isStreaming = false;
    await session.tryExecuteExtensionCommand("/bridge stop");
    session.dispose();
  }
});

test("MCP stdio initializes, discovers tools, sends to live HTTP host, and checks receipts", async t => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [resolve("extensions/optional/session-bridge/plugin/server.js")],
    { env: { ...process.env, CATUI_BRIDGE_DIR: f.directory }, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  const waiting = new Map<number, (value: any) => void>(); let id = 0;
  lines.on("line", line => { const response = JSON.parse(line); waiting.get(response.id)?.(response); });
  const rpc = (method: string, params: any) => new Promise<any>((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => reject(new Error("MCP response timeout")), 8000);
    waiting.set(requestId, result => { clearTimeout(timeout); waiting.delete(requestId); resolve(result); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
  });
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.equal((await rpc("tools/list", {})).result.tools.length, 4);
  const call = async (name: string, args: any) => (await rpc("tools/call", { name, arguments: args })).result;
  const listed = await call("list_sessions", {});
  assert.equal(JSON.stringify(listed).includes(f.descriptor.token), false);
  const target = { bridge_id: f.transport.bridgeId, session_id: "session-one", request_id: "mcp-review", message: "Continue after checks" };
  assert.equal((await call("send_message", target)).isError, false);
  assert.equal(f.sent.length, 1);
  f.controller.observe(f.sent[0].text);
  const progress = JSON.parse((await call("get_progress", { bridge_id: f.transport.bridgeId })).content[0].text);
  assert.equal(progress.receipts[0].status, "observed");
  await call("send_message", target);
  assert.equal(f.sent.length, 1);
  assert.equal((await call("send_message", { ...target, message: "changed" })).isError, true);
});
