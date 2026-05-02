/**
 * [WHO]: Provider constants, ensureNanopencilDefaultConfig(), ensureNanopencilCodingPlanAuth()
 * [FROM]: Depends on node:fs, node:path, ai, config
 * [TO]: Consumed by main.ts
 * [HERE]: nanopencil-defaults.ts - default configuration for Chinese AI providers
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { getAgentDir, getModelsPath } from "./config.js";
import { ensureCustomProtocolProvidersInModels } from "./core/custom-providers.js";
import type { AuthStorage } from "./core/config/auth-storage.js";
import type { ModelRegistry } from "./core/model-registry.js";

export const NANOPENCIL_DEFAULT_PROVIDER = "dashscope-coding";
const CODING_PLAN_BASE_URL = "https://coding.dashscope.aliyuncs.com/v1";

/** Baidu Qianfan Coding Plan provider, OpenAI compatible interface: https://qianfan.baidubce.com/v2/coding/chat/completions */
export const NANOPENCIL_QIANFAN_CODING_PROVIDER = "qianfan-coding";
const QIANFAN_CODING_BASE_URL = "https://qianfan.baidubce.com/v2/coding";

/** Volcano Ark Coding Plan provider, OpenAI compatible interface: https://ark.cn-beijing.volces.com/api/coding/v3 */
export const NANOPENCIL_ARK_CODING_PROVIDER = "ark-coding";
const ARK_CODING_BASE_URL = "https://ark.cn-beijing.volces.com/api/coding/v3";

/** MiniMax Coding Plan provider, OpenAI compatible interface: https://api.minimaxi.com/v1 */
export const NANOPENCIL_MINIMAX_CODING_PROVIDER = "minimax-coding";
const MINIMAX_CODING_BASE_URL = "https://api.minimaxi.com/v1";

/** Zhipu Coding Plan provider, OpenAI compatible interface: https://open.bigmodel.cn/api/paas/v4 */
export const NANOPENCIL_ZHIPU_CODING_PROVIDER = "zhipu-coding";
const ZHIPU_CODING_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

/** Alibaba Cloud Token Plan Team Edition, OpenAI compatible protocol. */
export const NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER = "ali-token-plan-openai";
const ALI_TOKEN_PLAN_OPENAI_BASE_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

/** Alibaba Cloud Token Plan Team Edition, Anthropic compatible protocol. */
export const NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER = "ali-token-plan-anthropic";
const ALI_TOKEN_PLAN_ANTHROPIC_BASE_URL = "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic";

/** Custom Anthropic-compatible provider; users may set baseUrl and apiKey for third-party Anthropic-compatible services. */
export const NANOPENCIL_ANTHROPIC_CUSTOM_PROVIDER = "anthropic-custom";
const ANTHROPIC_CUSTOM_DEFAULT_BASE_URL = "https://api.anthropic.com";

/** Ollama local model provider, consistent with nanoPencil docs: baseUrl with /v1, apiKey can be any value. */
export const NANOPENCIL_OLLAMA_PROVIDER = "ollama";
const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * What's new message displayed in TUI header at startup (about 50 words). Update on release.
 */
export const NANOPENCIL_WHATS_NEW =
	"Lightweight CLI writing agent: read, write, edit, bash. DashScope, Ali Token Plan, Qianfan, Ark Coding Plan, local Ollama. Optional nanomem. Type / for commands, ! for bash. Config in ~/.nanopencil/agent/.";

type DefaultModelDef =
	(typeof NANOPENCIL_DEFAULT_MODELS_JSON.providers)[typeof NANOPENCIL_DEFAULT_PROVIDER]["models"][number];

type QianfanModelDef =
	(typeof NANOPENCIL_DEFAULT_MODELS_JSON.providers)[typeof NANOPENCIL_QIANFAN_CODING_PROVIDER]["models"][number];

type ArkModelDef =
	(typeof NANOPENCIL_DEFAULT_MODELS_JSON.providers)[typeof NANOPENCIL_ARK_CODING_PROVIDER]["models"][number];

type MinimaxModelDef =
	(typeof NANOPENCIL_DEFAULT_MODELS_JSON.providers)[typeof NANOPENCIL_MINIMAX_CODING_PROVIDER]["models"][number];

type ZhipuModelDef =
	(typeof NANOPENCIL_DEFAULT_MODELS_JSON.providers)[typeof NANOPENCIL_ZHIPU_CODING_PROVIDER]["models"][number];

