/**
 * [WHO]: Exercises URL-first TUI setup, cancellation, authentication and saved-model inference
 * [FROM]: Depends on node:test/readline, HTTP fixtures, first-run bootstrap, discovery, auth controller, registry and AI streaming
 * [TO]: Consumed by npm run test:commands and CI
 * [HERE]: test/local-model-setup.test.ts — local endpoint configuration regression suite
 */
import test, { mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { syncBuiltinESMExports } from "node:module";
import { ensureCatuiCodingPlanAuth } from "../catui-defaults.js";
import { completeSimple } from "@catui/ai/stream";
import { ModelRegistry } from "../core/model-registry.js";
import { AuthStorage } from "../core/platform/config/auth-storage.js";
import { CUSTOM_OPENAI_PROVIDER, NO_AUTH_API_KEY, ensureCustomProtocolProvidersInModels } from "../core/model/custom-providers.js";
import { inspectOpenAIModels, normalizeOpenAIBaseUrl } from "../core/model/discovery.js";
import { collectOpenAIProviderSetup } from "../modes/interactive/controllers/openai-provider-setup.js";
import { AuthProviderConfigController, type AuthProviderConfigSurface } from "../modes/interactive/controllers/auth-provider-config-controller.js";

async function server(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  t.after(() => { instance.closeAllConnections(); instance.close(); });
  const address = instance.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

function ui(inputs: Array<string | undefined>, choices: Array<string | undefined>) {
  const prompts: string[] = [];
  const statuses: string[] = [];
  const errors: string[] = [];
  const menus: string[][] = [];
  const menuTitles: string[] = [];
  const surface = {
    async promptInput(title: string) {
      prompts.push(title);
      assert.ok(inputs.length, `Unexpected input prompt: ${title}`);
      return inputs.shift();
    },
    async pickOption(_title: string, options: string[]) {
      menus.push(options);
      menuTitles.push(_title);
      assert.ok(choices.length, `Unexpected picker: ${_title}`);
      const choice = choices.shift();
      assert.ok(choice === undefined || options.includes(choice), `Missing choice: ${choice}`);
      return choice;
    },
    showStatus(message: string) { statuses.push(message); },
    showError(message: string) { errors.push(message); },
    requestRender() {},
  };
  return { surface, prompts, statuses, errors, menus, menuTitles };
}

const previous = { baseUrl: "https://api.openai.com/v1", limits: {} };

test("first-run local setup enters the TUI without asking for a cloud key", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  const questions: string[] = [];
  let closed = false;
  const stub = mock.method(readline, "createInterface", () => ({
    question(prompt: string, answer: (value: string) => void) { questions.push(prompt); answer("5"); },
    close() { closed = true; },
  }));
  syncBuiltinESMExports();
  t.after(() => {
    stub.mock.restore();
    syncBuiltinESMExports();
    if (descriptor) Object.defineProperty(process.stdin, "isTTY", descriptor);
    else delete (process.stdin as unknown as { isTTY?: boolean }).isTTY;
  });
  const auth = AuthStorage.inMemory();
  await ensureCatuiCodingPlanAuth(auth, { getAvailable: () => [] } as unknown as ModelRegistry);
  assert.equal(questions.length, 1);
  assert.match(questions[0], /5\) Local\/custom server/);
  assert.equal(closed, true);
  assert.deepEqual(auth.list(), []);
});

