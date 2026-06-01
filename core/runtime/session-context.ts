/**
 * [WHO]: Provides ScopedModel, ModelSelectPayload, ModelControllerContext, CompactionControllerContext
 * [FROM]: Depends on agent-core and ai public types, auth-storage credential type, session entry type,
 *         and the extension runner type
 * [TO]: Consumed by core/runtime/model-controller.ts, compaction-controller.ts; implemented by AgentSession
 * [HERE]: core/runtime/session-context.ts - S2 seam: narrow capability contracts for runtime controllers
 *
 * Controllers depend on capability functions rather than AgentSession, Agent, SessionManager,
 * SettingsManager, ModelRegistry, or ExtensionRunner objects. This keeps extraction from turning
 * into a service locator while preserving one-directional imports.
 */

import type { AgentLoopFrameworkInput, AgentLoopPolicyOptions, ThinkingLevel } from "@pencil-agent/agent-core";
import type { Model } from "@pencil-agent/ai";
import type { ExtensionRunner } from "../extensions-host/index.js";
import type { AuthCredential } from "../platform/config/auth-storage.js";
import type { SessionEntry } from "../session/session-manager.js";

/** Scoped model entry (from --models): a model plus its preferred thinking level. */
export interface ScopedModel {
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
}

export interface ModelSelectPayload {
  model: Model<any>;
  previousModel?: Model<any>;
  source: "set" | "cycle" | "restore";
}

/** Narrow capability surface for ModelController. */
export interface ModelControllerContext {
  getModel(): Model<any> | undefined;
  getThinkingLevel(): ThinkingLevel;
  getScopedModels(): ReadonlyArray<ScopedModel>;
  setAgentModel(model: Model<any>): void;
  setAgentThinkingLevel(level: ThinkingLevel): void;
  setAgentLoopFramework(framework: AgentLoopFrameworkInput | undefined): void;
  setLoopPolicy(options: Partial<AgentLoopPolicyOptions>): void;
  getApiKey(model: Model<any>): Promise<string | undefined>;
  getApiKeyForProvider(provider: string): Promise<string | undefined>;
  getAvailableModels(): Promise<Model<any>[]>;
  getAuthCredential(provider: string): AuthCredential | undefined;
  appendModelChange(provider: string, modelId: string): void;
  appendThinkingLevelChange(level: ThinkingLevel): void;
  setDefaultModelAndProvider(provider: string, modelId: string): void;
  setDefaultThinkingLevel(level: ThinkingLevel): void;
  emitModelSelect(payload: ModelSelectPayload): Promise<void>;
}

/** Compaction settings the pipeline reads (mirrors SettingsManager.getCompactionSettings). */
export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

/**
 * Narrow capability surface for CompactionController. Manual compaction must disconnect the agent,
 * abort the active turn, rebuild messages after summarizing, and reconnect — those lifecycle
 * effects are exposed as capabilities rather than handing over the AgentSession.
 */
export interface CompactionControllerContext {
  getModel(): Model<any> | undefined;
  getApiKey(model: Model<any>): Promise<string | undefined>;
  getExtensionRunner(): ExtensionRunner | undefined;
  getBranch(): SessionEntry[];
  getEntries(): SessionEntry[];
  getCompactionSettings(): CompactionSettings;
  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number, details: unknown, fromExtension: boolean): void;
  /** Rebuild agent messages from the (post-compaction) session context. */
  applyCompactedMessages(): void;
  logInfo(message: string, meta?: Record<string, unknown>): void;
  /** Detach the agent-event subscription before compacting. */
  disconnectFromAgent(): void;
  /** Re-attach the agent-event subscription after compacting. */
  reconnectToAgent(): void;
  /** Abort the in-flight agent turn before compacting. */
  abortAgent(): Promise<void>;
}