type AliTokenPlanOpenAIModelDef =
	(typeof NANOPENCIL_DEFAULT_MODELS_JSON.providers)[typeof NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER]["models"][number];

type AliTokenPlanAnthropicModelDef =
	(typeof NANOPENCIL_DEFAULT_MODELS_JSON.providers)[typeof NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER]["models"][number];

/** Default models.json content: dashscope-coding (Bailian), qianfan-coding (Qianfan), ark-coding (Ark), minimax-coding (MiniMax), zhipu-coding (Zhipu) + ollama (local). Each Coding Plan has no apiKey, user input stored in auth.json; ollama uses placeholder "ollama". */
export const NANOPENCIL_DEFAULT_MODELS_JSON = {
	providers: {
		[NANOPENCIL_DEFAULT_PROVIDER]: {
			baseUrl: CODING_PLAN_BASE_URL,
			api: "openai-completions",
			models: [
				{
					id: "qwen3.5-plus",
					name: "Qwen3.5 Plus",
					input: ["text", "image"],
					contextWindow: 1000000,
					maxTokens: 65536,
				},
				{
					id: "qwen3.6-plus",
					name: "Qwen3.6 Plus",
					input: ["text", "image"],
					contextWindow: 1000000,
					maxTokens: 65536,
				},
				{
					id: "qwen3-max-2026-01-23",
					name: "Qwen3 Max",
					input: ["text"],
					contextWindow: 262144,
					maxTokens: 65536,
				},
				{
					id: "qwen3-coder-next",
					name: "Qwen3 Coder Next",
					input: ["text"],
					contextWindow: 262144,
					maxTokens: 65536,
				},
				{
					id: "qwen3-coder-plus",
					name: "Qwen3 Coder Plus",
					input: ["text"],
					contextWindow: 1000000,
					maxTokens: 65536,
				},
				{
					id: "MiniMax-M2.5",
					name: "MiniMax-M2.5",
					input: ["text"],
					contextWindow: 1000000,
					maxTokens: 65536,
				},
				{
					id: "glm-5",
					name: "GLM-5",
					input: ["text"],
					contextWindow: 202752,
					maxTokens: 16384,
				},
				{
					id: "glm-4.7",
					name: "GLM-4.7",
					input: ["text"],
					contextWindow: 202752,
					maxTokens: 16384,
				},
				{
					id: "kimi-k2.5",
					name: "Kimi K2.5",
					input: ["text", "image"],
					contextWindow: 262144,
					maxTokens: 32768,
				},
			],
		},
		[NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER]: {
			baseUrl: ALI_TOKEN_PLAN_OPENAI_BASE_URL,
			api: "openai-completions",
			models: [
				{
					id: "qwen3.6-plus",
					name: "Qwen3.6 Plus (Ali Token Plan OpenAI)",
					reasoning: true,
					input: ["text"],
					compat: {
						supportsStore: false,
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
					},
					contextWindow: 262144,
					maxTokens: 65536,
				},
				{
					id: "glm-5",
					name: "GLM-5 (Ali Token Plan OpenAI)",
					reasoning: true,
					input: ["text"],
					compat: {
						supportsStore: false,
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
					},
					contextWindow: 202752,
					maxTokens: 16384,
				},
				{
					id: "MiniMax-M2.5",
					name: "MiniMax M2.5 (Ali Token Plan OpenAI)",
					reasoning: true,
					input: ["text"],
					compat: {
						supportsStore: false,
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
					},
					contextWindow: 204800,
					maxTokens: 65536,
				},
				{
					id: "deepseek-v3.2",
					name: "DeepSeek V3.2 (Ali Token Plan OpenAI)",
					reasoning: false,
					input: ["text"],
					compat: {
						supportsStore: false,
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
					},
					contextWindow: 262144,
					maxTokens: 65536,
				},
			],
		},
		[NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER]: {
			baseUrl: ALI_TOKEN_PLAN_ANTHROPIC_BASE_URL,
			api: "anthropic-messages",
			models: [
				{
					id: "qwen3.6-plus",
					name: "Qwen3.6 Plus (Ali Token Plan Anthropic)",
					reasoning: true,
					input: ["text"],
					contextWindow: 262144,
					maxTokens: 65536,
				},
				{
					id: "glm-5",
					name: "GLM-5 (Ali Token Plan Anthropic)",
					reasoning: true,
					input: ["text"],
					contextWindow: 202752,
					maxTokens: 16384,
				},
				{
					id: "MiniMax-M2.5",
					name: "MiniMax M2.5 (Ali Token Plan Anthropic)",
					reasoning: true,
					input: ["text"],
					contextWindow: 204800,
					maxTokens: 65536,
				},
			],
		},
		[NANOPENCIL_MINIMAX_CODING_PROVIDER]: {
			baseUrl: MINIMAX_CODING_BASE_URL,
			api: "openai-completions",
			models: [
				{
					id: "MiniMax-M2.7",
					name: "MiniMax M2.7",
					input: ["text"],
					contextWindow: 204800,
					maxTokens: 65536,
				},
				{
					id: "MiniMax-M2.5",
					name: "MiniMax M2.5",
					input: ["text"],
					contextWindow: 204800,
					maxTokens: 65536,
				},
				{
					id: "MiniMax-M2.1",
					name: "MiniMax M2.1",
					input: ["text"],
					contextWindow: 204800,
					maxTokens: 65536,
				},
				{
					id: "MiniMax-M2",
					name: "MiniMax M2",
					input: ["text"],
					contextWindow: 204800,
					maxTokens: 65536,
				},
			],
		},
		[NANOPENCIL_ZHIPU_CODING_PROVIDER]: {
			baseUrl: ZHIPU_CODING_BASE_URL,
			api: "openai-completions",
			models: [
				{
					id: "glm-5",
					name: "GLM-5",
					input: ["text"],
					contextWindow: 202752,
					maxTokens: 16384,
				},
				{
					id: "glm-4.7",
					name: "GLM-4.7",
					input: ["text"],
					contextWindow: 202752,
					maxTokens: 16384,
				},
			],
		},
		[NANOPENCIL_QIANFAN_CODING_PROVIDER]: {
			baseUrl: QIANFAN_CODING_BASE_URL,
			api: "openai-completions",
			models: [
				{
					id: "kimi-k2.5",
					name: "Kimi K2.5 (Qianfan)",
					input: ["text", "image"],
					contextWindow: 262144,
					maxTokens: 32768,
				},
				{
					id: "deepseek-v3.2",
					name: "DeepSeek V3.2 (Qianfan)",
					input: ["text"],
					contextWindow: 262144,
					maxTokens: 65536,
				},
				{
					id: "glm-5",
					name: "GLM-5 (Qianfan)",
					input: ["text"],
					contextWindow: 202752,
					maxTokens: 16384,
				},
				{
					id: "MiniMax-M2.5",
					name: "MiniMax-M2.5 (Qianfan)",
					input: ["text"],
					contextWindow: 1000000,
					maxTokens: 65536,
				},
				{
					id: "glm-4.7",
					name: "GLM-4.7 (Qianfan)",
					input: ["text"],
					contextWindow: 202752,
					maxTokens: 16384,
				},
				{
					id: "MiniMax-M2.1",
					name: "MiniMax-M2.1 (Qianfan)",
					input: ["text"],
					contextWindow: 1000000,
					maxTokens: 65536,
				},
			],
		},
		[NANOPENCIL_ARK_CODING_PROVIDER]: {
			baseUrl: ARK_CODING_BASE_URL,
			api: "openai-completions",
			models: [
				{
					id: "doubao-seed-2.0-code",
					name: "Doubao Seed 2.0 Code (Ark)",
					input: ["text"],
					contextWindow: 262144,
					maxTokens: 65536,
				},
				{
					id: "doubao-seed-2.0-pro",
					name: "Doubao Seed 2.0 Pro (Ark)",
					input: ["text"],
					contextWindow: 262144,
					maxTokens: 65536,
				},
				{
					id: "doubao-seed-2.0-lite",
					name: "Doubao Seed 2.0 Lite (Ark)",
					input: ["text"],
					contextWindow: 262144,
					maxTokens: 32768,
				},
				{
					id: "doubao-seed-code",
					name: "Doubao Seed Code (Ark)",
					input: ["text"],
					contextWindow: 262144,
					maxTokens: 65536,
				},
				{
					id: "minimax-m2.5",
					name: "MiniMax M2.5 (Ark)",
					input: ["text"],
					contextWindow: 1000000,
					maxTokens: 65536,
				},
				{
					id: "glm-4.7",
					name: "GLM-4.7 (Ark)",
					input: ["text"],
					contextWindow: 202752,
					maxTokens: 16384,
				},
				{
					id: "deepseek-v3.2",
					name: "DeepSeek V3.2 (Ark)",
					input: ["text"],
					contextWindow: 262144,
					maxTokens: 65536,
				},
				{
					id: "kimi-k2.5",
					name: "Kimi K2.5 (Ark)",
					input: ["text", "image"],
					contextWindow: 262144,
					maxTokens: 32768,
				},
			],
		},
		[NANOPENCIL_ANTHROPIC_CUSTOM_PROVIDER]: {
			baseUrl: ANTHROPIC_CUSTOM_DEFAULT_BASE_URL,
			api: "anthropic-messages",
			models: [
				{
					id: "claude-sonnet-4-20250514",
					name: "Claude Sonnet 4",
					input: ["text", "image"],
					contextWindow: 200000,
					maxTokens: 16384,
				},
				{
					id: "claude-opus-4-20250514",
					name: "Claude Opus 4",
					input: ["text", "image"],
					contextWindow: 200000,
					maxTokens: 32000,
				},
				{
					id: "claude-3-5-sonnet-20241022",
					name: "Claude 3.5 Sonnet",
					input: ["text", "image"],
					contextWindow: 200000,
					maxTokens: 8192,
				},
				{
					id: "claude-3-5-haiku-20241022",
					name: "Claude 3.5 Haiku",
					input: ["text", "image"],
					contextWindow: 200000,
					maxTokens: 8192,
				},
			],
		},
		[NANOPENCIL_OLLAMA_PROVIDER]: {
			baseUrl: OLLAMA_BASE_URL,
			api: "openai-completions",
			apiKey: "ollama",
			models: [
				{ id: "llama3.2:3b", name: "Llama 3.2 3B", input: ["text"], contextWindow: 128000, maxTokens: 4096 },
				{
					id: "qwen2.5-coder:7b",
					name: "Qwen2.5 Coder 7B",
					input: ["text"],
					contextWindow: 32768,
					maxTokens: 8192,
				},
			],
		},
	},
} as const;

