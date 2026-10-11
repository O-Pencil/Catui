/**
 * [WHO]: Regressions for deployed KV limits, fixed-prompt validation and small-model compaction
 * [FROM]: Depends on HTTP fixtures, AI streams, model discovery and runtime/session budget owners
 * [TO]: Consumed by node:test and local-context-budget acceptance checks
 * [HERE]: test/local-model-context-budget.test.ts - local deployment budget contracts
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { type TestContext } from "node:test";
import { Type } from "@sinclair/typebox";
import { Agent, type StreamFn } from "@catui/agent-core";
import type { Context, Model } from "@catui/ai/types";
import { createAssistantMessageEventStream } from "@catui/ai/events";
import { inspectOpenAIModels } from "../core/model/discovery.js";
import { createLocalModelStream } from "../core/runtime/local-model-budget.js";
import { resolveCompactionBudget } from "../core/session/compaction/budget.js";
import { DEFAULT_COMPACTION_SETTINGS, generateSummary } from "../core/session/compaction/compaction.js";

async function fixture(t: TestContext) {
  const state = {
    owner: "FreeToken", model: "local", context: 131072, fixedTokens: 23691,
    cacheStatus: 200, countStatus: 200, cache: { state: "serving", geometry: { num_pages: 8606, page_size: 1 } },
    requests: [] as Array<{ path: string; auth?: string; body?: any }>,
  };
  const server = createServer((req, res) => {
    const record = { path: req.url!, auth: req.headers.authorization, body: undefined as any };
    state.requests.push(record);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/custom/v1/models") {
      res.end(JSON.stringify({ data: [{ id: state.model, owned_by: state.owner, context_length: state.context }] }));
    } else if (req.url === "/custom/v1/cache/status") {
      res.statusCode = state.cacheStatus;
      res.end(JSON.stringify(state.cache));
    } else if (req.url === "/custom/v1/chat/completions") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        record.body = JSON.parse(body);
        res.setHeader("Content-Type", "text/event-stream");
        res.end('data: {"id":"sum","object":"chat.completion.chunk","created":1,"model":"local","choices":[{"index":0,"delta":{"role":"assistant","content":"summary"},"finish_reason":null}]}\n\ndata: {"id":"sum","object":"chat.completion.chunk","created":1,"model":"local","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      });
    } else if (req.url === "/custom/v1/messages/count_tokens") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        record.body = JSON.parse(body);
        res.statusCode = state.countStatus;
        res.end(JSON.stringify({ input_tokens: state.fixedTokens }));
      });
    } else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/custom/v1`;
  const model: Model<"openai-completions"> = {
    id: "local", name: "Local", api: "openai-completions", provider: "custom-openai", baseUrl,
    input: ["text"], reasoning: false, contextWindow: 131072, maxTokens: 2048,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  let calls = 0;
  const captured: Array<Parameters<StreamFn>> = [];
  const raw: StreamFn = (...args) => {
    calls++; captured.push(args); return createAssistantMessageEventStream();
  };
  return { state, baseUrl, model, raw, captured, calls: () => calls };
}

const context: Context = {
  systemPrompt: "Preserve all project instructions.",
  tools: [{ name: "read", description: "Read a file", parameters: Type.Object({ path: Type.String() }) }],
  messages: [{ role: "user", content: "hi", timestamp: 0 }],
};

test("discovery clamps advertised context to allocated KV tokens and retains API prefix/auth", async (t) => {
  const f = await fixture(t);
  const result = await inspectOpenAIModels(f.baseUrl, "test-key");
  assert.equal(result.models[0].contextWindow, 8606);
  assert.equal(result.models[0].contextLimitSource, "kv-cache");
  assert.deepEqual(f.state.requests.map((r) => r.path), ["/custom/v1/models", "/custom/v1/cache/status"]);
  assert.ok(f.state.requests.every((r) => r.auth === "Bearer test-key"));
  f.state.cache.geometry = { num_pages: 100000, page_size: 2 };
  assert.equal((await inspectOpenAIModels(f.baseUrl)).models[0].contextWindow, 131072);
});

test("optional capacity failures, loading and invalid geometry preserve advertised context", async (t) => {
  const f = await fixture(t);
  for (const cache of [
    { state: "loading", geometry: { num_pages: 8606, page_size: 1 } },
    { state: "serving", geometry: { num_pages: 0, page_size: 1 } },
    { state: "serving", geometry: { num_pages: 8.5, page_size: 1 } },
    { state: "serving", geometry: { num_pages: Number.MAX_SAFE_INTEGER, page_size: 2 } },
  ]) {
    f.state.cache = cache;
    const result = await inspectOpenAIModels(f.baseUrl);
    assert.equal(result.models[0].contextWindow, 131072);
    assert.equal(result.models[0].contextLimitSource, undefined);
  }
  f.state.cacheStatus = 404;
  assert.equal((await inspectOpenAIModels(f.baseUrl)).models[0].contextWindow, 131072);
  f.state.owner = "ordinary-server";
  f.state.requests.length = 0;
  await inspectOpenAIModels(f.baseUrl);
  assert.equal(f.state.requests.length, 1);
});

test("fixed prompt overflow stops before inference with instructions/tools intact", async (t) => {
  const f = await fixture(t);
  const wrapped = createLocalModelStream(f.raw);
  await assert.rejects(async () => wrapped(f.model, context, { apiKey: "catui-no-auth" }), /History compaction cannot reduce/);
  assert.equal(f.calls(), 0);
  assert.equal(f.model.contextWindow, 8606);
  const count = f.state.requests.find((r) => r.path.endsWith("count_tokens"))!;
  assert.equal(count.auth, undefined);
  assert.equal(count.body.system, context.systemPrompt);
  assert.deepEqual(count.body.tools[0].input_schema, JSON.parse(JSON.stringify(context.tools![0].parameters)));
  assert.equal(context.messages[0].content, "hi");
});

test("agent surfaces the preflight diagnostic without overflow-recovery attempts", async (t) => {
  const f = await fixture(t);
  const agent = new Agent({
    initialState: { model: f.model, systemPrompt: context.systemPrompt, tools: [] },
    streamFn: createLocalModelStream(f.raw),
  });
  let recoveries = 0;
  agent.setModelErrorRecovery(async () => { recoveries++; return { action: "stop" }; });
  await agent.prompt("hi");
  assert.match(agent.state.error ?? "", /History compaction cannot reduce/);
  assert.equal(recoveries, 0);
  assert.equal(f.calls(), 0);
});

test("refresh tracks shrink/expansion, caches fixed tokens, and retains last valid capacity on failure", async (t) => {
  const f = await fixture(t);
  let now = 0;
  f.state.cache.geometry.num_pages = 32768;
  const wrapped = createLocalModelStream(f.raw, () => now);
  await wrapped(f.model, context, { apiKey: "test-key" });
  await wrapped(f.model, context, { apiKey: "test-key" });
  assert.equal(f.state.requests.length, 3);
  assert.equal(f.calls(), 2);
  assert.equal(f.captured[0][1], context);
  assert.equal(f.model.contextWindow, 32768);
  now = 30001;
  f.state.cache.geometry.num_pages = 8606;
  await assert.rejects(async () => wrapped(f.model, context, { apiKey: "test-key" }), /deployment context is 8606/);
  now += 30001;
  f.state.cacheStatus = 503;
  await assert.rejects(async () => wrapped(f.model, context, { apiKey: "test-key" }), /deployment context is 8606/);
  now += 30001;
  f.state.cacheStatus = 200;
  f.state.cache.geometry.num_pages = 65536;
  await wrapped(f.model, context, { apiKey: "test-key" });
  assert.equal(f.model.contextWindow, 65536);
});

test("output reserve is included; changed fixed content is retokenized; history is untouched", async (t) => {
  const f = await fixture(t);
  f.state.fixedTokens = 8100;
  const wrapped = createLocalModelStream(f.raw);
  await assert.rejects(async () => wrapped(f.model, context), /output reserve is 2048/);
  await wrapped(f.model, context, { maxTokens: 100 });
  const changed = { ...context, systemPrompt: "Different instructions", messages: [...context.messages] };
  f.state.fixedTokens = 100;
  await wrapped(f.model, changed, { maxTokens: 100 });
  assert.equal(f.state.requests.filter((r) => r.path.endsWith("count_tokens")).length, 2);
  assert.equal(f.captured[1][1], changed);
});

test("unsupported tokenizer, ordinary/custom cloud providers and cancellation preserve streaming", async (t) => {
  const f = await fixture(t);
  f.state.countStatus = 404;
  const wrapped = createLocalModelStream(f.raw);
  await wrapped(f.model, context);
  assert.equal(f.calls(), 1);
  f.state.requests.length = 0;
  await wrapped({ ...f.model, provider: "openai" }, context);
  assert.equal(f.state.requests.length, 0);
  await wrapped(f.model, context, { signal: AbortSignal.abort() });
  assert.equal(f.state.requests.length, 0);
  f.state.owner = "other";
  await createLocalModelStream(f.raw)(f.model, context);
  assert.deepEqual(f.state.requests.map((r) => r.path), ["/custom/v1/models"]);
});

test("model switching keeps deployment budgets separate and respects a smaller declared limit", async (t) => {
  const f = await fixture(t);
  f.state.fixedTokens = 100;
  f.state.cache.geometry.num_pages = 32768;
  const wrapped = createLocalModelStream(f.raw);
  const smaller = { ...f.model, contextWindow: 4096 };
  await wrapped(smaller, context);
  assert.equal(smaller.contextWindow, 4096);
  f.state.model = "second";
  f.state.cache.geometry.num_pages = 16384;
  const second = { ...f.model, id: "second" };
  await wrapped(second, context);
  assert.equal(second.contextWindow, 16384);
  assert.equal(f.model.contextWindow, 131072);
});

test("compaction follows the selected model without changing persisted settings or cloud defaults", () => {
  const settings = { ...DEFAULT_COMPACTION_SETTINGS };
  assert.deepEqual(resolveCompactionBudget(settings, { contextWindow: 32768 }), {
    enabled: true, reserveTokens: 4096, keepRecentTokens: 4096,
  });
  assert.equal(resolveCompactionBudget(settings, { contextWindow: 8606 }).reserveTokens, 1075);
  assert.equal(resolveCompactionBudget(settings, { contextWindow: 131072 }), settings);
  assert.equal(resolveCompactionBudget(settings, { contextWindow: 1000000 }), settings);
  assert.equal(resolveCompactionBudget(settings, undefined), settings);
  assert.equal(resolveCompactionBudget({ ...settings, reserveTokens: 100 }, { contextWindow: 8192 }).reserveTokens, 100);
  assert.deepEqual(settings, DEFAULT_COMPACTION_SETTINGS);
});

test("summary generation respects the model output maximum", async (t) => {
  const f = await fixture(t);
  const messages = [{ role: "user" as const, content: "hi", timestamp: 0 }];
  assert.equal(await generateSummary(messages, f.model, 16384, "test-key"), "summary");
  const requests = f.state.requests.filter((r) => r.path.endsWith("chat/completions"));
  assert.equal(requests.length, 1);
  for (const request of requests) {
    assert.equal(request.body.max_tokens ?? request.body.max_completion_tokens, 2048);
  }
});
