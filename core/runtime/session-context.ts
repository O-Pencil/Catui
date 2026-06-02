/**
 * [WHO]: Provides ScopedModel, ModelSelectPayload, and runtime controller context contracts
 * [FROM]: Depends on agent-core and ai public types, auth-storage credential type, session entry type,
 *         and the extension runner type
 * [TO]: Consumed by core/runtime/*-controller.ts; implemented by AgentSession through capability adapters
 * [HERE]: core/runtime/session-context.ts - S2 seam: narrow capability contracts for runtime controllers
 *
 * Controllers depend on capability functions rather than AgentSession, Agent, SessionManager,
 * SettingsManager, ModelRegistry, or ExtensionRunner objects. This keeps extraction from turning
 * into a service locator while preserving one-directional imports.
 */

import type { AgentLoopFrameworkInput, AgentLoopPolicyOptions, AgentMessage, ThinkingLevel } from "@pencil-agent/agent-core";
import type { Model } from "@pencil-agent/ai";
import type { CompactionResult } from "../session/compaction/index.js";
import type { ExtensionRunner } from "../extensions-host/index.js";
import type { AuthCredential } from "../platform/config/auth-storage.js";
import type { SessionContext, SessionEntry, SessionManager } from "../session/session-manager.js";

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
  /** Rebuild agent messages from the (post-compaction) session context; returns the new messages. */
  applyCompactedMessages(): AgentMessage[];
  logInfo(message: string, meta?: Record<string, unknown>): void;
  /** Detach the agent-event subscription before compacting (manual only). */
  disconnectFromAgent(): void;
  /** Re-attach the agent-event subscription after compacting (manual only). */
  reconnectToAgent(): void;
  /** Abort the in-flight agent turn before compacting (manual only). */
  abortAgent(): Promise<void>;
  // Auto-compaction (loop-driven):
  emitAutoCompactionStart(reason: "overflow" | "threshold"): void;
  emitAutoCompactionEnd(payload: {
    result: CompactionResult | undefined;
    aborted: boolean;
    willRetry: boolean;
    errorMessage?: string;
  }): void;
  getAutoCompactionEnabled(): boolean;
  setAutoCompactionEnabled(enabled: boolean): void;
}

/**
 * Narrow capability surface for SessionTreeController (navigateTree + branch summary). Tree
 * navigation reads/mutates the session tree and may summarize the abandoned branch; those effects
 * are exposed as capabilities rather than handing over the AgentSession or SessionManager.
 */
export interface SessionTreeControllerContext {
  getModel(): Model<any> | undefined;
  getApiKey(model: Model<any>): Promise<string | undefined>;
  getExtensionRunner(): ExtensionRunner | undefined;
  getLeafId(): string | null;
  getEntry(entryId: string): SessionEntry | undefined;
  collectBranchSummaryEntries(
    oldLeafId: string | null,
    targetId: string,
  ): { entries: SessionEntry[]; commonAncestorId: string | null };
  getBranchSummaryReserveTokens(): number;
  branchWithSummary(newLeafId: string | null, summaryText: string, summaryDetails: unknown, fromExtension: boolean): string;
  appendLabelChange(entryId: string, label: string): void;
  resetLeaf(): void;
  branch(newLeafId: string): void;
  /** Rebuild agent messages from the (post-navigation) session context. */
  rebuildAgentMessages(): void;
  extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string;
}

/** Inputs for restoring thinking level when resuming a session (mirrors ModelController). */
export interface ThinkingRestore {
  hasThinkingEntry: boolean;
  sessionThinkingLevel: ThinkingLevel;
  defaultThinkingLevel: ThinkingLevel;
}

/**
 * Narrow capability surface for SessionLifecycleController (new / switch / fork — identity-change
 * choreography). The agent subscription teardown/reset, pending-queue clearing, and model/thinking
 * restore are exposed as capabilities; restore is delegated to ModelController by the host adapter.
 */
export interface SessionLifecycleControllerContext {
  getSessionFile(): string | undefined;
  getExtensionRunner(): ExtensionRunner | undefined;
  disconnectFromAgent(): void;
  reconnectToAgent(): void;
  abortAgent(): Promise<void>;
  resetAgent(): void;
  /** agent.sessionId = sessionManager.getSessionId() */
  syncAgentSessionId(): void;
  /** Clear steering / follow-up / pending-next-turn queues (session-owned). */
  clearPendingQueues(): void;
  /** Clear only the next-turn queue when forking; steering/follow-up queues are not part of fork behavior. */
  clearPendingNextTurnMessages(): void;
  sessionNewSession(parentSession: string | undefined): void;
  sessionSetFile(path: string): void;
  sessionCreateBranchedSession(parentId: string): void;
  getEntry(entryId: string): SessionEntry | undefined;
  buildSessionContext(): SessionContext;
  replaceAgentMessages(messages: SessionContext["messages"]): void;
  appendThinkingLevelChange(level: ThinkingLevel): void;
  getThinkingLevel(): ThinkingLevel;
  getBranch(): SessionEntry[];
  /** Default thinking level with the built-in fallback already applied. */
  getDefaultThinkingLevel(): ThinkingLevel;
  getAvailableModels(): Model<any>[];
  restoreModel(model: Model<any>): Promise<void>;
  restoreThinkingLevel(opts: ThinkingRestore): void;
  runSetup(setup: (sessionManager: SessionManager) => Promise<void>): Promise<void>;
  extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string;
}