const DEFAULT_MODELS: DefaultModelDef[] = [
	...NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_DEFAULT_PROVIDER].models,
];

const DEFAULT_QIANFAN_MODELS: QianfanModelDef[] = [
	...NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_QIANFAN_CODING_PROVIDER].models,
];

const DEFAULT_ARK_MODELS: ArkModelDef[] = [
	...NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_ARK_CODING_PROVIDER].models,
];

const DEFAULT_MINIMAX_MODELS: MinimaxModelDef[] = [
	...NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_MINIMAX_CODING_PROVIDER].models,
];

const DEFAULT_ZHIPU_MODELS: ZhipuModelDef[] = [
	...NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_ZHIPU_CODING_PROVIDER].models,
];

const DEFAULT_ALI_TOKEN_PLAN_OPENAI_MODELS: AliTokenPlanOpenAIModelDef[] = [
	...NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER].models,
];

const DEFAULT_ALI_TOKEN_PLAN_ANTHROPIC_MODELS: AliTokenPlanAnthropicModelDef[] = [
	...NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER].models,
];

type AnthropicCustomModelDef =
	(typeof NANOPENCIL_DEFAULT_MODELS_JSON.providers)[typeof NANOPENCIL_ANTHROPIC_CUSTOM_PROVIDER]["models"][number];