test("URL-only setup persists a usable model and streams through its configured endpoint", async (t) => {
  let discoveryAuth: string | undefined;
  let inferenceBody: Record<string, unknown> | undefined;
  const url = await server(t, (req, res) => {
    if (req.url === "/v1/models") {
      discoveryAuth = req.headers.authorization;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "freetoken-local", context_length: 32768, max_output_tokens: 4096 }] }));
    } else if (req.url === "/v1/chat/completions") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        inferenceBody = JSON.parse(body);
        res.setHeader("Content-Type", "text/event-stream");
        res.end('data: {"id":"local","object":"chat.completion.chunk","created":1,"model":"freetoken-local","choices":[{"index":0,"delta":{"role":"assistant","content":"Connected"},"finish_reason":null}]}\n\ndata: {"id":"local","object":"chat.completion.chunk","created":1,"model":"freetoken-local","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      });
    } else { res.writeHead(404); res.end(); }
  });
  const dir = mkdtempSync(join(tmpdir(), "catui-local-setup-"));
  const oldDir = process.env.CATUI_CODING_AGENT_DIR;
  process.env.CATUI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (oldDir === undefined) delete process.env.CATUI_CODING_AGENT_DIR;
    else process.env.CATUI_CODING_AGENT_DIR = oldDir;
    rmSync(dir, { recursive: true, force: true });
  });
  const modelsPath = join(dir, "models.json");
  ensureCustomProtocolProvidersInModels(modelsPath);
  const authStorage = AuthStorage.inMemory();
  const registry = new ModelRegistry(authStorage, modelsPath, {
    useOnlyCustomModels: true,
    allowOptionalApiKeyForProvider: [CUSTOM_OPENAI_PROVIDER, "custom-anthropic"],
  });
  const flow = ui([url], ["Save configuration"]);
  let selected = "";
  const controller = new AuthProviderConfigController({
    modelRegistry: registry,
    surface: flow.surface as AuthProviderConfigSurface,
    modelBridge: {
      getCurrentModel: () => undefined,
      async setCurrentModel() {},
      showModelSelector() {},
      async applySelectedModel(model) { selected = model.id; },
      async updateAvailableProviderCount() {},
    },
  });
  await controller.handleProviderSelectionFromSelector(CUSTOM_OPENAI_PROVIDER, () => {});
  assert.deepEqual(flow.prompts, ["OpenAI-compatible server URL"]);
  assert.deepEqual(flow.errors, []);
  assert.equal(selected, "freetoken-local");
  assert.equal(discoveryAuth, undefined);
  ensureCustomProtocolProvidersInModels(modelsPath);
  registry.refresh();
  const model = registry.find(CUSTOM_OPENAI_PROVIDER, selected);
  assert.ok(model);
  assert.equal(model.baseUrl, `${url}/v1`);
  assert.equal(model.contextWindow, 32768);
  assert.equal(model.maxTokens, 4096);
  assert.equal(model.compat?.maxTokensField, "max_tokens");
  const key = await registry.getApiKey(model);
  assert.equal(key, NO_AUTH_API_KEY);
  assert.ok(registry.getAvailable().some((item) => item.id === selected));
  const result = await completeSimple(model, {
    messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
  }, { apiKey: key, maxTokens: 32 });
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.deepEqual(result.content, [{ type: "text", text: "Connected" }]);
  assert.equal(inferenceBody?.model, selected);
  assert.equal(inferenceBody?.max_tokens, 32);
  assert.equal(inferenceBody?.max_completion_tokens, undefined);
  assert.equal(inferenceBody?.store, undefined);

  const snapshot = readFileSync(modelsPath, "utf8");
  const canceled = ui([url], [undefined]);
  const cancelController = new AuthProviderConfigController({
    modelRegistry: registry,
    surface: canceled.surface as AuthProviderConfigSurface,
    modelBridge: { getCurrentModel: () => model, async setCurrentModel() {}, showModelSelector() {}, async applySelectedModel() { assert.fail("Canceled setup selected a model"); }, async updateAvailableProviderCount() {} },
  });
  await cancelController.handleProviderSelectionFromSelector(CUSTOM_OPENAI_PROVIDER, () => {});
  assert.equal(readFileSync(modelsPath, "utf8"), snapshot);
  assert.equal(await registry.getApiKey(model), key);
});

test("multiple models use endpoint IDs and absent metadata is labeled as defaults", async (t) => {
  const url = await server(t, (_req, res) => res.end(JSON.stringify({ data: [{ id: "a" }, { id: "b" }, { id: "b" }] })));
  const flow = ui([url], ["Model: b", "Save configuration"]);
  const draft = await collectOpenAIProviderSetup(flow.surface, previous);
  assert.equal(draft?.modelName, "b");
  assert.deepEqual(draft?.overrides, { contextWindow: 8192, maxTokens: 2048 });
  assert.equal(flow.menus[0].filter((item) => item === "Model: b").length, 1);
  assert.ok(flow.statuses.some((message) => message.includes("conservative default")));
  assert.ok(flow.menuTitles.some((title) => title.includes("Context 8192 (default)")));
});

test("an authentication challenge prompts for the real key and retries discovery", async (t) => {
  const headers: Array<string | undefined> = [];
  const url = await server(t, (req, res) => {
    headers.push(req.headers.authorization);
    if (req.headers.authorization !== "Bearer actual-key") { res.writeHead(401); res.end(); }
    else res.end(JSON.stringify({ data: [{ id: "private-model" }] }));
  });
  const flow = ui([url, "actual-key"], ["Save configuration"]);
  const draft = await collectOpenAIProviderSetup(flow.surface, { ...previous, apiKey: "old-secret" });
  assert.equal(draft?.apiKey, "actual-key");
  assert.deepEqual(headers, [undefined, "Bearer actual-key"]);
});

