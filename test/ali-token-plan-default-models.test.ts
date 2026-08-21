/**
 * [WHO]: Tests Ali Token Plan default and generated model catalog entries
 * [FROM]: Depends on node:test, node:assert, catui-defaults, generated model catalogs
 * [TO]: Consumed by `node --test` test runner
 * [HERE]: test/ali-token-plan-default-models.test.ts - default provider model coverage
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	CATUI_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER,
	CATUI_ALI_TOKEN_PLAN_OPENAI_PROVIDER,
	CATUI_DEFAULT_MODELS_JSON,
} from "../catui-defaults.ts";
import { MODELS } from "../core/lib/ai/src/models.generated.ts";
import { GENERATED_KNOWN_MODELS } from "../core/model/known-models.generated.ts";

describe("Ali Token Plan default models", () => {
	it("includes Qwen3.8 Max in both OpenAI and Anthropic compatible providers", () => {
		const openaiModel = CATUI_DEFAULT_MODELS_JSON.providers[
			CATUI_ALI_TOKEN_PLAN_OPENAI_PROVIDER
		].models.find((model) => model.id === "qwen3.8-max");
		const anthropicModel = CATUI_DEFAULT_MODELS_JSON.providers[
			CATUI_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER
		].models.find((model) => model.id === "qwen3.8-max");

		assert.deepEqual(openaiModel, {
			id: "qwen3.8-max",
			name: "Qwen3.8 Max (Ali Token Plan OpenAI)",
			reasoning: true,
			input: ["text", "image"],
			compat: {
				supportsStore: false,
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
			},
			contextWindow: 1000000,
			maxTokens: 131072,
		});
		assert.deepEqual(anthropicModel, {
			id: "qwen3.8-max",
			name: "Qwen3.8 Max (Ali Token Plan Anthropic)",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 1000000,
			maxTokens: 131072,
		});
		assert.equal(
			MODELS[CATUI_ALI_TOKEN_PLAN_OPENAI_PROVIDER]["qwen3.8-max"].maxTokens,
			131072,
		);
		assert.equal(
			MODELS[CATUI_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER]["qwen3.8-max"].maxTokens,
			131072,
		);
		const knownModels = GENERATED_KNOWN_MODELS.filter((model) => model.id === "qwen3.8-max");
		assert.deepEqual(
			knownModels.map((model) => model.api).sort(),
			["anthropic-messages", "openai-completions"],
		);
		assert.ok(knownModels.every((model) => model.maxTokens === 131072));
		assert.ok(knownModels.every((model) => model.input.includes("image")));
	});
});