const DEFAULT_ANTHROPIC_CUSTOM_MODELS: AnthropicCustomModelDef[] = [
	...NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_ANTHROPIC_CUSTOM_PROVIDER].models,
];

type OllamaModelDef =
	(typeof NANOPENCIL_DEFAULT_MODELS_JSON.providers)[typeof NANOPENCIL_OLLAMA_PROVIDER]["models"][number];
const DEFAULT_OLLAMA_MODELS: OllamaModelDef[] = [
	...NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_OLLAMA_PROVIDER].models,
];

/**
 * If models.json exists, merge default models: add missing models, and update contextWindow/maxTokens/input to official values.
 */
function mergeNanopencilModelsIfNeeded(modelsPath: string): void {
	let raw: string;
	try {
		raw = readFileSync(modelsPath, "utf-8");
	} catch {
		return;
	}
	let data: { providers?: Record<string, { baseUrl?: string; api?: string; apiKey?: string; models?: unknown[] }> };
	try {
		data = JSON.parse(raw);
	} catch {
		return;
	}
	if (!data.providers) data.providers = {};

	const mergeProviderModels = (
		providerName: string,
		providerConfig: { baseUrl: string; api: string },
		defaultModels: readonly Record<string, unknown>[],
	): void => {
		const existingProvider = data.providers![providerName];
		if (!existingProvider) {
			data.providers![providerName] = {
				baseUrl: providerConfig.baseUrl,
				api: providerConfig.api,
				models: defaultModels.map((m) => ({ ...m })),
			};
			writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
			return;
		}

		const models = (Array.isArray(existingProvider.models) ? [...existingProvider.models] : []) as Record<
			string,
			unknown
		>[];
		const byId = new Map<string, Record<string, unknown>>();
		for (const m of models) {
			const id = m?.id;
			if (typeof id === "string") byId.set(id, m);
		}

		let changed = false;
		if (typeof existingProvider.baseUrl !== "string" || !existingProvider.baseUrl.trim()) {
			existingProvider.baseUrl = providerConfig.baseUrl;
			changed = true;
		}
		if (typeof existingProvider.api !== "string" || !existingProvider.api.trim()) {
			existingProvider.api = providerConfig.api;
			changed = true;
		}

		for (const def of defaultModels) {
			const id = def.id;
			if (typeof id !== "string") continue;

			const existing = byId.get(id);
			if (!existing) {
				models.push({ ...def });
				byId.set(id, models[models.length - 1]);
				changed = true;
				continue;
			}

			for (const field of ["name", "reasoning", "contextWindow", "maxTokens"] as const) {
				if (existing[field] !== def[field]) {
					existing[field] = def[field];
					changed = true;
				}
			}
			if (JSON.stringify(existing.compat) !== JSON.stringify(def.compat)) {
				existing.compat = def.compat;
				changed = true;
			}
			if (JSON.stringify(existing.input) !== JSON.stringify(def.input)) {
				existing.input = def.input;
				changed = true;
			}
		}

		if (changed) {
			(data.providers![providerName] as { models: unknown[] }).models = models;
			writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
		}
	};

	const provider = data.providers[NANOPENCIL_DEFAULT_PROVIDER];
	const providerConfig = NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_DEFAULT_PROVIDER];

	if (!provider) {
		data.providers[NANOPENCIL_DEFAULT_PROVIDER] = {
			baseUrl: providerConfig.baseUrl,
			api: providerConfig.api,
			models: DEFAULT_MODELS.map((m) => ({ ...m })),
		};
		writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
		return;
	}

	const models = (Array.isArray(provider.models) ? [...provider.models] : []) as Record<string, unknown>[];
	const byId = new Map<string, Record<string, unknown>>();
	for (const m of models) {
		const id = m?.id;
		if (typeof id === "string") byId.set(id, m);
	}

	let changed = false;
	for (const def of DEFAULT_MODELS) {
		const id = def.id;
		const existing = byId.get(id);
		if (!existing) {
			models.push({ ...def });
			byId.set(id, models[models.length - 1]);
			changed = true;
		} else {
			if (existing.contextWindow !== def.contextWindow) {
				existing.contextWindow = def.contextWindow;
				changed = true;
			}
			if (existing.maxTokens !== def.maxTokens) {
				existing.maxTokens = def.maxTokens;
				changed = true;
			}
			if (JSON.stringify(existing.input) !== JSON.stringify(def.input)) {
				existing.input = def.input;
				changed = true;
			}
			if (existing.name !== def.name) {
				existing.name = def.name;
				changed = true;
			}
		}
	}

	if (changed) {
		(data.providers[NANOPENCIL_DEFAULT_PROVIDER] as { models: unknown[] }).models = models;
		writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
	}

	mergeProviderModels(
		NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER,
		NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER],
		DEFAULT_ALI_TOKEN_PLAN_OPENAI_MODELS,
	);
	mergeProviderModels(
		NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER,
		NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER],
		DEFAULT_ALI_TOKEN_PLAN_ANTHROPIC_MODELS,
	);

	// Merge qianfan-coding: add default config if not present, supplement default models if exists
	const qianfanProvider = data.providers[NANOPENCIL_QIANFAN_CODING_PROVIDER];
	const qianfanConfig = NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_QIANFAN_CODING_PROVIDER];
	if (!qianfanProvider) {
		data.providers[NANOPENCIL_QIANFAN_CODING_PROVIDER] = {
			baseUrl: qianfanConfig.baseUrl,
			api: qianfanConfig.api,
			models: DEFAULT_QIANFAN_MODELS.map((m) => ({ ...m })),
		};
		writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
	} else {
		const qianfanModels = (Array.isArray(qianfanProvider.models) ? [...qianfanProvider.models] : []) as Record<
			string,
			unknown
		>[];
		const qianfanById = new Map<string, Record<string, unknown>>();
		for (const m of qianfanModels) {
			const id = m?.id;
			if (typeof id === "string") qianfanById.set(id, m);
		}
		let qianfanChanged = false;
		for (const def of DEFAULT_QIANFAN_MODELS) {
			const id = def.id;
			const existing = qianfanById.get(id);
			if (!existing) {
				qianfanModels.push({ ...def });
				qianfanById.set(id, qianfanModels[qianfanModels.length - 1]);
				qianfanChanged = true;
			} else {
				if (existing.contextWindow !== def.contextWindow) {
					existing.contextWindow = def.contextWindow;
					qianfanChanged = true;
				}
				if (existing.maxTokens !== def.maxTokens) {
					existing.maxTokens = def.maxTokens;
					qianfanChanged = true;
				}
				if (JSON.stringify(existing.input) !== JSON.stringify(def.input)) {
					existing.input = def.input;
					qianfanChanged = true;
				}
				if (existing.name !== def.name) {
					existing.name = def.name;
					qianfanChanged = true;
				}
			}
		}
		if (qianfanChanged) {
			(data.providers[NANOPENCIL_QIANFAN_CODING_PROVIDER] as { models: unknown[] }).models = qianfanModels;
			writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
		}
	}

	// Merge ark-coding: add default config if not present, supplement default models if exists
	const arkProvider = data.providers[NANOPENCIL_ARK_CODING_PROVIDER];
	const arkConfig = NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_ARK_CODING_PROVIDER];
	if (!arkProvider) {
		data.providers[NANOPENCIL_ARK_CODING_PROVIDER] = {
			baseUrl: arkConfig.baseUrl,
			api: arkConfig.api,
			models: DEFAULT_ARK_MODELS.map((m) => ({ ...m })),
		};
		writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
	} else {
		const arkModels = (Array.isArray(arkProvider.models) ? [...arkProvider.models] : []) as Record<
			string,
			unknown
		>[];
		const arkById = new Map<string, Record<string, unknown>>();
		for (const m of arkModels) {
			const id = m?.id;
			if (typeof id === "string") arkById.set(id, m);
		}
		let arkChanged = false;
		for (const def of DEFAULT_ARK_MODELS) {
			const id = def.id;
			const existing = arkById.get(id);
			if (!existing) {
				arkModels.push({ ...def });
				arkById.set(id, arkModels[arkModels.length - 1]);
				arkChanged = true;
			} else {
				if (existing.contextWindow !== def.contextWindow) {
					existing.contextWindow = def.contextWindow;
					arkChanged = true;
				}
				if (existing.maxTokens !== def.maxTokens) {
					existing.maxTokens = def.maxTokens;
					arkChanged = true;
				}
				if (JSON.stringify(existing.input) !== JSON.stringify(def.input)) {
					existing.input = def.input;
					arkChanged = true;
				}
				if (existing.name !== def.name) {
					existing.name = def.name;
					arkChanged = true;
				}
			}
		}
		if (arkChanged) {
			(data.providers[NANOPENCIL_ARK_CODING_PROVIDER] as { models: unknown[] }).models = arkModels;
			writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
		}
	}

	// Merge minimax-coding: add default config if not present, supplement default models if exists
	const minimaxProvider = data.providers[NANOPENCIL_MINIMAX_CODING_PROVIDER];
	const minimaxConfig = NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_MINIMAX_CODING_PROVIDER];
	if (!minimaxProvider) {
		data.providers[NANOPENCIL_MINIMAX_CODING_PROVIDER] = {
			baseUrl: minimaxConfig.baseUrl,
			api: minimaxConfig.api,
			models: DEFAULT_MINIMAX_MODELS.map((m) => ({ ...m })),
		};
		writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
	} else {
		const minimaxModels = (Array.isArray(minimaxProvider.models) ? [...minimaxProvider.models] : []) as Record<
			string,
			unknown
		>[];
		const minimaxById = new Map<string, Record<string, unknown>>();
		for (const m of minimaxModels) {
			const id = m?.id;
			if (typeof id === "string") minimaxById.set(id, m);
		}
		let minimaxChanged = false;
		for (const def of DEFAULT_MINIMAX_MODELS) {
			const id = def.id;
			const existing = minimaxById.get(id);
			if (!existing) {
				minimaxModels.push({ ...def });
				minimaxById.set(id, minimaxModels[minimaxModels.length - 1]);
				minimaxChanged = true;
			} else {
				if (existing.contextWindow !== def.contextWindow) {
					existing.contextWindow = def.contextWindow;
					minimaxChanged = true;
				}
				if (existing.maxTokens !== def.maxTokens) {
					existing.maxTokens = def.maxTokens;
					minimaxChanged = true;
				}
				if (JSON.stringify(existing.input) !== JSON.stringify(def.input)) {
					existing.input = def.input;
					minimaxChanged = true;
				}
				if (existing.name !== def.name) {
					existing.name = def.name;
					minimaxChanged = true;
				}
			}
		}
		if (minimaxChanged) {
			(data.providers[NANOPENCIL_MINIMAX_CODING_PROVIDER] as { models: unknown[] }).models = minimaxModels;
			writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
		}
	}

	// Merge ollama: add default config if not present, supplement default models if exists
	const ollamaProvider = data.providers[NANOPENCIL_OLLAMA_PROVIDER];
	const ollamaConfig = NANOPENCIL_DEFAULT_MODELS_JSON.providers[NANOPENCIL_OLLAMA_PROVIDER];
	if (!ollamaProvider) {
		data.providers[NANOPENCIL_OLLAMA_PROVIDER] = {
			baseUrl: ollamaConfig.baseUrl,
			api: ollamaConfig.api,
			apiKey: ollamaConfig.apiKey,
			models: DEFAULT_OLLAMA_MODELS.map((m) => ({ ...m })),
		};
		writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
		return;
	}

	const ollamaModels = (Array.isArray(ollamaProvider.models) ? [...ollamaProvider.models] : []) as Record<
		string,
		unknown
	>[];
	const ollamaById = new Map<string, Record<string, unknown>>();
	for (const m of ollamaModels) {
		const id = m?.id;
		if (typeof id === "string") ollamaById.set(id, m);
	}
	let ollamaChanged = false;
	for (const def of DEFAULT_OLLAMA_MODELS) {
		const id = def.id;
		const existing = ollamaById.get(id);
		if (!existing) {
			ollamaModels.push({ ...def });
			ollamaById.set(id, ollamaModels[ollamaModels.length - 1]);
			ollamaChanged = true;
		} else {
			if (existing.contextWindow !== def.contextWindow) {
				existing.contextWindow = def.contextWindow;
				ollamaChanged = true;
			}
			if (existing.maxTokens !== def.maxTokens) {
				existing.maxTokens = def.maxTokens;
				ollamaChanged = true;
			}
			if (existing.name !== def.name) {
				existing.name = def.name;
				ollamaChanged = true;
			}
		}
	}
	if (ollamaChanged) {
		(data.providers[NANOPENCIL_OLLAMA_PROVIDER] as { models: unknown[] }).models = ollamaModels;
		writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
	}
}

