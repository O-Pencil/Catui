/**
 * [WHO]: CUSTOM_ANTHROPIC_PROVIDER, CUSTOM_OPENAI_PROVIDER, registerCustomProvider()
 * [FROM]: Depends on config/auth-storage, node:fs
 * [TO]: Consumed by core/model-registry.ts
 * [HERE]: core/model/custom-providers.ts - custom provider registration
 */
import type { AuthStorage } from "../platform/config/auth-storage.js";
import { existsSync, readFileSync, writeFileSync } from "fs";

export const CUSTOM_ANTHROPIC_PROVIDER = "custom-anthropic";
export const CUSTOM_OPENAI_PROVIDER = "custom-openai";
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
	writeFileSync(modelsPath, JSON.stringify(config, null, 2), "utf-8");
}

function createCustomModelDefinition(
	provider: CustomProtocolProviderId,
	modelName: string,
): CustomProviderModelDefinition {
	const definition = getCustomProtocolProviderDefinition(provider);
	const normalizedModelName = modelName.trim() || DEFAULT_CUSTOM_MODEL_NAME;

	return {
		id: normalizedModelName,
		name: normalizedModelName,
		api: definition.api,
		input: definition.defaultInput,
		contextWindow: 256000,
		maxTokens: 32768,
	};
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
		const nextModels = [createCustomModelDefinition(provider, modelName)];

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

export function saveCustomProtocolProviderConfig(
	modelsPath: string,
	provider: CustomProtocolProviderId,
	configUpdate: {
		baseUrl: string;
		modelName: string;
	},
): void {
	const trimmedBaseUrl = configUpdate.baseUrl.trim();
	const trimmedModelName = configUpdate.modelName.trim();
	if (!trimmedBaseUrl) {
		throw new Error("Base URL cannot be empty.");
	}
	if (!trimmedModelName) {
		throw new Error("Model name cannot be empty.");
	}

	const config = readModelsConfig(modelsPath);
	config.providers ??= {};

	config.providers[provider] = {
		...(config.providers[provider] ?? {}),
		baseUrl: trimmedBaseUrl,
		customProviderVersion: CUSTOM_PROVIDER_CONFIG_VERSION,
		models: [createCustomModelDefinition(provider, trimmedModelName)],
	};
	writeModelsConfig(modelsPath, config);
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
