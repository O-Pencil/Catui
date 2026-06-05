/**
 * [WHO]: Provides ModelController, CycleModelError, ModelCycleResult — model + thinking-level management
 * [FROM]: Depends on @pencil-agent/ai (Model, modelsAreEqual), @pencil-agent/agent-core (types),
 *         ./session-context (ModelControllerContext), ./thinking-levels, ./model-cycle
 * [TO]: Consumed by core/runtime/agent-session.ts (constructs one, delegates the public methods)
 * [HERE]: core/runtime/agent-session.ts split — owns setModel/cycleModel and thinking-level methods
 *
 * Extracted from AgentSession (S2 controller). Session state is reached through narrow
 * ModelControllerContext capabilities; behavior is identical to the former AgentSession methods.
 */

import type { AgentLoopFrameworkInput, AgentLoopPolicyOptions, ThinkingLevel } from "@pencil-agent/agent-core";
import type { Model } from "@pencil-agent/ai/types";
import { modelsAreEqual } from "@pencil-agent/ai/models";
import { nextCyclicIndex, pickThinkingLevelOnModelChange } from "./model-cycle.js";
import type { ModelControllerContext } from "./session-context.js";
import {
  availableThinkingLevels,
  clampThinkingLevel,
  modelSupportsThinking,
  modelSupportsXhigh,
  nextThinkingLevel,
} from "./thinking-levels.js";

/** Result of cycling the model. */
export interface ModelCycleResult {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  isScoped: boolean;
}

/** Raised when cycling cannot find a usable model (e.g. all OAuth tokens expired). */
export class CycleModelError extends Error {
  constructor(
    message: string,
    public readonly provider?: string,
    public readonly code?: "oauth_expired" | "no_valid_key" | "api_error",
  ) {
    super(message);
    this.name = "CycleModelError";
  }
}

export class ModelController {
  constructor(private readonly ctx: ModelControllerContext) {}

  private async _emitModelSelect(
    nextModel: Model<any>,
    previousModel: Model<any> | undefined,
    source: "set" | "cycle" | "restore",
  ): Promise<void> {
    if (modelsAreEqual(previousModel, nextModel)) return;
    await this.ctx.emitModelSelect({
      model: nextModel,
      previousModel,
      source,
    });
  }

  /**
   * Apply a model change: persist to session + settings, set the thinking level
   * (explicit when given, otherwise auto-picked from capabilities), and emit
   * model_select. Shared by setModel and the cycle paths.
   */
  private async _applyModelChange(
    model: Model<any>,
    source: "set" | "cycle" | "restore",
    explicitLevel?: ThinkingLevel,
  ): Promise<void> {
    const previousModel = this.ctx.getModel();
    this.ctx.setAgentModel(model);
    this.ctx.appendModelChange(model.provider, model.id);
    this.ctx.setDefaultModelAndProvider(model.provider, model.id);
    const newLevel = explicitLevel ?? pickThinkingLevelOnModelChange(model, this.ctx.getThinkingLevel());
    this.setThinkingLevel(newLevel);
    await this._emitModelSelect(model, previousModel, source);
  }

  /**
   * Set model directly. Validates API key, saves to session and settings.
   * @throws Error if no API key available for the model
   */
  async setModel(model: Model<any>): Promise<void> {
    const apiKey = await this.ctx.getApiKey(model);
    if (!apiKey) {
      throw new Error(`No API key for ${model.provider}/${model.id}`);
    }
    await this._applyModelChange(model, "set");
  }

  /**
   * Restore a model from session history without appending a new model-change
   * entry or changing default settings.
   */
  async restoreModel(model: Model<any>): Promise<void> {
    const previousModel = this.ctx.getModel();
    this.ctx.setAgentModel(model);
    await this._emitModelSelect(model, previousModel, "restore");
  }

  /**
   * Restore thinking state while switching/resuming a session.
   *
   * When the session has an explicit thinking entry, use the normal setter so
   * clamping and default-setting persistence stay identical to user-driven changes.
   * When the session has no entry, seed the session history from the configured
   * default without changing the configured default itself.
   */
  restoreThinkingLevel(options: {
    hasThinkingEntry: boolean;
    sessionThinkingLevel: ThinkingLevel;
    defaultThinkingLevel: ThinkingLevel;
  }): void {
    if (options.hasThinkingEntry) {
      this.setThinkingLevel(options.sessionThinkingLevel);
      return;
    }

    const availableLevels = this.getAvailableThinkingLevels();
    const effectiveLevel = availableLevels.includes(options.defaultThinkingLevel)
      ? options.defaultThinkingLevel
      : clampThinkingLevel(options.defaultThinkingLevel, availableLevels);
    this.ctx.setAgentThinkingLevel(effectiveLevel);
    this.ctx.appendThinkingLevelChange(effectiveLevel);
  }