test("unsupported discovery offers explicit manual entry with an optional key", async (t) => {
  const url = await server(t, (_req, res) => { res.writeHead(404); res.end(); });
  const flow = ui([url, "", "served-id"], ["Enter model ID manually", "Save configuration"]);
  const draft = await collectOpenAIProviderSetup(flow.surface, previous);
  assert.equal(draft?.modelName, "served-id");
  assert.equal(draft?.apiKey, NO_AUTH_API_KEY);
  assert.ok(flow.statuses.some((message) => message.includes("HTTP 404")));
});

test("discovery can be retried after a transient failure", async (t) => {
  let attempts = 0;
  const url = await server(t, (_req, res) => {
    if (++attempts === 1) { res.writeHead(503); res.end(); }
    else res.end(JSON.stringify({ data: [{ id: "ready" }] }));
  });
  const flow = ui([url], ["Retry discovery", "Save configuration"]);
  assert.equal((await collectOpenAIProviderSetup(flow.surface, previous))?.modelName, "ready");
  assert.equal(attempts, 2);
});

test("saved credentials and limits are reused only for the same endpoint and model", async (t) => {
  const headers: Array<string | undefined> = [];
  const url = await server(t, (req, res) => { headers.push(req.headers.authorization); res.end(JSON.stringify({ data: [{ id: "same" }] })); });
  const saved = { baseUrl: `${url}/v1`, apiKey: "saved-key", modelName: "same", limits: { contextWindow: 16000, maxTokens: 2000 } };
  const same = ui([url], ["Save configuration"]);
  const draft = await collectOpenAIProviderSetup(same.surface, saved);
  assert.equal(draft?.apiKey, "saved-key");
  assert.deepEqual(draft?.overrides, saved.limits);
  const other = ui([url], ["Save configuration"]);
  const changed = await collectOpenAIProviderSetup(other.surface, { ...saved, baseUrl: "http://127.0.0.1:1/v1" });
  assert.equal(changed?.apiKey, NO_AUTH_API_KEY);
  assert.deepEqual(changed?.overrides, { contextWindow: 8192, maxTokens: 2048 });
  assert.deepEqual(headers, ["Bearer saved-key", undefined]);
});

test("limits can be adjusted; invalid output limits cannot be saved", async (t) => {
  const url = await server(t, (_req, res) => res.end(JSON.stringify({ data: [{ id: "small", context_length: 1024 }] })));
  const flow = ui([url, "1024", "1024", "4096", "512"], ["Adjust limits", "Adjust limits", "Save configuration"]);
  const draft = await collectOpenAIProviderSetup(flow.surface, previous);
  assert.deepEqual(draft?.overrides, { contextWindow: 4096, maxTokens: 512 });
  assert.equal(flow.errors.length, 1);
  assert.match(flow.menuTitles.at(-1) ?? "", /Context 4096 \(manual\)/);
});

test("public model discovery still lets users configure an inference API key", async (t) => {
  const url = await server(t, (_req, res) => res.end(JSON.stringify({ data: [{ id: "public-list" }] })));
  const flow = ui([url, "inference-key"], ["Change authentication", "Use API key", "Save configuration"]);
  assert.equal((await collectOpenAIProviderSetup(flow.surface, previous))?.apiKey, "inference-key");
});

test("URL normalization preserves API prefixes and rejects credentials or invalid schemes", () => {
  assert.equal(normalizeOpenAIBaseUrl(" http://localhost:1919/ "), "http://localhost:1919/v1");
  assert.equal(normalizeOpenAIBaseUrl("http://[::1]:1919/v1/chat/completions"), "http://[::1]:1919/v1");
  assert.equal(normalizeOpenAIBaseUrl("https://example.com/proxy/v2/models"), "https://example.com/proxy/v2");
  for (const value of ["", "file:///tmp/model", "http://user:secret@localhost:123", "http://localhost:123?key=secret"]) {
    assert.throws(() => normalizeOpenAIBaseUrl(value));
  }
});

test("inspection reports malformed responses and enforces its deadline", async (t) => {
  const malformed = await server(t, (_req, res) => res.end('{"unexpected":true}'));
  assert.match((await inspectOpenAIModels(`${malformed}/v1`)).error ?? "", /model list/);
  const stalled = await server(t, () => {});
  const result = await inspectOpenAIModels(`${stalled}/v1`, undefined, { timeoutMs: 20 });
  assert.match(result.error ?? "", /timed out/);
});
