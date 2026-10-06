/**
 * [WHO]: Custom protocol provider configuration/persistence helpers, provider IDs, NO_AUTH_API_KEY
 * [FROM]: Depends on config/auth-storage, model discovery, @catui/ai types, node:fs
 * [TO]: Consumed by catui-defaults and interactive auth/provider setup
 * [HERE]: core/model/custom-providers.ts - custom provider registration
 */
import type { AuthStorage } from "../platform/config/auth-storage.js";
import type { OpenAICompletionsCompat } from "@catui/ai/types";
import { inspectOpenAIModels, normalizeOpenAIBaseUrl } from "./discovery.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "node:path";

export const CUSTOM_ANTHROPIC_PROVIDER = "custom-anthropic";
export const CUSTOM_OPENAI_PROVIDER = "custom-openai";
/** Nonsecret compatibility credential for SDKs requiring a nonempty key. */
export const NO_AUTH_API_KEY = "catui-no-auth";
const DEFAULT_CUSTOM_MODEL_NAME = "custom-model";
const CUSTOM_PROVIDER_CONFIG_VERSION = 2;

export type CustomProtocolProviderId =
	| typeof CUSTOM_ANTHROPIC_PROVIDER
	| typeof CUSTOM_OPENAI_PROVIDER;

type ModelsConfigFile = {
	providers?: Record<string, Record<string, unknown>>;
};

type CustomProtocolProviderDefinition = {
	id: CustomProtocolProviderId;
	label: string;
	description: string;
	defaultBaseUrl: string;
	api: "anthropic-messages" | "openai-completions";
	defaultInput: ("text" | "image")[];
};

const CUSTOM_PROVIDER_DEFINITIONS: Record<
	CustomProtocolProviderId,
	CustomProtocolProviderDefinition
> = {
	[CUSTOM_ANTHROPIC_PROVIDER]: {
		id: CUSTOM_ANTHROPIC_PROVIDER,
		label: "Anthropic-compatible",
		description: "Configure or edit an endpoint that speaks the Anthropic Messages API.",
		defaultBaseUrl: "https://api.anthropic.com/v1",
		api: "anthropic-messages",
		defaultInput: ["text", "image"],
	},
	[CUSTOM_OPENAI_PROVIDER]: {
		id: CUSTOM_OPENAI_PROVIDER,
		label: "OpenAI-compatible",
		description: "Configure or edit an endpoint that speaks an OpenAI-compatible API.",
		defaultBaseUrl: "https://api.openai.com/v1",
		api: "openai-completions",
		defaultInput: ["text", "image"],
	},
};

type CustomProviderModelDefinition = {
	id: string;
	name: string;
	api: "anthropic-messages" | "openai-completions";
	input: ("text" | "image")[];
	contextWindow: number;
	maxTokens: number;
	compat?: OpenAICompletionsCompat;
};

function readModelsConfig(modelsPath: string): ModelsConfigFile {
	if (!existsSync(modelsPath)) {
		return { providers: {} };
	}

	const raw = readFileSync(modelsPath, "utf-8");
	const parsed = JSON.parse(raw) as ModelsConfigFile;
	return { providers: parsed.providers ?? {} };
}

function writeModelsConfig(modelsPath: string, config: ModelsConfigFile): void {
	mkdirSync(dirname(modelsPath), { recursive: true });
	writeFileSync(modelsPath, JSON.stringify(config, null, 2), "utf-8");
}

function createCustomModelDefinition(
	provider: CustomProtocolProviderId,
	modelName: string,
	overrides?: { contextWindow?: number; maxTokens?: number; compat?: OpenAICompletionsCompat },
): CustomProviderModelDefinition {
	const definition = getCustomProtocolProviderDefinition(provider);
	const normalizedModelName = modelName.trim() || DEFAULT_CUSTOM_MODEL_NAME;

	return {
		id: normalizedModelName,
		name: normalizedModelName,
		api: definition.api,
		input: definition.defaultInput,
		contextWindow: overrides?.contextWindow ?? 256000,
		maxTokens: overrides?.maxTokens ?? 32768,
		...(overrides?.compat ? { compat: overrides.compat } : {}),
	};
}

