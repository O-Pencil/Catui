/**
 * [WHO]: ModelCycleResult, ModelSwitcher class
 * [FROM]: Depends on ai, agent-core
 * [TO]: Consumed by core/model/index.ts
 * [HERE]: core/model/switcher.ts - model selection and cycling logic
 */
import type { Model } from "@pencil-agent/ai/types";
import type { ThinkingLevel } from "@pencil-agent/agent-core";
import { modelsAreEqual } from "@pencil-agent/ai/models";

export interface ModelCycleResult {
	model: Model<any>;
	previousModel: Model<any> | undefined;
}

export interface ModelSwitcherOptions {
	/** Get API key for a model */
	getApiKey: (model: Model<any>) => Promise<string | undefined>;
	/** Get API key for a provider */
	getApiKeyForProvider: (provider: string) => Promise<string | undefined>;
	/** Get all available models */
	getAvailableModels: () => Model<any>[];
	/** Set the model on the agent */
	setModelOnAgent: (model: Model<any>) => void;
	/** Get current model */
	getCurrentModel: () => Model<any> | undefined;
	/** Scoped models from --models flag */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;
}

export class ModelSwitcher {
	private options: ModelSwitcherOptions;
	private _scopedModels: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;

	constructor(options: ModelSwitcherOptions) {
		this.options = options;
		this._scopedModels = options.scopedModels || [];
	}

	/**
	 * Get current model
	 */
	getModel(): Model<any> | undefined {
		return this.options.getCurrentModel();
	}

	/**
	 * Check if a model has an API key
	 */
	async hasApiKey(model: Model<any>): Promise<boolean> {
		const apiKey = await this.options.getApiKey(model);
		return !!apiKey;
	}

	/**
	 * Get models with API keys (async, validates OAuth tokens)
	 */
	async getModelsWithApiKey(): Promise<Model<any>[]> {
		const available = this.options.getAvailableModels();
		const result: Model<any>[] = [];
		for (const model of available) {
			const apiKey = await this.options.getApiKey(model);
			if (apiKey) {
				result.push(model);
			}
		}
		return result;
	}

	/**
	 * Get scoped models with API keys
	 */
	async getScopedModelsWithApiKey(): Promise<Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>> {
		const apiKeysByProvider = new Map<string, string | undefined>();
		const result: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }> = [];

		for (const scoped of this._scopedModels) {
			const provider = scoped.model.provider;
			let apiKey: string | undefined;
			if (apiKeysByProvider.has(provider)) {
				apiKey = apiKeysByProvider.get(provider);
			} else {
				apiKey = await this.options.getApiKeyForProvider(provider);
				apiKeysByProvider.set(provider, apiKey);
			}

			if (apiKey) {
				result.push(scoped);
			}
		}

		return result;
	}

	/**
	 * Cycle to next/previous model
	 */
	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		if (this._scopedModels.length > 0) {
			return this.cycleScopedModel(direction);
		}
		return this.cycleAvailableModel(direction);
	}

	/**
	 * Cycle through scoped models
	 */
	private async cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const scopedModels = await this.getScopedModelsWithApiKey();
		if (scopedModels.length <= 1) return undefined;

		const currentModel = this.getModel();
		let currentIndex = scopedModels.findIndex((sm) =>
			modelsAreEqual(sm.model, currentModel),
		);

		if (currentIndex === -1) currentIndex = 0;
		const len = scopedModels.length;
		const nextIndex =
			direction === "forward"
				? (currentIndex + 1) % len
				: (currentIndex - 1 + len) % len;

		const next = scopedModels[nextIndex];
		const previousModel = currentModel;

		// Set the new model
		this.options.setModelOnAgent(next.model);

		return {
			model: next.model,
			previousModel,
		};
	}

	/**
	 * Cycle through all available models
	 * Skips models with expired OAuth tokens.
	 */
	private async cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const available = this.options.getAvailableModels();
		if (available.length <= 1) return undefined;

		const currentModel = this.getModel();
		let currentIndex = available.findIndex((m) =>
			modelsAreEqual(m, currentModel),
		);

		if (currentIndex === -1) currentIndex = 0;
		const len = available.length;

		// Find next model with valid API key, skipping expired OAuth tokens
		let nextIndex = currentIndex;
		let attempts = 0;
		let next: Model<any> | undefined;
		const previousModel = currentModel;

		while (attempts < len - 1) {
			attempts++;
			nextIndex =
				direction === "forward"
					? (nextIndex + 1) % len
					: (nextIndex - 1 + len) % len;

			const candidate = available[nextIndex];
			if (!candidate) continue;

			// Use async getApiKey to validate OAuth tokens
			const apiKey = await this.options.getApiKey(candidate);
			if (apiKey) {
				next = candidate;
				break;
			}
			// No valid key - skip this model and continue cycling
		}

		if (!next) {
			// No models have valid API keys
			return undefined;
		}

		// Set the new model
		this.options.setModelOnAgent(next);

		return {
			model: next,
			previousModel,
		};
	}

	/**
	 * Set scoped models
	 */
	setScopedModels(models: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>): void {
		this._scopedModels = models;
	}

	/**
	 * Get scoped models
	 */
	getScopedModels(): Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }> {
		return this._scopedModels;
	}
}