/**
 * Ensure nano-pencil default config exists: create agent directory, write defaults if models.json not present (Coding Plan only);
 * If exists, merge default models (add qwen3.5-plus etc and update contextWindow/maxTokens).
 * Write default global context if .PENCIL.md not present, users can bring nano-pencil description on install.
 * Only called when running as nanopencil.
 */
export const DEFAULT_PENCIL_MD = `# nano-pencil Global Context · Versatile Human-like Assistant

You are a **versatile human-like AI assistant**, collaborating with users in the same workflow: programming, writing, reasoning, planning, explaining, refactoring, debugging - all within your capability, communicating naturally, concisely, and directly.

## Positioning
- **Versatile**: Not limited to "only coding" or "only chatting"; automatically switch based on current task: modify code, write docs, run commands, explain concepts, break down steps, give suggestions, etc.
- **Human-like**: Natural tone, high information density, minimal fluff; briefly confirm when needed, don't pile on pleasantries; friendly but restrained (e.g., "Thanks @user" not "Thanks so much!!"). When referencing past conversations, mention them naturally like recalling personal experiences (e.g., "I remember we...", "Last time you mentioned..."), without showing off technical mechanisms.
- **Assistant**: Goal is to **help users get things done**, not show off capabilities. Prioritize understanding intent, then choose action; ask first when uncertain; strictly follow when users have clear preferences or project rules (e.g., AGENT.md, AGENTS.md, project \`.PENCIL.md\`).

## Collaboration Principles
1. **Understand before acting**: Clarify scope or provide minimum viable solution for ambiguous requirements before executing.
2. **Small verifiable steps**: Break into steps when possible, each checkable, reduce one-time big changes.
3. **Respect existing conventions**: Project/repo rules, directory structure, naming conventions take priority over personal style.
4. **Use tools purposefully**: Use read/write/edit/bash as needed, don't show off; forbidden to use \`cat\`/\`sed\` to read files, use Read tool; forbidden \`git add -A\`, only add files you modified.

5. **Use dangerous commands cautiously**: When involving deletion, move, overwrite and other irreversible operations, first confirm target path, list impact scope, ask user for confirmation when necessary; rm -rf, dd, mkfs and other high-risk commands need extra caution to prevent permanent data loss.

## Relationship with This File
- This file is **global** context, effective for all projects; you can add your general rules or preferences here.
- \`.PENCIL.md\` in project root is only effective for current project.
- \`AGENT.md\` (and legacy \`CLAUDE.md\`) and \`AGENTS.md\` will still be loaded from each directory level as per original logic, with higher priority than this file's general description.
`;