/**
 * Probe provider API for model context window and max output tokens.
 * Returns null if probing is unsupported or fails silently.
 */
async function probeModelContextWindow(
	provider: CustomProtocolProviderId,
	baseUrl: string,
	apiKey: string | undefined,
	modelName: string,
): Promise<{ contextWindow?: number; maxTokens?: number } | null> {
	try {
		// Anthropic-compatible: no /v1/models endpoint
		if (provider === CUSTOM_ANTHROPIC_PROVIDER) {
			return null;
		}

		// Ollama: use /api/show (more reliable than /v1/models for context_length)
		if (baseUrl.includes("localhost:11434") || baseUrl.includes("127.0.0.1:11434")) {
			const ollamaResult = await probeOllamaModelInfo(modelName);
			if (ollamaResult) return ollamaResult;
		}

		// OpenAI-compatible: GET /v1/models
		return await probeOpenAICompatibleModels(baseUrl, apiKey, modelName);
	} catch {
		return null;
	}
}

/** Probe Ollama /api/show for model metadata. */
async function probeOllamaModelInfo(
	modelName: string,
): Promise<{ contextWindow?: number; maxTokens?: number } | null> {
	try {
		const ollamaBase = "http://localhost:11434";
		const resp = await fetch(`${ollamaBase}/api/show`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: modelName }),
			signal: AbortSignal.timeout(5000),
		});
		if (!resp.ok) return null;

		const data = await resp.json() as Record<string, unknown>;
		const modelInfo = data.model_info as Record<string, unknown> | undefined;
		if (!modelInfo) return null;

		// Ollama stores context_length in model_info["general.context_length"]
		const contextLength = modelInfo["general.context_length"];
		if (typeof contextLength === "number" && contextLength > 0) {
			return { contextWindow: contextLength };
		}
		return null;
	} catch {
		return null;
	}
}

/** Probe OpenAI-compatible /v1/models for model metadata. */
async function probeOpenAICompatibleModels(
	baseUrl: string,
	apiKey: string | undefined,
	modelName: string,
): Promise<{ contextWindow?: number; maxTokens?: number } | null> {
	try {
		const result = await inspectOpenAIModels(normalizeOpenAIBaseUrl(baseUrl),
			apiKey === NO_AUTH_API_KEY ? undefined : apiKey);
		const match = result.models.find((m) => m.id === modelName);
		if (!match) return null;
		return { contextWindow: match.contextWindow, maxTokens: match.maxTokens };
	} catch {
		return null;
	}
}

function getStoredProviderConfig(
	modelsPath: string,
	provider: CustomProtocolProviderId,
): Record<string, unknown> | undefined {
	try {
		const config = readModelsConfig(modelsPath);
		return config.providers?.[provider];
	} catch {
		return undefined;
	}
}

function getStoredModelId(providerConfig: Record<string, unknown> | undefined): string | undefined {
	const models = providerConfig?.models;
	if (!Array.isArray(models) || models.length === 0) {
		return undefined;
	}

	const firstModel = models[0];
	if (
		typeof firstModel === "object" &&
		firstModel !== null &&
		"id" in firstModel &&
		typeof firstModel.id === "string" &&
		firstModel.id.trim()
	) {
		return firstModel.id.trim();
	}

	return undefined;
}

function getStoredModelCount(providerConfig: Record<string, unknown> | undefined): number {
	const models = providerConfig?.models;
	return Array.isArray(models) ? models.length : 0;
}

function getStoredConfigVersion(
	providerConfig: Record<string, unknown> | undefined,
): number | undefined {
	const version = providerConfig?.customProviderVersion;
	return typeof version === "number" ? version : undefined;
}

