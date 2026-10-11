/**
 * [WHO]: createLocalModelStream() refreshes deployment limits and checks fixed prompt budgets
 * [FROM]: Depends on agent-core StreamFn, model discovery/capacity and custom provider constants
 * [TO]: Consumed by sdk.ts and local-model context budget regression tests
 * [HERE]: core/runtime/local-model-budget.ts - validation at the final request boundary
 */
import { createHash } from "node:crypto";
import type { StreamFn } from "@catui/agent-core";
import type { Model } from "@catui/ai/types";
import { CUSTOM_OPENAI_PROVIDER, NO_AUTH_API_KEY } from "../model/custom-providers.js";
import { inspectOpenAIModels } from "../model/discovery.js";
import { countFreeTokenFixedTokens } from "../model/freetoken-capacity.js";

interface Deployment {
  expires: number;
  freeToken: boolean;
  capacity?: number;
  fixed?: { key: string; tokens: number };
}

/** Session-local metadata cache; no persisted config changes or generation calls. */
export function createLocalModelStream(stream: StreamFn, now = Date.now): StreamFn {
  const deployments = new Map<string, Deployment>();
  const declaredWindows = new WeakMap<Model<any>, number>();
  return async (model, context, options) => {
    if (model.provider !== CUSTOM_OPENAI_PROVIDER || model.api !== "openai-completions" || options?.signal?.aborted) {
      return stream(model, context, options);
    }
    const apiKey = options?.apiKey === NO_AUTH_API_KEY ? undefined : options?.apiKey;
    const key = createHash("sha256").update(JSON.stringify([model.baseUrl, model.id, apiKey])).digest("hex");
    let deployment = deployments.get(key);
    if (!deployment || deployment.expires <= now()) {
      const result = await inspectOpenAIModels(model.baseUrl, apiKey, { timeoutMs: 3000, signal: options?.signal });
      const found = result.models.find((item) => item.id === model.id);
      deployment = {
        expires: now() + 30000,
        freeToken: found ? found.ownedBy?.toLowerCase() === "freetoken" : deployment?.freeToken ?? false,
        // Retain the last known allocation if optional cache metadata is temporarily unavailable.
        capacity: found?.contextLimitSource === "kv-cache" ? found.contextWindow : deployment?.capacity,
      };
      // Bound cache growth when callers cycle endpoints, credentials or models.
      if (deployments.size >= 8) deployments.delete(deployments.keys().next().value!);
      deployments.set(key, deployment);
    }
    if (!deployment.freeToken || options?.signal?.aborted) return stream(model, context, options);
    if (!declaredWindows.has(model)) declaredWindows.set(model, model.contextWindow);
    if (deployment.capacity !== undefined) {
      // The loop's model is also the session model: footer and compaction see this limit.
      model.contextWindow = Math.min(declaredWindows.get(model)!, deployment.capacity);
    }
    const fixedKey = createHash("sha256").update(JSON.stringify([context.systemPrompt, context.tools])).digest("hex");
    let fixedTokens = deployment.fixed?.key === fixedKey ? deployment.fixed.tokens : undefined;
    if (fixedTokens === undefined) {
      fixedTokens = await countFreeTokenFixedTokens(model.baseUrl, model.id, context, apiKey, options?.signal);
      if (fixedTokens !== undefined) deployment.fixed = { key: fixedKey, tokens: fixedTokens };
    }
    if (options?.signal?.aborted) return stream(model, context, options);
    const output = Math.min(options?.maxTokens ?? model.maxTokens, model.maxTokens);
    if (fixedTokens !== undefined && fixedTokens + output > model.contextWindow) {
      throw new Error(
        `Local model request cannot fit: fixed system instructions and tool definitions ` +
        `(including minimal user-message overhead) need ${fixedTokens} tokens; ` +
        `output reserve is ${output}; deployment context is ${model.contextWindow}. ` +
        `History compaction cannot reduce this fixed content. Increase the server's KV cache budget, ` +
        `reduce output limits, or explicitly reduce loaded tools, skills and project context. ` +
        `No instructions or tools were removed.`,
      );
    }
    return stream(model, context, { ...options, maxTokens: output });
  };
}