export function ensureNanopencilDefaultConfig(): void {
	const agentDir = getAgentDir();
	if (!existsSync(agentDir)) {
		mkdirSync(agentDir, { recursive: true, mode: 0o700 });
	}
	const pencilPath = join(agentDir, ".PENCIL.md");
	if (!existsSync(pencilPath)) {
		writeFileSync(pencilPath, DEFAULT_PENCIL_MD, "utf-8");
	}
	const modelsPath = getModelsPath();
	if (!existsSync(modelsPath)) {
		writeFileSync(modelsPath, JSON.stringify(NANOPENCIL_DEFAULT_MODELS_JSON, null, 2), "utf-8");
		ensureCustomProtocolProvidersInModels(modelsPath);
		return;
	}
	mergeNanopencilModelsIfNeeded(modelsPath);
	ensureCustomProtocolProvidersInModels(modelsPath);
}

/**
 * Ensure nanoPencil has at least one usable model before startup continues.
 *
 * If a custom or built-in provider is already configured, startup proceeds
 * without prompting. Otherwise, interactive terminals can configure one of the
 * default Coding Plan providers on the spot.
 */
export async function ensureNanopencilCodingPlanAuth(
	authStorage: AuthStorage,
	modelRegistry: ModelRegistry,
): Promise<void> {
	// Skip if any non-local provider already has auth (ollama is local-only, doesn't count)
	const LOCAL_ONLY_PROVIDERS = new Set([NANOPENCIL_OLLAMA_PROVIDER]);
	const availableRemote = modelRegistry.getAvailable().filter((m) => !LOCAL_ONLY_PROVIDERS.has(m.provider));
	if (availableRemote.length > 0) return;

	if (process.stdin.isTTY) {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		const choice = await new Promise<string>((resolve) => {
			rl.question(
				"Choose a Coding Plan provider to configure: 1) Alibaba DashScope 2) Baidu Qianfan 3) Volcano Ark 4) Alibaba Token Plan [1]: ",
				(line) => resolve((line ?? "1").trim() || "1"),
			);
		});
		const provider =
			choice === "2"
				? NANOPENCIL_QIANFAN_CODING_PROVIDER
				: choice === "3"
					? NANOPENCIL_ARK_CODING_PROVIDER
					: choice === "4"
						? NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER
						: NANOPENCIL_DEFAULT_PROVIDER;
		const hint =
			choice === "2"
				? "Qianfan API key (from https://console.bce.baidu.com/qianfan/resource/subscribe)"
				: choice === "3"
					? "Ark API key (from https://console.volcengine.com/ark/region:ark+cn-beijing/apikey)"
					: choice === "4"
						? "Ali Token Plan API key (from https://bailian.console.aliyun.com/?tab=plan#/efm/subscription/overview)"
						: "DashScope API key (sk-sp-...)";
		const answer = await new Promise<string>((resolve) => {
			rl.question(`Enter ${hint}: `, (line) => {
				rl.close();
				resolve((line ?? "").trim());
			});
		});
		if (!answer) {
			console.error("No API key provided. Exiting.");
			process.exit(1);
		}
		authStorage.set(provider, { type: "api_key", key: answer });
		if (provider === NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER) {
			authStorage.set(NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER, { type: "api_key", key: answer });
		}
		modelRegistry.refresh();
		return;
	}

	console.error(
		"No configured models are available yet. Start nanoPencil in an interactive terminal and add an API key, or configure a custom provider first.",
	);
	process.exit(1);
}