export function isCustomProtocolProvider(
	provider: string,
): provider is CustomProtocolProviderId {
	return provider === CUSTOM_ANTHROPIC_PROVIDER || provider === CUSTOM_OPENAI_PROVIDER;
}

export function listCustomProtocolProviders(): CustomProtocolProviderId[] {
	return [CUSTOM_ANTHROPIC_PROVIDER, CUSTOM_OPENAI_PROVIDER];
}

export function getCustomProtocolProviderDefinition(
	provider: CustomProtocolProviderId,
): CustomProtocolProviderDefinition {
	return CUSTOM_PROVIDER_DEFINITIONS[provider];
}

export function getCustomProtocolProviderBaseUrl(
	modelsPath: string,
	provider: CustomProtocolProviderId,
): string | undefined {
	const providerConfig = getStoredProviderConfig(modelsPath, provider);
	const baseUrl = providerConfig?.baseUrl;
	return typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : undefined;
}

export function getCustomProtocolProviderModelName(
	modelsPath: string,
	provider: CustomProtocolProviderId,
): string | undefined {
	return getStoredModelId(getStoredProviderConfig(modelsPath, provider));
}

export function getCustomProtocolProviderModelLimits(
	modelsPath: string,
	provider: CustomProtocolProviderId,
): { contextWindow?: number; maxTokens?: number } {
	const providerConfig = getStoredProviderConfig(modelsPath, provider);
	const models = providerConfig?.models;
	if (!Array.isArray(models) || models.length === 0) {
		return {};
	}
	const first = models[0];
	if (typeof first !== "object" || first === null) {
		return {};
	}
	const contextWindow = (first as { contextWindow?: unknown }).contextWindow;
	const maxTokens = (first as { maxTokens?: unknown }).maxTokens;
	return {
		contextWindow: typeof contextWindow === "number" && contextWindow > 0 ? contextWindow : undefined,
		maxTokens: typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : undefined,
	};
}

export function ensureCustomProtocolProvidersInModels(modelsPath: string): void {
	let config: ModelsConfigFile;
	try {
		config = readModelsConfig(modelsPath);
	} catch {
		return;
	}
	config.providers ??= {};

	let changed = false;
	for (const provider of listCustomProtocolProviders()) {
		const definition = getCustomProtocolProviderDefinition(provider);
		const existing = config.providers[provider];
		const version = getStoredConfigVersion(existing);
		const shouldResetModelName =
			version !== CUSTOM_PROVIDER_CONFIG_VERSION ||
			getStoredModelCount(existing) !== 1;
		const modelName = shouldResetModelName
			? DEFAULT_CUSTOM_MODEL_NAME
			: getStoredModelId(existing) ?? DEFAULT_CUSTOM_MODEL_NAME;
		const existingLimits = (() => {
			const models = existing?.models;
			if (!Array.isArray(models) || models.length === 0) return undefined;
			const first = models[0];
			if (typeof first !== "object" || first === null) return undefined;
			return first as { contextWindow?: unknown; maxTokens?: unknown; compat?: OpenAICompletionsCompat };
		})();
		const preservedOverrides: { contextWindow?: number; maxTokens?: number; compat?: OpenAICompletionsCompat } = {};
		if (existingLimits?.compat) preservedOverrides.compat = existingLimits.compat;
		if (
			existingLimits &&
			typeof existingLimits.contextWindow === "number" &&
			existingLimits.contextWindow > 0
		) {
			preservedOverrides.contextWindow = existingLimits.contextWindow;
		}
		if (
			existingLimits &&
			typeof existingLimits.maxTokens === "number" &&
			existingLimits.maxTokens > 0
		) {
			preservedOverrides.maxTokens = existingLimits.maxTokens;
		}
		const nextModels = [
			createCustomModelDefinition(provider, modelName, preservedOverrides),
		];

		if (!existing) {
			config.providers[provider] = {
				baseUrl: definition.defaultBaseUrl,
				customProviderVersion: CUSTOM_PROVIDER_CONFIG_VERSION,
				models: nextModels,
			};
			changed = true;
			continue;
		}

		if (typeof existing.baseUrl !== "string" || !existing.baseUrl.trim()) {
			existing.baseUrl = definition.defaultBaseUrl;
			changed = true;
		}

		if (existing.customProviderVersion !== CUSTOM_PROVIDER_CONFIG_VERSION) {
			existing.customProviderVersion = CUSTOM_PROVIDER_CONFIG_VERSION;
			changed = true;
		}

		const currentModels = existing.models;
		if (JSON.stringify(currentModels) !== JSON.stringify(nextModels)) {
			existing.models = nextModels;
			changed = true;
		}
	}

	if (changed) {
		writeModelsConfig(modelsPath, config);
	}
}

