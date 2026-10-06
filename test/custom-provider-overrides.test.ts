/**
 * [WHO]: Tests for saveCustomProtocolProviderConfig / getCustomProtocolProviderModelLimits overrides flow
 * [FROM]: Depends on node:test, node:fs, node:os, node:path, core/model/custom-providers
 * [TO]: Consumed by `node --test` test runner
 * [HERE]: test/custom-provider-overrides.test.ts — runtime contract for custom provider overrides
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CUSTOM_ANTHROPIC_PROVIDER,
  CUSTOM_OPENAI_PROVIDER,
  saveCustomProtocolProviderConfig,
  getCustomProtocolProviderModelLimits,
  ensureCustomProtocolProvidersInModels,
} from "../core/model/custom-providers.ts";

describe("custom provider overrides", () => {
  let dir: string;
  let modelsPath: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "catui-custom-providers-"));
    modelsPath = join(dir, "models.json");
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists manual contextWindow and maxTokens overrides for custom-anthropic", async () => {
    await saveCustomProtocolProviderConfig(modelsPath, CUSTOM_ANTHROPIC_PROVIDER, {
      baseUrl: "https://example.invalid/v1",
      modelName: "kimi-k2",
      overrides: { contextWindow: 8192, maxTokens: 1024 },
    });

    const limits = getCustomProtocolProviderModelLimits(modelsPath, CUSTOM_ANTHROPIC_PROVIDER);
    assert.equal(limits.contextWindow, 8192);
    assert.equal(limits.maxTokens, 1024);

    const raw = JSON.parse(readFileSync(modelsPath, "utf-8")) as {
      providers: Record<string, { models: Array<Record<string, unknown>> }>;
    };
    const model = raw.providers[CUSTOM_ANTHROPIC_PROVIDER]?.models?.[0];
    assert.equal(model?.contextWindow, 8192);
    assert.equal(model?.maxTokens, 1024);
  });

  it("falls back to probed values when overrides are absent", async () => {
    await saveCustomProtocolProviderConfig(modelsPath, CUSTOM_ANTHROPIC_PROVIDER, {
      baseUrl: "https://example.invalid/v1",
      modelName: "kimi-k2",
      overrides: { contextWindow: 64000, maxTokens: 8000 },
    });

    // Second save with no overrides: should keep the previously persisted values,
    // not overwrite with defaults. Anthropic probe returns null so without overrides
    // the previously persisted values would be wiped; verify the API retains them.
    await saveCustomProtocolProviderConfig(modelsPath, CUSTOM_ANTHROPIC_PROVIDER, {
      baseUrl: "https://example.invalid/v1",
      modelName: "kimi-k2",
    });

    const limits = getCustomProtocolProviderModelLimits(modelsPath, CUSTOM_ANTHROPIC_PROVIDER);
    // Anthropic probe is null, so without overrides we keep the stored values.
    assert.equal(limits.contextWindow, 64000);
    assert.equal(limits.maxTokens, 8000);
  });

  it("rejects empty baseUrl and modelName", async () => {
    await assert.rejects(
      saveCustomProtocolProviderConfig(modelsPath, CUSTOM_OPENAI_PROVIDER, {
        baseUrl: "   ",
        modelName: "anything",
        overrides: { contextWindow: 1000, maxTokens: 100 },
      }),
      /Base URL/,
    );
    await assert.rejects(
      saveCustomProtocolProviderConfig(modelsPath, CUSTOM_OPENAI_PROVIDER, {
        baseUrl: "https://example.invalid/v1",
        modelName: "",
        overrides: { contextWindow: 1000, maxTokens: 100 },
      }),
      /Model name/,
    );
  });

  it("ensureCustomProtocolProvidersInModels seeds default models without breaking stored overrides", async () => {
    // First save with explicit overrides
    await saveCustomProtocolProviderConfig(modelsPath, CUSTOM_OPENAI_PROVIDER, {
      baseUrl: "https://example.invalid/v1",
      modelName: "gpt-test",
      overrides: { contextWindow: 16384, maxTokens: 2048 },
    });

    // Then re-run ensure; since stored config has version + 1 model, it should be a no-op
    // for the overrides we just set.
    ensureCustomProtocolProvidersInModels(modelsPath);

    const limits = getCustomProtocolProviderModelLimits(modelsPath, CUSTOM_OPENAI_PROVIDER);
    assert.equal(limits.contextWindow, 16384);
    assert.equal(limits.maxTokens, 2048);

    assert.ok(existsSync(modelsPath));
  });

  it("getCustomProtocolProviderModelLimits returns empty when no model is stored", () => {
    const freshPath = join(dir, "fresh-models.json");
    const limits = getCustomProtocolProviderModelLimits(freshPath, CUSTOM_ANTHROPIC_PROVIDER);
    assert.deepEqual(limits, {});
  });

  it("an explicit credential update removes a stale models.json key fallback", async () => {
    const path = join(dir, "legacy-key.json");
    writeFileSync(path, JSON.stringify({ providers: {
      [CUSTOM_OPENAI_PROVIDER]: { baseUrl: "https://old.invalid/v1", apiKey: "old-secret" },
    } }));
    await saveCustomProtocolProviderConfig(path, CUSTOM_OPENAI_PROVIDER, {
      baseUrl: "http://127.0.0.1:1919/v1",
      modelName: "local",
      apiKey: "catui-no-auth",
      compat: { maxTokensField: "max_tokens" },
      overrides: { contextWindow: 8192, maxTokens: 2048 },
    });
    const raw = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(raw.providers[CUSTOM_OPENAI_PROVIDER].apiKey, undefined);
    ensureCustomProtocolProvidersInModels(path);
    const bootstrapped = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(bootstrapped.providers[CUSTOM_OPENAI_PROVIDER].models[0].compat.maxTokensField, "max_tokens");
  });
});