  /**
   * Cycle to next/previous model. Uses scoped models if available, otherwise all available models.
   * @returns The new model info, or undefined if only one model available
   */
  async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
    if (this.ctx.getScopedModels().length > 0) {
      return this._cycleScopedModel(direction);
    }
    return this._cycleAvailableModel(direction);
  }

  private async _getScopedModelsWithApiKey(): Promise<Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>> {
    const apiKeysByProvider = new Map<string, string | undefined>();
    const result: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }> = [];

    for (const scoped of this.ctx.getScopedModels()) {
      const provider = scoped.model.provider;
      let apiKey: string | undefined;
      if (apiKeysByProvider.has(provider)) {
        apiKey = apiKeysByProvider.get(provider);
      } else {
        apiKey = await this.ctx.getApiKeyForProvider(provider);
        apiKeysByProvider.set(provider, apiKey);
      }

      if (apiKey) {
        result.push(scoped);
      }
    }

    return result;
  }

  private async _cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
    const scopedModels = await this._getScopedModelsWithApiKey();
    if (scopedModels.length <= 1) return undefined;

    const currentModel = this.ctx.getModel();
    let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));

    if (currentIndex === -1) currentIndex = 0;
    const nextIndex = nextCyclicIndex(currentIndex, scopedModels.length, direction);
    const next = scopedModels[nextIndex];

    await this._applyModelChange(next.model, "cycle", next.thinkingLevel);

    return {
      model: next.model,
      thinkingLevel: this.ctx.getThinkingLevel(),
      isScoped: true,
    };
  }

  private async _cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
    // Use getAvailableAsync to pre-filter models with invalid OAuth tokens
    const availableModels = await this.ctx.getAvailableModels();
    if (availableModels.length <= 1) return undefined;

    const currentModel = this.ctx.getModel();
    let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));

    if (currentIndex === -1) currentIndex = 0;
    const len = availableModels.length;

    // Find next model with valid API key, skipping expired OAuth tokens
    let nextIndex = currentIndex;
    let attempts = 0;
    let nextModel: Model<any> | undefined;
    let apiKey: string | undefined;

    while (attempts < len - 1) {
      attempts++;
      nextIndex = nextCyclicIndex(nextIndex, len, direction);

      const candidate = availableModels[nextIndex];
      if (!candidate) continue;

      // Use async getApiKey to validate OAuth tokens
      apiKey = await this.ctx.getApiKey(candidate);
      if (apiKey) {
        nextModel = candidate;
        break;
      }
      // No valid key - skip this model and continue cycling
    }

    if (!nextModel || !apiKey) {
      // No models have valid API keys (all OAuth tokens expired or no keys)
      const provider = currentModel?.provider;
      const cred = provider ? this.ctx.getAuthCredential(provider) : undefined;
      if (cred?.type === "oauth") {
        throw new CycleModelError(
          `All available models have expired OAuth tokens. Use /login ${provider} to re-authenticate.`,
          provider,
          "oauth_expired",
        );
      }
      throw new CycleModelError(`No models with valid API keys available`, provider, "no_valid_key");
    }

    await this._applyModelChange(nextModel, "cycle");

    return {
      model: nextModel,
      thinkingLevel: this.ctx.getThinkingLevel(),
      isScoped: false,
    };
  }

  // ---- Thinking level ----

  /**
   * Set thinking level, clamped to model capabilities. Saves to session and settings
   * only if the level actually changes.
   */
  setThinkingLevel(level: ThinkingLevel): void {
    const availableLevels = this.getAvailableThinkingLevels();
    const effectiveLevel = availableLevels.includes(level) ? level : clampThinkingLevel(level, availableLevels);

    const isChanging = effectiveLevel !== this.ctx.getThinkingLevel();
    this.ctx.setAgentThinkingLevel(effectiveLevel);

    if (isChanging) {
      this.ctx.appendThinkingLevelChange(effectiveLevel);
      this.ctx.setDefaultThinkingLevel(effectiveLevel);
    }
  }

  /** Set the session-level agent loop framework override. */
  setAgentLoopFramework(framework: AgentLoopFrameworkInput | undefined): void {
    this.ctx.setAgentLoopFramework(framework);
  }

  /** Update runtime loop policy options for subsequent turns. */
  setLoopPolicy(options: Partial<AgentLoopPolicyOptions>): void {
    this.ctx.setLoopPolicy(options);
  }

  /** Cycle to next thinking level. @returns new level, or undefined if model doesn't support thinking. */
  cycleThinkingLevel(): ThinkingLevel | undefined {
    const next = nextThinkingLevel(this.ctx.getThinkingLevel(), this.ctx.getModel());
    if (next === undefined) return undefined;
    this.setThinkingLevel(next);
    return next;
  }

  /** Thinking levels available for the current model. */
  getAvailableThinkingLevels(): ThinkingLevel[] {
    return availableThinkingLevels(this.ctx.getModel());
  }

  /** Whether the current model supports xhigh thinking. */
  supportsXhighThinking(): boolean {
    return modelSupportsXhigh(this.ctx.getModel());
  }

  /** Whether the current model supports thinking/reasoning. */
  supportsThinking(): boolean {
    return modelSupportsThinking(this.ctx.getModel());
  }
}