export async function saveCustomProtocolProviderConfig(
	modelsPath: string,
	provider: CustomProtocolProviderId,
	configUpdate: {
		baseUrl: string;
		modelName: string;
		apiKey?: string;
		compat?: OpenAICompletionsCompat;
		overrides?: { contextWindow?: number; maxTokens?: number };
	},
): Promise<{ contextWindow?: number; maxTokens?: number } | null> {
	const trimmedBaseUrl = configUpdate.baseUrl.trim();
	const trimmedModelName = configUpdate.modelName.trim();
	if (!trimmedBaseUrl) {
		throw new Error("Base URL cannot be empty.");
	}
	if (!trimmedModelName) {
		throw new Error("Model name cannot be empty.");
	}

	const overrides = configUpdate.overrides;
	const priorLimits = getCustomProtocolProviderModelLimits(modelsPath, provider);
	let probed: { contextWindow?: number; maxTokens?: number } | null = null;
	if (!overrides || overrides.contextWindow === undefined || overrides.maxTokens === undefined) {
		probed = await probeModelContextWindow(
			provider,
			trimmedBaseUrl,
			configUpdate.apiKey,
			trimmedModelName,
		);
	}

	const effective: { contextWindow?: number; maxTokens?: number } = {};
	if (overrides?.contextWindow !== undefined) {
		effective.contextWindow = overrides.contextWindow;
	} else if (probed?.contextWindow !== undefined) {
		effective.contextWindow = probed.contextWindow;
	} else if (priorLimits.contextWindow !== undefined) {
		effective.contextWindow = priorLimits.contextWindow;
	}
	if (overrides?.maxTokens !== undefined) {
		effective.maxTokens = overrides.maxTokens;
	} else if (probed?.maxTokens !== undefined) {
		effective.maxTokens = probed.maxTokens;
	} else if (priorLimits.maxTokens !== undefined) {
		effective.maxTokens = priorLimits.maxTokens;
	}

	const config = readModelsConfig(modelsPath);
	config.providers ??= {};

	config.providers[provider] = {
		...(config.providers[provider] ?? {}),
		baseUrl: trimmedBaseUrl,
		customProviderVersion: CUSTOM_PROVIDER_CONFIG_VERSION,
		models: [createCustomModelDefinition(provider, trimmedModelName, { ...effective, compat: configUpdate.compat })],
	};
	// Explicit credential updates are owned by auth.json. Do not retain a stale
	// models.json fallback that could later be sent to a changed endpoint.
	if (configUpdate.apiKey !== undefined) delete config.providers[provider].apiKey;
	writeModelsConfig(modelsPath, config);
	return effective;
}

export function saveCustomProtocolProviderApiKey(
	authStorage: AuthStorage,
	provider: CustomProtocolProviderId,
	apiKey: string,
): void {
	const trimmedApiKey = apiKey.trim();
	if (!trimmedApiKey) {
		throw new Error("API key cannot be empty.");
	}

	authStorage.set(provider, {
		type: "api_key",
		key: trimmedApiKey,
	});
}
