/**
 * [WHO]: AgentSession class, session lifecycle, event emission, in-loop recovery adapter, pruneRecoverableErrorTail()
 * [FROM]: Depends on agent-core, ai, core/tools/*, core/session/*, core/platform/config/*
 * [TO]: Consumed by core/index.ts, core/runtime/sdk.ts, modes/interactive/interactive-mode.ts, modes/print-mode.ts, modes/rpc/rpc-mode.ts, modes/acp/acp-mode.ts, modes/rpc/rpc-types.ts, modes/rpc/rpc-client.ts, modes/interactive/components/footer.ts, modes/interactive/components/skill-invocation-message.ts
 * [HERE]: Central runtime hub; all modes delegate to this class
 */
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
  Agent,
  AgentEvent,
  AgentLoopFramework,
  AgentLoopFrameworkInput,
  AgentLoopPolicyOptions,
  AgentModelErrorRecoveryResult,
  AgentMessage,
  AgentState,
  AgentTool,
  ThinkingLevel,
} from "@catui/agent-core";
import type {
  AssistantMessage,
  DocumentContent,
  ImageContent,
  Message,
  Model,
  TextContent,
} from "@catui/ai/types";
import { isContextOverflow } from "@catui/ai/overflow";
import { resetApiProviders } from "@catui/ai/registry";
import { getDocsPath } from "../../config.js";
import type { Theme as ThemeContract } from "../theme-contract.js";
import { stripFrontmatter } from "../../utils/frontmatter.js";

import type { BashResult } from "../platform/exec/bash-executor.js";
import {
  type CompactionResult,
  calculateContextTokens,
  collectEntriesForBranchSummary,
  estimateContextTokens,
  shouldCompact,
} from "../session/compaction/index.js";
import { ToolOrchestrator } from "../tools/orchestrator.js";
import { DEFAULT_THINKING_LEVEL } from "../platform/config/defaults.js";
import { createExtensionTelemetrySink } from "../platform/telemetry/index.js";
import {
  type ContextUsage,
  type ExtensionCommandContextActions,
  type ExtensionErrorListener,
  ExtensionRunner,
  type ExtensionUIContext,
  type InputSource,
  type SessionBeforeCompactResult,
  type ShutdownHandler,
  type ToolDefinition,
  type ToolInfo,
} from "../extensions-host/index.js";
import type { CustomMessage } from "../messages.js";
import type { ModelRegistry } from "../model-registry.js";
import {
  expandPromptTemplate,
  type PromptTemplate,
} from "../prompt/prompt-templates.js";
import type {
  ResourceExtensionPaths,
  ResourceLoader,
} from "../platform/config/resource-loader.js";
import { getLatestCompactionEntry, SessionManager, type SessionEntry, type BranchSummaryEntry } from "../session/session-manager.js";
import type { SettingsManager } from "../platform/config/settings-manager.js";
import { AgentDirContext } from "../agent-dir/agent-dir-context.js";

import { t } from "../platform/i18n/index.js";
import { toSoulContext, extractSessionContext } from "../soul-integration.js";
import type { BashOperations } from "../tools/bash.js";
import { createDefaultRuntimeTools } from "./default-tools.js";
import { BashRunner } from "./bash-runner.js";
import { Listeners } from "../platform/listeners.js";
import { ModelController, type ModelCycleResult } from "./model-controller.js";
import { CompactionController } from "./compaction-controller.js";
import { SessionLifecycleController } from "./session-lifecycle-controller.js";
import { SessionTreeController } from "./session-tree-controller.js";
import { ToolRuntimeController } from "./tool-runtime-controller.js";
import {
  buildRuntimeSystemPrompt,
  getActiveBaseToolNames,
} from "./prompt-assembly.js";
import { exportSessionHtml, getLastAssistantText } from "./export-bridge.js";
import { ExtensionEventBridge } from "./event-bridge.js";
import { bindExtensionCore } from "./extension-core-bindings.js";
import {
  buildSessionSlashCommands,
  type SessionSlashCommandDescriptor,
} from "./slash-command-catalog.js";
import { RetryCoordinator, type RetryCoordinatorHost, type RetrySessionEvent } from "./retry-coordinator.js";
import { createLogger, type AgentLogger } from "../platform/utils/logger.js";
import { createAgentTool, createTaskToolAlias, createSendMessageTool, AGENT_TOOL_NAME, TASK_TOOL_NAME, SEND_MESSAGE_TOOL_NAME, type CreateSessionFn, type SubAgentEvent } from "../sub-agent/index.js";

export type { SessionSlashCommandDescriptor } from "./slash-command-catalog.js";
export { CycleModelError } from "./model-controller.js";
export type { ModelCycleResult } from "./model-controller.js";

// ============================================================================
// Skill Block Parsing
// ============================================================================

/** Parsed skill block from a user message */
export interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  userMessage: string | undefined;
}

/**
 * Parse a skill block from message text.
 * Returns null if the text doesn't contain a skill block.
 */
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = text.match(
    /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/,
  );
  if (!match) return null;
  return {
    name: match[1],
    location: match[2],
    content: match[3],
    userMessage: match[4]?.trim() || undefined,
  };
}

export function pruneRecoverableErrorTail(
  messages: AgentMessage[],
  assistantMessage: AssistantMessage,
): AgentMessage[] {
  const interruptedToolCallIds = new Set(
    assistantMessage.content
      .filter((part) => part.type === "toolCall")
      .map((part) => part.id),
  );
  let end = messages.length;

  while (
    end > 0 &&
    isRecoverableTailToolResult(messages[end - 1], interruptedToolCallIds)
  ) {
    end--;
  }

  if (
    end > 0 &&
    isSameRecoverableAssistantMessage(messages[end - 1], assistantMessage)
  ) {
    end--;
  }

  return messages.slice(0, end);
}

function isRecoverableTailToolResult(
  message: AgentMessage,
  interruptedToolCallIds: ReadonlySet<string>,
): boolean {
  return (
    message.role === "toolResult" &&
    interruptedToolCallIds.has(message.toolCallId)
  );
}

function isSameRecoverableAssistantMessage(
  message: AgentMessage,
  assistantMessage: AssistantMessage,
): boolean {
  return (
    message.role === "assistant" &&
    message.stopReason === assistantMessage.stopReason &&
    message.timestamp === assistantMessage.timestamp &&
    message.provider === assistantMessage.provider &&
    message.model === assistantMessage.model &&
    message.api === assistantMessage.api &&
    message.errorMessage === assistantMessage.errorMessage
  );
}

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
  | AgentEvent
  | { type: "auto_compaction_start"; reason: "threshold" | "overflow" }
  | {
      type: "auto_compaction_end";
      result: CompactionResult | undefined;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      type: "auto_retry_end";
      success: boolean;
      attempt: number;
      finalError?: string;
    }
  | {
      type: "sdk:error";
      source: "soul" | "mcp" | "eventbus";
      error: unknown;
    }
  | {
      // Emitted when deferred (non-blocking) MCP tool loading finishes and the
      // tools have been merged into the active runtime. Lets the UI surface a
      // "MCP ready" status without blocking startup. See warmupMcpTools().
      type: "sdk:mcp_ready";
      toolCount: number;
    }
  // Sub-agent lifecycle events (forwarded from SubAgentEvent)
  | { type: "sub_agent_start"; subAgentId: string; agentType: string; description: string; isAsync: boolean }
  | { type: "sub_agent_tool_start"; subAgentId: string; toolName: string; input?: unknown }
  | { type: "sub_agent_tool_end"; subAgentId: string; toolName: string; isError: boolean; output?: unknown; durationMs?: number }
  | { type: "sub_agent_end"; subAgentId: string; success: boolean }
  | { type: "tool_input_delta"; toolCallId: string; toolName: string; delta: string }
  | {
      type: "debug";
      level: "basic" | "verbose";
      source: "session" | "mcp" | "model" | "tool" | "resource" | "extension";
      message: string;
      data?: Record<string, unknown>;
      timestamp: number;
    };

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

/** Map SubAgentEvent to AgentSessionEvent for TUI display. */
function mapSubAgentEvent(event: SubAgentEvent): AgentSessionEvent | undefined {
  switch (event.type) {
    case "agent_start":
      return { type: "sub_agent_start", subAgentId: event.subAgentId, agentType: event.agentType, description: event.description, isAsync: event.isAsync };
    case "tool_start":
      return { type: "sub_agent_tool_start", subAgentId: event.subAgentId, toolName: event.toolName, input: event.args };
    case "tool_end":
      return { type: "sub_agent_tool_end", subAgentId: event.subAgentId, toolName: event.toolName, isError: event.isError, output: event.result, durationMs: event.durationMs };
    case "agent_end":
      return { type: "sub_agent_end", subAgentId: event.subAgentId, success: event.success };
    default:
      return undefined;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface AgentSessionConfig {
  agent: Agent;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  cwd: string;
  /** Global agent config directory for user-scoped resources. */
  agentDir: string;
  /** Multi-agent context. */
  agentCtx: AgentDirContext;
  /** Models to cycle through with Ctrl+P (from --models flag) */
  scopedModels?: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;
  /** Resource loader for skills, prompts, themes, context files, system prompt */
  resourceLoader: ResourceLoader;
  /** SDK custom tools registered outside extensions */
  customTools?: ToolDefinition[];
  /** Optional dynamic tool factory (e.g. MCP) refreshed on reload */
  mcpToolsFactory?: () => Promise<ToolDefinition[]>;
  /** Initial dynamic tools for first session build */
  initialMcpTools?: ToolDefinition[];
  /** Soul manager factory refreshed on reload (for persona/dir switching) */
  soulManagerFactory?: () => Promise<any | null>;
  /** Model registry for API key resolution and model discovery */
  modelRegistry: ModelRegistry;
  /** Soul manager for AI personality evolution */
  soulManager?: any;
  /** Initial active built-in tool names. Default: [read, bash, edit, write] */
  initialActiveToolNames?: string[];
  /** Override base tools (useful for custom runtimes). */
  baseToolsOverride?: Record<string, AgentTool>;
  /** Mutable ref used by Agent to access the current ExtensionRunner */
  extensionRunnerRef?: { current?: ExtensionRunner };
  /** External abort signal for stopping the session (e.g., from SubAgent runtime) */
  signal?: AbortSignal;
  /**
   * Theme used to render custom extension tools when exporting a session to HTML.
   * Injected by the composition root (UI layer owns the theme); when omitted, HTML
   * export still works but skips custom-tool rendering. Keeps core/runtime from
   * importing the modes/ UI theme singleton (U2).
   */
  theme?: ThemeContract;
  /**
   * Factory for creating child AgentSession instances (used by the Agent sub-agent tool).
   * Injected by the composition root (sdk.ts) to avoid a circular dependency
   * between agent-session.ts and sdk.ts.
   */
  createSession?: CreateSessionFn;
  /** Debug event verbosity level. Default: "off" */
  debugLevel?: "off" | "basic" | "verbose";
}

export interface ExtensionBindings {
  uiContext?: ExtensionUIContext;
  commandContextActions?: ExtensionCommandContextActions;
  shutdownHandler?: ShutdownHandler;
  onError?: ExtensionErrorListener;
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
  /** Whether to expand file-based prompt templates (default: true) */
  expandPromptTemplates?: boolean;
  /** Image attachments */
  images?: ImageContent[];
  /** When streaming, how to queue the message: "steer" (interrupt) or "followUp" (wait). Required if streaming. */
  streamingBehavior?: "steer" | "followUp";
  /** Source of input for extension input event handlers. Defaults to "interactive". */
  source?: InputSource;
}

/** Session statistics for /session command */
export interface SessionStats {
  sessionFile: string | undefined;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
}

export type SlashCommandExecutor = (text: string) => Promise<boolean>;

// ============================================================================
// Constants
// ============================================================================

/** Standard thinking levels */
// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
  readonly agent: Agent;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly agentCtx: AgentDirContext;

  private _scopedModels: Array<{
    model: Model<any>;
    thinkingLevel: ThinkingLevel;
  }>;

  // Event subscription state
  private _unsubscribeAgent?: () => void;
  private _detachExternalAbort?: () => void;
  private readonly _listeners = new Listeners<AgentSessionEvent>();

  /** Tracks pending steering messages for UI display. Removed when delivered. */
  private _steeringMessages: string[] = [];
  /** Tracks pending follow-up messages for UI display. Removed when delivered. */
  private _followUpMessages: string[] = [];
  /** Messages queued to be included with the next user prompt as context ("asides"). */
  private _pendingNextTurnMessages: CustomMessage[] = [];

  // Retry coordinator (P1 - extracted from AgentSession)
  private _retryCoordinator!: RetryCoordinator;

  // Structured logger (P2 - observability)
  private _logger!: AgentLogger;

  // Bash execution (extracted to BashRunner — P4.1)
  private _bashRunner: BashRunner;

  // Extension system
  private _extensionRunner: ExtensionRunner | undefined = undefined;
  private _slashCommandExecutor: SlashCommandExecutor | undefined = undefined;
  private readonly _extensionEventBridge: ExtensionEventBridge;

  private _resourceLoader: ResourceLoader;
  /** Injected theme for HTML-export custom-tool rendering (U2: no modes import). */
  private _theme?: ThemeContract;
  /** Debug event verbosity level. */
  private _debugLevel: "off" | "basic" | "verbose" = "off";

  private _dbg(msg: string): void {
    if (process.env.CATUI_DEBUG_SESSION !== "1") return;
    try {
      const logFile = join(homedir(), ".catui", "agent", "catui-debug.log");
      appendFileSync(logFile, `[${new Date().toISOString()}] [session] ${msg}\n`);
    } catch { /* debug logging is best-effort */ }
  }
  private _customTools: ToolDefinition[];
  private _staticCustomTools: ToolDefinition[];
  private _mcpToolsFactory?: () => Promise<ToolDefinition[]>;
  private _soulManagerFactory?: () => Promise<any | null>;
  private _baseToolRegistry: Map<string, AgentTool> = new Map();
  /** CC-style Agent tool — recreated on each _buildRuntime() */
  private _agentTool?: any;
  /** Factory for creating child sessions (injected via config to avoid sdk.ts cycle) */
  private _createSessionFactory?: CreateSessionFn;
  private _cwd: string;
  private _extensionRunnerRef?: { current?: ExtensionRunner };
  private _soulManager?: any; // SoulManager from nanosoul
  private _lastSoulInjection?: string;
  private _initialActiveToolNames?: string[];
  private _baseToolsOverride?: Record<string, AgentTool>;
  private _extensionUIContext?: ExtensionUIContext;
  private _extensionCommandContextActions?: ExtensionCommandContextActions;
  private _extensionShutdownHandler?: ShutdownHandler;
  private _extensionErrorListener?: ExtensionErrorListener;
  private _extensionErrorUnsubscriber?: () => void;

  // Model registry for API key resolution
  private _modelRegistry: ModelRegistry;
  private _agentDir: string;

  // Base system prompt (without extension appends) - used to apply fresh appends each turn
  private _baseSystemPrompt = "";

  // Controllers/coordinators (AgentSession responsibility decomposition)
  private readonly _modelController: ModelController;
  private readonly _compactionController: CompactionController;
  private readonly _sessionTreeController: SessionTreeController;
  private readonly _lifecycleController: SessionLifecycleController;
  private readonly _toolOrchestrator: ToolOrchestrator;
  private readonly _toolRuntimeController: ToolRuntimeController;

  constructor(config: AgentSessionConfig) {
    this.agent = config.agent;
    this.sessionManager = config.sessionManager;
    this.settingsManager = config.settingsManager;
    this.agentCtx = config.agentCtx;
    this._scopedModels = config.scopedModels ?? [];
    this._resourceLoader = config.resourceLoader;
    this._theme = config.theme;
    this._debugLevel = config.debugLevel ?? "off";
    this._bashRunner = new BashRunner({
      getCwd: () => this._cwd,
      getShellCommandPrefix: () => this.settingsManager.getShellCommandPrefix(),
      appendToAgent: (message) => this.agent.appendMessage(message),
      appendToSession: (message) => this.sessionManager.appendMessage(message),
      isStreaming: () => this.isStreaming,
    });
    this._staticCustomTools = config.customTools ?? [];
    this._mcpToolsFactory = config.mcpToolsFactory;
    this._soulManagerFactory = config.soulManagerFactory;
    this._customTools = [...this._staticCustomTools, ...(config.initialMcpTools ?? [])];
    this._initialActiveToolNames = config.initialActiveToolNames;
    this._toolOrchestrator = new ToolOrchestrator({
      customTools: this._customTools,
      initialActiveToolNames: this._initialActiveToolNames,
      getExtensionTools: () =>
        new Map(
          (this._extensionRunner?.getAllRegisteredTools() ?? []).map((tool) => [
            tool.definition.name,
            tool.definition,
          ]),
        ),
    });
    this._toolRuntimeController = new ToolRuntimeController(
      this._toolOrchestrator,
    );
    this._cwd = config.cwd;
    this._agentDir = config.agentDir;
    this._modelRegistry = config.modelRegistry;
    this._extensionRunnerRef = config.extensionRunnerRef;
    this._soulManager = config.soulManager;
    this._baseToolsOverride = config.baseToolsOverride;
    this._createSessionFactory = config.createSession;
    this._extensionEventBridge = new ExtensionEventBridge({
      getExtensionRunner: () => this._extensionRunner,
    });
    this._modelController = new ModelController({
      getModel: () => this.model,
      getThinkingLevel: () => this.thinkingLevel,
      getScopedModels: () => this._scopedModels,
      setAgentModel: (model) => this.agent.setModel(model),
      setAgentThinkingLevel: (level) => this.agent.setThinkingLevel(level),
      setAgentLoopFramework: (framework) => this.agent.setAgentLoopFramework(framework),
      setLoopPolicy: (options) => this.agent.setLoopPolicy(options),
      getApiKey: (model) => this._modelRegistry.getApiKey(model),
      getApiKeyForProvider: (provider) => this._modelRegistry.getApiKeyForProvider(provider),
      getAvailableModels: () => this._modelRegistry.getAvailableAsync(),
      getAuthCredential: (provider) => this._modelRegistry.authStorage.get(provider),
      appendModelChange: (provider, modelId) => this.sessionManager.appendModelChange(provider, modelId),
      appendThinkingLevelChange: (level) => this.sessionManager.appendThinkingLevelChange(level),
      setDefaultModelAndProvider: (provider, modelId) =>
        this.settingsManager.setDefaultModelAndProvider(provider, modelId),
      setDefaultThinkingLevel: (level) => this.settingsManager.setDefaultThinkingLevel(level),
      emitModelSelect: async ({ model, previousModel, source }) => {
        if (!this._extensionRunner) return;
        await this._extensionRunner.emit({
          type: "model_select",
          model,
          previousModel,
          source,
        });
      },
    });
    this._compactionController = new CompactionController({
      getModel: () => this.model,
      getApiKey: (model) => this._modelRegistry.getApiKey(model),
      getExtensionRunner: () => this._extensionRunner,
      getBranch: () => this.sessionManager.getBranch(),
      getEntries: () => this.sessionManager.getEntries(),
      getCompactionSettings: () => this.settingsManager.getCompactionSettings(),
      appendCompaction: (summary, firstKeptEntryId, tokensBefore, details, fromExtension) =>
        this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension),
      applyCompactedMessages: () => {
        const sessionContext = this.sessionManager.buildSessionContext();
        this.agent.replaceMessages(sessionContext.messages);
        return sessionContext.messages;
      },
      logInfo: (message, meta) => this._logger.info(message, meta),
      disconnectFromAgent: () => this._disconnectFromAgent(),
      reconnectToAgent: () => this._reconnectToAgent(),
      abortAgent: () => this.abort(),
      emitAutoCompactionStart: (reason) => this._emit({ type: "auto_compaction_start", reason }),
      emitAutoCompactionEnd: (payload) => this._emit({ type: "auto_compaction_end", ...payload }),
      getAutoCompactionEnabled: () => this.settingsManager.getCompactionEnabled(),
      setAutoCompactionEnabled: (enabled) => this.settingsManager.setCompactionEnabled(enabled),
    });
    this._sessionTreeController = new SessionTreeController({
      getModel: () => this.model,
      getApiKey: (model) => this._modelRegistry.getApiKey(model),
      getExtensionRunner: () => this._extensionRunner,
      getLeafId: () => this.sessionManager.getLeafId(),
      getEntry: (entryId) => this.sessionManager.getEntry(entryId),
      collectBranchSummaryEntries: (oldLeafId, targetId) =>
        collectEntriesForBranchSummary(this.sessionManager, oldLeafId, targetId),
      getBranchSummaryReserveTokens: () => this.settingsManager.getBranchSummarySettings().reserveTokens,
      branchWithSummary: (newLeafId, summaryText, summaryDetails, fromExtension) =>
        this.sessionManager.branchWithSummary(newLeafId, summaryText, summaryDetails, fromExtension),
      appendLabelChange: (entryId, label) => this.sessionManager.appendLabelChange(entryId, label),
      resetLeaf: () => this.sessionManager.resetLeaf(),
      branch: (newLeafId) => this.sessionManager.branch(newLeafId),
      rebuildAgentMessages: () => {
        const sessionContext = this.sessionManager.buildSessionContext();
        this.agent.replaceMessages(sessionContext.messages);
      },
      extractUserMessageText: (content) => this._extractUserMessageText(content),
    });
    this._lifecycleController = new SessionLifecycleController({
      getSessionFile: () => this.sessionManager.getSessionFile(),
      getExtensionRunner: () => this._extensionRunner,
      disconnectFromAgent: () => this._disconnectFromAgent(),
      reconnectToAgent: () => this._reconnectToAgent(),
      abortAgent: () => this.abort(),
      resetAgent: () => this.agent.reset(),
      syncAgentSessionId: () => {
        this.agent.sessionId = this.sessionManager.getSessionId();
      },
      clearPendingQueues: () => {
        this._steeringMessages = [];
        this._followUpMessages = [];
        this._pendingNextTurnMessages = [];
      },
      clearPendingNextTurnMessages: () => {
        this._pendingNextTurnMessages = [];
      },
      sessionNewSession: (parentSession) => this.sessionManager.newSession({ parentSession }),
      sessionSetFile: (path) => this.sessionManager.setSessionFile(path),
      sessionCreateBranchedSession: (parentId) => this.sessionManager.createBranchedSession(parentId),
      getEntry: (entryId) => this.sessionManager.getEntry(entryId),
      buildSessionContext: () => this.sessionManager.buildSessionContext(),
      replaceAgentMessages: (messages) => this.agent.replaceMessages(messages),
      appendThinkingLevelChange: (level) => this.sessionManager.appendThinkingLevelChange(level),
      getThinkingLevel: () => this.thinkingLevel,
      getBranch: () => this.sessionManager.getBranch(),
      getDefaultThinkingLevel: () =>
        this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL,
      getAvailableModels: () => this._modelRegistry.getAvailable(),
      restoreModel: (model) => this._modelController.restoreModel(model),
      restoreThinkingLevel: (opts) => this._modelController.restoreThinkingLevel(opts),
      runSetup: (setup) => setup(this.sessionManager),
      extractUserMessageText: (content) => this._extractUserMessageText(content),
    });
    this.agent.setModelErrorRecovery((event) =>
      this._recoverModelErrorInLoop(event),
    );

    // Always subscribe to agent events for internal handling
    // (session persistence, extensions, auto-compaction, retry logic)
    this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);

    // Listen to external abort signal (e.g., from SubAgent runtime).
    // Track the handler and remove it on dispose so a long-lived parent
    // signal that spawns many short-lived AgentSessions does not accumulate
    // listeners (Node fires MaxListenersExceededWarning at 11).
    if (config.signal) {
      const externalAbortHandler = () => { this.abort(); };
      config.signal.addEventListener("abort", externalAbortHandler, { once: true });
      this._detachExternalAbort = () => {
        config.signal?.removeEventListener("abort", externalAbortHandler);
      };
    }

    this._buildRuntime({
      activeToolNames: this._initialActiveToolNames,
      includeAllExtensionTools: true,
    });

    // Initialize retry coordinator (P1 - extracted from AgentSession)
    this._retryCoordinator = new RetryCoordinator(this._createRetryHost());

    // Initialize structured logger (P2 - observability)
    this._logger = createLogger({
      sessionId: this.sessionManager.getSessionId(),
      component: "agent-session",
    });

    this._emitDebug("basic", "session", "session_created", { sessionId: this.sessionManager.getSessionId() });
  }

  /** Model registry for API key resolution and model discovery */
  get modelRegistry(): ModelRegistry {
    return this._modelRegistry;
  }

  get cwd(): string {
    return this._cwd;
  }

  get agentDir(): string {
    return this._agentDir;
  }

  /**
   * Return all currently available slash-like commands for the session.
   * Includes built-in commands, extension commands, prompt templates, and skills.
   */
  getSlashCommands(): SessionSlashCommandDescriptor[] {
    return buildSessionSlashCommands(
      {
        promptTemplates: this.promptTemplates,
        resourceLoader: this._resourceLoader,
        extensionRunner: this._extensionRunner,
      },
      t,
    );
  }

  /**
   * Try to execute an extension slash command directly.
   * Returns true when a matching extension command was found, even if it failed internally.
   */
  async tryExecuteExtensionCommand(text: string): Promise<boolean> {
    return this._tryExecuteExtensionCommand(text);
  }

  async executeSlashCommand(text: string): Promise<boolean> {
    if (!text.startsWith("/")) return false;

    if (this._slashCommandExecutor) {
      const handled = await this._slashCommandExecutor(text);
      if (handled) {
        return true;
      }
    }

    return this._tryExecuteExtensionCommand(text);
  }

  setSlashCommandExecutor(executor: SlashCommandExecutor | undefined): void {
    this._slashCommandExecutor = executor;
  }

  // =========================================================================
  // Event Subscription
  // =========================================================================

  /** Emit an event to all listeners */
  private _emit(event: AgentSessionEvent): void {
    this._listeners.emit(event);
  }

  private _emitDebug(
    level: "basic" | "verbose",
    source: "session" | "mcp" | "model" | "tool" | "resource" | "extension",
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (this._debugLevel === "off") return;
    if (level === "verbose" && this._debugLevel !== "verbose") return;
    this._emit({ type: "debug", level, source, message, data, timestamp: Date.now() });
  }

  // Track last assistant message for auto-compaction check
  private _lastAssistantMessage: AssistantMessage | undefined = undefined;

  /** Internal handler for agent events - shared by subscribe and reconnect */
  private _handleAgentEvent = async (event: AgentEvent): Promise<void> => {
    // When a user message starts, check if it's from either queue and remove it BEFORE emitting
    // This ensures the UI sees the updated queue state
    if (event.type === "message_start" && event.message.role === "user") {
      const messageText = this._getUserMessageText(event.message);
      if (messageText) {
        // Check steering queue first
        const steeringIndex = this._steeringMessages.indexOf(messageText);
        if (steeringIndex !== -1) {
          this._steeringMessages.splice(steeringIndex, 1);
        } else {
          // Check follow-up queue
          const followUpIndex = this._followUpMessages.indexOf(messageText);
          if (followUpIndex !== -1) {
            this._followUpMessages.splice(followUpIndex, 1);
          }
        }
      }
    }

    // Notify all listeners (UI) first for responsive rendering,
    // then emit to extensions in parallel (they shouldn't block rendering).
    // For high-frequency streaming events (message_update), extensions run in background.
    if (event.type === "message_update") {
      // Streaming updates: emit to UI immediately, don't await extensions
      this._emit(event);
      // Emit dedicated tool_input_delta for tool call argument streaming
      const ame = event.assistantMessageEvent;
      if (ame.type === "toolcall_delta") {
        const block = ame.partial.content[ame.contentIndex] as { id?: string; name?: string } | undefined;
        if (block?.id) {
          this._emit({ type: "tool_input_delta", toolCallId: block.id, toolName: block.name ?? "", delta: ame.delta });
        }
      }
      this._extensionEventBridge.emitExtensionEvent(event).catch((err) => {
        this._logger.error("[extension] message_update event error", { error: err });
      });
    } else {
      // All other events: extensions run concurrently with UI notification
      const extensionPromise = this._extensionEventBridge.emitExtensionEvent(event);
      this._emit(event);
      await extensionPromise;
    }

    // Handle session persistence
    if (event.type === "tool_execution_start") {
      this._emitDebug("verbose", "tool", "tool_start", { toolName: event.toolName, toolCallId: event.toolCallId });
    } else if (event.type === "tool_execution_end") {
      this._emitDebug("verbose", "tool", "tool_end", { toolName: event.toolName, isError: event.isError });
    }

    if (event.type === "message_end") {
      // Check if this is a custom message from extensions
      if (event.message.role === "custom") {
        // Persist as CustomMessageEntry
        this.sessionManager.appendCustomMessageEntry(
          event.message.customType,
          event.message.content,
          event.message.display,
          event.message.details,
        );
      } else if (
        event.message.role === "user" ||
        event.message.role === "assistant" ||
        event.message.role === "toolResult"
      ) {
        // Regular LLM message - persist as SessionMessageEntry
        this.sessionManager.appendMessage(event.message);
      }
      // Other message types (bashExecution, compactionSummary, branchSummary) are persisted elsewhere

      // Track assistant message for auto-compaction (checked on agent_end)
      if (event.message.role === "assistant") {
        this._lastAssistantMessage = event.message;

        // Reset retry counter on successful assistant response
        const assistantMsg = event.message as AssistantMessage;
        if (assistantMsg.stopReason !== "error") {
          this._retryCoordinator.onSuccess();
        }
      }
    }

    // Check auto-retry and auto-compaction after agent completes
    if (event.type === "agent_end" && this._lastAssistantMessage) {
      const msg = this._lastAssistantMessage;
      this._lastAssistantMessage = undefined;

      // Check for retryable errors first (overloaded, rate limit, server errors)
      if (this._retryCoordinator.isRetryableError(msg)) {
        const didRetry = await this._retryCoordinator.handleError(msg);
        if (didRetry) return; // Retry was initiated, don't proceed to compaction
      }

      await this._checkCompaction(msg);

      // Record interaction for Soul (AI personality evolution)
      if (this._soulManager) {
        const outcome = msg.stopReason === "error" ? "failure" : "success";
        const project = this._cwd.split(/[/\\]/).pop() || "unknown";
        const { tags, complexity, toolUsage } = extractSessionContext(
          this.state.messages as Array<{ role: string; content: any }>,
          this._cwd,
        );
        const context = toSoulContext(project, tags, complexity, toolUsage);
        const expertiseDomain = tags[0] || project;
        void (async () => {
          try {
            await this._soulManager.recordInteraction(context, outcome, "turn");
            await this._soulManager.updateExpertise(
              expertiseDomain,
              tags,
              outcome === "success",
            );
          } catch (err) {
            // Keep Soul failures non-blocking for the main session lifecycle.
            this._logger.warn("[soul] recordInteraction/updateExpertise failed", { error: err });
          }
        })();
      }
    }

    if (event.type === "agent_end" && this._extensionRunner) {
      // Emit agent_end only after retry and compaction settle.
      // This lets post-run extensions react to a stable end state.
      void this._extensionRunner
        .emit({
          type: "agent_end",
          messages: event.messages,
        })
        .catch((err) => {
          this._logger.error("[extension] agent_end event error", { error: err });
        });
    }
  };

  /** Extract text content from a message */
  private _getUserMessageText(message: Message): string {
    if (message.role !== "user") return "";
    const content = message.content;
    if (typeof content === "string") return content;
    const textBlocks = content.filter((c) => c.type === "text");
    return textBlocks.map((c) => (c as TextContent).text).join("");
  }

  /** Find the last assistant message in agent state (including aborted ones) */
  private _findLastAssistantMessage(): AssistantMessage | undefined {
    const messages = this.agent.state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant") {
        return msg as AssistantMessage;
      }
    }
    return undefined;
  }

  /**
   * Subscribe to agent events.
   * Session persistence is handled internally (saves messages on message_end).
   * Multiple listeners can be added. Returns unsubscribe function for this listener.
   */
  subscribe(listener: AgentSessionEventListener): () => void {
    return this._listeners.add(listener);
  }

  /**
   * Temporarily disconnect from agent events.
   * User listeners are preserved and will receive events again after resubscribe().
   * Used internally during operations that need to pause event processing.
   */
  private _disconnectFromAgent(): void {
    if (this._unsubscribeAgent) {
      this._unsubscribeAgent();
      this._unsubscribeAgent = undefined;
    }
  }

  /**
   * Reconnect to agent events after _disconnectFromAgent().
   * Preserves all existing listeners.
   */
  private _reconnectToAgent(): void {
    if (this._unsubscribeAgent) return; // Already connected
    this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
  }

  /**
   * Remove all listeners and disconnect from agent.
   * Call this when completely done with the session.
   */
  dispose(): void {
    this._disconnectFromAgent();
    this._extensionRunner?.dispose();
    this._listeners.clear();
    if (this._detachExternalAbort) {
      this._detachExternalAbort();
      this._detachExternalAbort = undefined;
    }
  }

  // =========================================================================
  // Read-only State Access
  // =========================================================================

  /** Full agent state */
  get state(): AgentState {
    return this.agent.state;
  }

  /** Current model (may be undefined if not yet selected) */
  get model(): Model<any> | undefined {
    return this.agent.state.model;
  }

  /** Current thinking level */
  get thinkingLevel(): ThinkingLevel {
    return this.agent.state.thinkingLevel;
  }

  /** Current effective agent loop framework. */
  get agentLoopFramework(): AgentLoopFramework {
    return this.agent.agentLoopFramework;
  }

  /** Whether agent is currently streaming a response */
  get isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  /** Current effective system prompt (includes any per-turn extension modifications) */
  get systemPrompt(): string {
    return this.agent.state.systemPrompt;
  }

  /** Shared Soul manager used by this session, if Soul is enabled. */
  get soulManager(): unknown | undefined {
    return this._soulManager;
  }

  /** Current retry attempt (0 if not retrying) */
  get retryAttempt(): number {
    return this._retryCoordinator.attempt;
  }

  /**
   * Get the names of currently active tools.
   * Returns the names of tools currently set on the agent.
   */
  getActiveToolNames(): string[] {
    return this.agent.state.tools.map((t) => t.name);
  }

  /**
   * Get all configured tools with name, description, and parameter schema.
   */
  getAllTools(): ToolInfo[] {
    return this._toolOrchestrator.getAllTools();
  }

  /**
   * Set active tools by name.
   * Only tools in the registry can be enabled. Unknown tool names are ignored.
   * Also rebuilds the system prompt to reflect the new tool set.
   * Changes take effect on the next agent turn.
   */
  setActiveToolsByName(toolNames: string[]): void {
    const { tools, validToolNames } =
      this._toolOrchestrator.setActiveToolsByName(toolNames);
    this.agent.setTools(tools);

    // Rebuild base system prompt with new tool set
    this._baseSystemPrompt = this._rebuildSystemPrompt(validToolNames);
    this.agent.setSystemPrompt(this._baseSystemPrompt);
  }

  /** Whether auto-compaction is currently running */
  get isCompacting(): boolean {
    return this._compactionController.isCompacting;
  }

  /** All messages including custom types like BashExecutionMessage */
  get messages(): AgentMessage[] {
    return this.agent.state.messages;
  }

  /** Current steering mode */
  get steeringMode(): "all" | "one-at-a-time" {
    return this.agent.getSteeringMode();
  }

  /** Current follow-up mode */
  get followUpMode(): "all" | "one-at-a-time" {
    return this.agent.getFollowUpMode();
  }

  /** Current session file path, or undefined if sessions are disabled */
  get sessionFile(): string | undefined {
    return this.sessionManager.getSessionFile();
  }

  /** Current session ID */
  get sessionId(): string {
    return this.sessionManager.getSessionId();
  }

  /** Current session display name, if set */
  get sessionName(): string | undefined {
    return this.sessionManager.getSessionName();
  }

  /** Scoped models for cycling (from --models flag) */
  get scopedModels(): ReadonlyArray<{
    model: Model<any>;
    thinkingLevel: ThinkingLevel;
  }> {
    return this._scopedModels;
  }

  /** Update scoped models for cycling */
  setScopedModels(
    scopedModels: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>,
  ): void {
    this._scopedModels = scopedModels;
  }

  /** File-based prompt templates */
  get promptTemplates(): ReadonlyArray<PromptTemplate> {
    return this._resourceLoader.getPrompts().prompts;
  }

  private _rebuildSystemPrompt(
    toolNames: string[],
    options?: { soulInjection?: string },
  ): string {
    return buildRuntimeSystemPrompt({
      cwd: this._cwd,
      resourceLoader: this._resourceLoader,
      toolNames,
      baseToolRegistry: this._baseToolRegistry,
      soulInjection: options?.soulInjection ?? this._lastSoulInjection,
    });
  }

  private _getActiveBaseToolNames(): string[] {
    return getActiveBaseToolNames(
      this.getActiveToolNames(),
      this._baseToolRegistry,
    );
  }

  private async _generateSoulInjection(): Promise<string | undefined> {
    if (!this._soulManager) {
      this._lastSoulInjection = undefined;
      return undefined;
    }

    try {
      const project = this._cwd.split(/[/\\]/).pop() || "unknown";
      const { tags, complexity, toolUsage } = extractSessionContext(
        this.state.messages as Array<{ role: string; content: any }>,
        this._cwd,
      );
      const injection = await this._soulManager.generateInjection(
        toSoulContext(project, tags, complexity, toolUsage),
      );
      this._lastSoulInjection =
        typeof injection === "string" && injection.trim().length > 0
          ? injection
          : undefined;
      return this._lastSoulInjection;
    } catch (error) {
      this._emit({ type: "sdk:error", source: "soul", error });
      return this._lastSoulInjection;
    }
  }

  // =========================================================================
  // Prompting
  // =========================================================================

  /**
   * Send a prompt to the agent.
   * - Handles extension commands (registered via api.registerCommand) immediately, even during streaming
   * - Expands file-based prompt templates by default
   * - During streaming, queues via steer() or followUp() based on streamingBehavior option
   * - Validates model and API key before sending (when not streaming)
   * @throws Error if streaming and no streamingBehavior specified
   * @throws Error if no model selected or no API key available (when not streaming)
   */
  async prompt(text: string, options?: PromptOptions): Promise<void> {
    const _promptStart = performance.now();
    const expandPromptTemplates = options?.expandPromptTemplates ?? true;
    this._dbg(`prompt: "${text.slice(0, 80)}" isStreaming=${this.isStreaming} hasModel=${!!this.model}`);

    // Handle slash commands first (execute immediately, even during streaming)
    // Built-in and extension commands manage their own interaction paths.
    if (expandPromptTemplates && text.startsWith("/")) {
      const handled = await this.executeSlashCommand(text);
      this._dbg(`prompt: slash handled=${handled}`);
      if (handled) {
        // Extension command executed, no prompt to send
        return;
      }
    }

    // Emit input event for extension interception (before skill/template expansion)
    let currentText = text;
    let currentImages = options?.images;
    if (this._extensionRunner?.hasHandlers("input")) {
      const inputResult = await this._extensionRunner.emitInput(
        currentText,
        currentImages,
        options?.source ?? "interactive",
      );
      if (inputResult.action === "handled") {
        return;
      }
      if (inputResult.action === "transform") {
        currentText = inputResult.text;
        currentImages = inputResult.images ?? currentImages;
      }
    }

    // Expand skill commands (/skill:name args) and prompt templates (/template args)
    let expandedText = currentText;
    if (expandPromptTemplates) {
      expandedText = this._expandSkillCommand(expandedText);
      expandedText = expandPromptTemplate(expandedText, [
        ...this.promptTemplates,
      ]);
    }

    // If streaming, queue via steer() or followUp() based on option
    if (this.isStreaming) {
      if (!options?.streamingBehavior) {
        throw new Error(
          "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
        );
      }
      if (options.streamingBehavior === "followUp") {
        await this._queueFollowUp(expandedText, currentImages);
      } else {
        await this._queueSteer(expandedText, currentImages);
      }
      return;
    }

    // Flush any pending bash messages before the new prompt
    this._bashRunner.flushPending();

    // Validate model
    if (!this.model) {
      throw new Error(
        "No model selected.\n\n" +
          `Use /login or set an API key environment variable. See ${join(getDocsPath(), "providers.md")}\n\n` +
          "Then use /model to select a model.",
      );
    }

    // Validate API key
    const apiKey = await this._modelRegistry.getApiKey(this.model);
    if (!apiKey) {
      const isOAuth = this._modelRegistry.isUsingOAuth(this.model);
      if (isOAuth) {
        throw new Error(
          `Authentication failed for "${this.model.provider}". ` +
            `Credentials may have expired or network is unavailable. ` +
            `Run '/login ${this.model.provider}' to re-authenticate.`,
        );
      }
      throw new Error(
        `No API key found for ${this.model.provider}.\n\n` +
          `Use /login or set an API key environment variable. See ${join(getDocsPath(), "providers.md")}`,
      );
    }

    // Check if we need to compact before sending (catches aborted responses)
    const lastAssistant = this._findLastAssistantMessage();
    if (lastAssistant) {
      await this._checkCompaction(lastAssistant, false);
    }

    // Build messages array (custom message if any, then user message)
    const messages: AgentMessage[] = [];

    // Add user message
    const userContent: (TextContent | ImageContent)[] = [
      { type: "text", text: expandedText },
    ];
    if (currentImages) {
      userContent.push(...currentImages);
    }
    messages.push({
      role: "user",
      content: userContent,
      timestamp: Date.now(),
    });

    // Inject any pending "nextTurn" messages as context alongside the user message
    for (const msg of this._pendingNextTurnMessages) {
      messages.push(msg);
    }
    this._pendingNextTurnMessages = [];

    const activeBaseToolNames = this._getActiveBaseToolNames();
    const soulInjection = await this._generateSoulInjection();
    this._baseSystemPrompt = this._rebuildSystemPrompt(activeBaseToolNames, {
      soulInjection,
    });

    // Emit before_agent_start extension event
    if (this._extensionRunner) {
      const result = await this._extensionRunner.emitBeforeAgentStart(
        expandedText,
        currentImages,
        this._baseSystemPrompt,
      );
      // Add all custom messages from extensions
      if (result?.messages) {
        for (const msg of result.messages) {
          messages.push({
            role: "custom",
            customType: msg.customType,
            content: msg.content,
            display: msg.display,
            details: msg.details,
            timestamp: Date.now(),
          });
        }
      }
      // Apply extension-modified system prompt, or reset to base
      if (result?.systemPrompt) {
        this.agent.setSystemPrompt(result.systemPrompt);
      } else {
        // Ensure we're using the base prompt (in case previous turn had modifications)
        this.agent.setSystemPrompt(this._baseSystemPrompt);
      }
    } else {
      this.agent.setSystemPrompt(this._baseSystemPrompt);
    }

    this._dbg(`calling agent.prompt with ${messages.length} message(s)`);
    await this.agent.prompt(messages);
    this._dbg(`agent.prompt returned (${(performance.now() - _promptStart).toFixed(0)}ms)`);
    await this.waitForRetry();
  }

  /**
   * Try to execute an extension command. Returns true if command was found and executed.
   *
   * Delegates to ExtensionRunner.invokeCommand() so command dispatch, error
   * routing (emitError), and telemetry (ext_command_events) all happen in one
   * place rather than being scattered across modes.
   */
  private async _tryExecuteExtensionCommand(text: string): Promise<boolean> {
    if (!this._extensionRunner) return false;

    const spaceIndex = text.indexOf(" ");
    const commandName =
      spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

    const ctx = this._extensionRunner.createCommandContext();
    const result = await this._extensionRunner.invokeCommand(commandName, args, ctx, {
      sessionId: this.sessionManager.getSessionId(),
    });
    return result.found;
  }

  /**
   * Expand skill commands (/skill:name args) to their full content.
   * Returns the expanded text, or the original text if not a skill command or skill not found.
   * Emits errors via extension runner if file read fails.
   */
  private _expandSkillCommand(text: string): string {
    if (!text.startsWith("/skill:")) return text;

    const spaceIndex = text.indexOf(" ");
    const skillName =
      spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
    const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

    const skill = this.resourceLoader
      .getSkills()
      .skills.find((s) => s.name === skillName);
    if (!skill) return text; // Unknown skill, pass through

    try {
      const content = readFileSync(skill.filePath, "utf-8");
      const body = stripFrontmatter(content).trim();
      const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
      return args ? `${skillBlock}\n\n${args}` : skillBlock;
    } catch (err) {
      // Emit error like extension commands do
      this._extensionRunner?.emitError({
        extensionPath: skill.filePath,
        event: "skill_expansion",
        error: err instanceof Error ? err.message : String(err),
      });
      return text; // Return original on error
    }
  }

  /**
   * Queue a steering message to interrupt the agent mid-run.
   * Delivered after current tool execution, skips remaining tools.
   * Expands skill commands and prompt templates. Errors on extension commands.
   * @param images Optional image attachments to include with the message
   * @throws Error if text is an extension command
   */
  async steer(text: string, images?: ImageContent[]): Promise<void> {
    // Check for extension commands (cannot be queued)
    if (text.startsWith("/")) {
      this._throwIfExtensionCommand(text);
    }

    // Expand skill commands and prompt templates
    let expandedText = this._expandSkillCommand(text);
    expandedText = expandPromptTemplate(expandedText, [
      ...this.promptTemplates,
    ]);

    await this._queueSteer(expandedText, images);
  }

  /**
   * Queue a follow-up message to be processed after the agent finishes.
   * Delivered only when agent has no more tool calls or steering messages.
   * Expands skill commands and prompt templates. Errors on extension commands.
   * @param images Optional image attachments to include with the message
   * @throws Error if text is an extension command
   */
  async followUp(text: string, images?: ImageContent[]): Promise<void> {
    // Check for extension commands (cannot be queued)
    if (text.startsWith("/")) {
      this._throwIfExtensionCommand(text);
    }

    // Expand skill commands and prompt templates
    let expandedText = this._expandSkillCommand(text);
    expandedText = expandPromptTemplate(expandedText, [
      ...this.promptTemplates,
    ]);

    await this._queueFollowUp(expandedText, images);
  }

  /**
   * Internal: Queue a steering message (already expanded, no extension command check).
   */
  private async _queueSteer(
    text: string,
    images?: ImageContent[],
  ): Promise<void> {
    this._steeringMessages.push(text);
    const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
    if (images) {
      content.push(...images);
    }
    this.agent.steer({
      role: "user",
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Internal: Queue a follow-up message (already expanded, no extension command check).
   */
  private async _queueFollowUp(
    text: string,
    images?: ImageContent[],
  ): Promise<void> {
    this._followUpMessages.push(text);
    const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
    if (images) {
      content.push(...images);
    }
    this.agent.followUp({
      role: "user",
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Throw an error if the text is an extension command.
   */
  private _throwIfExtensionCommand(text: string): void {
    if (!this._extensionRunner) return;

    const spaceIndex = text.indexOf(" ");
    const commandName =
      spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    const command = this._extensionRunner.getCommand(commandName);

    if (command) {
      throw new Error(
        `Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
      );
    }
  }

  /**
   * Send a custom message to the session. Creates a CustomMessageEntry.
   *
   * Handles three cases:
   * - Streaming: queues message, processed when loop pulls from queue
   * - Not streaming + triggerTurn: appends to state/session, starts new turn
   * - Not streaming + no trigger: appends to state/session, no turn
   *
   * @param message Custom message with customType, content, display, details
   * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
   * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
   */
  async sendCustomMessage<T = unknown>(
    message: Pick<
      CustomMessage<T>,
      "customType" | "content" | "display" | "details"
    >,
    options?: {
      triggerTurn?: boolean;
      deliverAs?: "steer" | "followUp" | "nextTurn";
    },
  ): Promise<void> {
    const appMessage = {
      role: "custom" as const,
      customType: message.customType,
      content: message.content,
      display: message.display,
      details: message.details,
      timestamp: Date.now(),
    } satisfies CustomMessage<T>;
    if (options?.deliverAs === "nextTurn") {
      this._pendingNextTurnMessages.push(appMessage);
    } else if (this.isStreaming) {
      if (options?.deliverAs === "followUp") {
        this.agent.followUp(appMessage);
      } else {
        this.agent.steer(appMessage);
      }
    } else if (options?.triggerTurn) {
      await this.agent.prompt(appMessage);
    } else {
      this.agent.appendMessage(appMessage);
      this.sessionManager.appendCustomMessageEntry(
        message.customType,
        message.content,
        message.display,
        message.details,
      );
      this._emit({ type: "message_start", message: appMessage });
      this._emit({ type: "message_end", message: appMessage });
    }
  }

  /**
   * Send a user message to the agent. Always triggers a turn.
   * When the agent is streaming, use deliverAs to specify how to queue the message.
   *
   * @param content User message content (string or content array)
   * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
   */
  async sendUserMessage(
    content: string | (TextContent | ImageContent | DocumentContent)[],
    options?: { deliverAs?: "steer" | "followUp" },
  ): Promise<void> {
    // Normalize content to text string + optional images
    let text: string;
    let images: ImageContent[] | undefined;

    if (typeof content === "string") {
      text = content;
    } else {
      const textParts: string[] = [];
      images = [];
      for (const part of content) {
        if (part.type === "text") {
          textParts.push(part.text);
        } else if (part.type === "image") {
          images.push(part);
        }
        // DocumentContent blocks are not supported in sendUserMessage; skip them
      }
      text = textParts.join("\n");
      if (images.length === 0) images = undefined;
    }

    // Use prompt() with expandPromptTemplates: false to skip command handling and template expansion
    await this.prompt(text, {
      expandPromptTemplates: false,
      streamingBehavior: options?.deliverAs,
      images,
      source: "extension",
    });
  }

  /**
   * Clear all queued messages and return them.
   * Useful for restoring to editor when user aborts.
   * @returns Object with steering and followUp arrays
   */
  clearQueue(): { steering: string[]; followUp: string[] } {
    const steering = [...this._steeringMessages];
    const followUp = [...this._followUpMessages];
    this._steeringMessages = [];
    this._followUpMessages = [];
    this.agent.clearAllQueues();
    return { steering, followUp };
  }

  /** Number of pending messages (includes both steering and follow-up) */
  get pendingMessageCount(): number {
    return this._steeringMessages.length + this._followUpMessages.length;
  }

  /** Get pending steering messages (read-only) */
  getSteeringMessages(): readonly string[] {
    return this._steeringMessages;
  }

  /** Get pending follow-up messages (read-only) */
  getFollowUpMessages(): readonly string[] {
    return this._followUpMessages;
  }

  get resourceLoader(): ResourceLoader {
    return this._resourceLoader;
  }

  /**
   * Abort current operation and wait for agent to become idle.
   */
  async abort(): Promise<void> {
    this.abortRetry();
    this.agent.abort();
    await this.agent.waitForIdle();
    void this._extensionRunner?.emit({ type: "agent_abort" });
  }

  /**
   * Start a new session, optionally with initial messages and parent tracking.
   * Clears all messages and starts a new session.
   * Listeners are preserved and will continue receiving events.
   * @param options.parentSession - Optional parent session path for tracking
   * @param options.setup - Optional callback to initialize session (e.g., append messages)
   * @returns true if completed, false if cancelled by extension
   */
  async newSession(options?: {
    parentSession?: string;
    setup?: (sessionManager: SessionManager) => Promise<void>;
  }): Promise<boolean> {
    return this._lifecycleController.newSession(options);
  }

  // =========================================================================
  // Model Management
  // =========================================================================

  // =========================================================================
  // Model & Thinking Level Management — delegated to ModelController
  // =========================================================================

  /** Set model directly. @throws if no API key available. */
  async setModel(model: Model<any>): Promise<void> {
    await this._modelController.setModel(model);
    this._emitDebug("basic", "model", "model_change", { provider: model.api, modelId: model.id });
  }

  /** Cycle to next/previous model. @returns new model info, or undefined if only one. */
  async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
    const result = await this._modelController.cycleModel(direction);
    if (result) this._emitDebug("basic", "model", "model_cycle", { direction, provider: result.model.api, modelId: result.model.id });
    return result;
  }

  /** Set thinking level, clamped to model capabilities; persists on change. */
  setThinkingLevel(level: ThinkingLevel): void {
    this._modelController.setThinkingLevel(level);
  }

  /** Set the session-level agent loop framework override. */
  setAgentLoopFramework(framework: AgentLoopFrameworkInput | undefined): void {
    this._modelController.setAgentLoopFramework(framework);
  }

  /** Update runtime loop policy options for subsequent turns. */
  setLoopPolicy(options: Partial<AgentLoopPolicyOptions>): void {
    this._modelController.setLoopPolicy(options);
  }

  /** Cycle to next thinking level. @returns new level, or undefined if unsupported. */
  cycleThinkingLevel(): ThinkingLevel | undefined {
    return this._modelController.cycleThinkingLevel();
  }

  /** Thinking levels available for the current model. */
  getAvailableThinkingLevels(): ThinkingLevel[] {
    return this._modelController.getAvailableThinkingLevels();
  }

  /** Whether the current model supports xhigh thinking level. */
  supportsXhighThinking(): boolean {
    return this._modelController.supportsXhighThinking();
  }

  /** Whether the current model supports thinking/reasoning. */
  supportsThinking(): boolean {
    return this._modelController.supportsThinking();
  }

  // =========================================================================
  // Queue Mode Management
  // =========================================================================

  /**
   * Set steering message mode.
   * Saves to settings.
   */
  setSteeringMode(mode: "all" | "one-at-a-time"): void {
    this.agent.setSteeringMode(mode);
    this.settingsManager.setSteeringMode(mode);
  }

  /**
   * Set follow-up message mode.
   * Saves to settings.
   */
  setFollowUpMode(mode: "all" | "one-at-a-time"): void {
    this.agent.setFollowUpMode(mode);
    this.settingsManager.setFollowUpMode(mode);
  }

  // =========================================================================
  // Compaction
  // =========================================================================

  /**
   * Manually compact the session context.
   * Aborts current agent operation first.
   * @param customInstructions Optional instructions for the compaction summary
   */
  async compact(customInstructions?: string): Promise<CompactionResult> {
    return this._compactionController.compact(customInstructions);
  }

  /**
   * Cancel in-progress compaction (manual or auto).
   */
  abortCompaction(): void {
    this._compactionController.abort();
  }

  /**
   * Cancel in-progress branch summarization.
   */
  abortBranchSummary(): void {
    this._sessionTreeController.abortBranchSummary();
  }

  /**
   * Check if compaction is needed and run it.
   * Called after agent_end and before prompt submission.
   *
   * Two cases:
   * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
   * 2. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
   *
   * @param assistantMessage The assistant message to check
   * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
   */
  private async _checkCompaction(
    assistantMessage: AssistantMessage,
    skipAbortedCheck = true,
  ): Promise<void> {
    const settings = this.settingsManager.getCompactionSettings();
    if (!settings.enabled) return;

    // Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
    if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return;

    const contextWindow = this.model?.contextWindow ?? 0;

    // Skip overflow check if the message came from a different model.
    // This handles the case where user switched from a smaller-context model (e.g. opus)
    // to a larger-context model (e.g. codex) - the overflow error from the old model
    // shouldn't trigger compaction for the new model.
    const sameModel =
      this.model &&
      assistantMessage.provider === this.model.provider &&
      assistantMessage.model === this.model.id;

    // Skip overflow check if the error is from before a compaction in the current path.
    // This handles the case where an error was kept after compaction (in the "kept" region).
    // The error shouldn't trigger another compaction since we already compacted.
    // Example: opus fails → switch to codex → compact → switch back to opus → opus error
    // is still in context but shouldn't trigger compaction again.
    const compactionEntry = getLatestCompactionEntry(
      this.sessionManager.getBranch(),
    );
    const errorIsFromBeforeCompaction =
      compactionEntry !== null &&
      assistantMessage.timestamp <
        new Date(compactionEntry.timestamp).getTime();

    // Case 1: Overflow - LLM returned context overflow error
    if (
      sameModel &&
      !errorIsFromBeforeCompaction &&
      isContextOverflow(assistantMessage, contextWindow)
    ) {
      // Remove the error message from agent state (it IS saved to session for history,
      // but we don't want it in context for the retry)
      const messages = this.agent.state.messages;
      if (
        messages.length > 0 &&
        messages[messages.length - 1].role === "assistant"
      ) {
        this.agent.replaceMessages(messages.slice(0, -1));
      }
      await this._runAutoCompaction("overflow", true);
      return;
    }

    // Case 2: Threshold - turn succeeded but context is getting large
    // Skip if this was an error (non-overflow errors don't have usage data)
    if (assistantMessage.stopReason === "error") return;

    const contextTokens = calculateContextTokens(assistantMessage.usage);
    if (shouldCompact(contextTokens, contextWindow, settings)) {
      await this._runAutoCompaction("threshold", false);
    }
  }

  private async _recoverModelErrorInLoop(event: {
    message: AgentMessage;
    messages: AgentMessage[];
    errorSubtype: string;
    attempt: number;
  }): Promise<AgentModelErrorRecoveryResult> {
    const settings = this.settingsManager.getCompactionSettings();
    if (event.message.role !== "assistant") return { action: "stop" };

    const assistantMessage = event.message as AssistantMessage;
    if (event.errorSubtype !== "context_overflow") {
      if (!this._retryCoordinator.isRetryableError(assistantMessage)) {
        return { action: "stop" };
      }
      const shouldRetry =
        await this._retryCoordinator.handleErrorInLoop(assistantMessage);
      if (!shouldRetry) return { action: "stop" };
      const retryMessages = pruneRecoverableErrorTail(
        this.agent.state.messages,
        assistantMessage,
      );
      this.agent.replaceMessages(retryMessages);
      return {
        action: "retry",
        messages: retryMessages,
        transition: {
          reason: "model_error_recovery",
          subtype: event.errorSubtype,
          attempt: event.attempt,
        },
      };
    }

    if (!settings.enabled) return { action: "stop" };

    const contextWindow = this.model?.contextWindow ?? 0;
    const sameModel =
      this.model &&
      assistantMessage.provider === this.model.provider &&
      assistantMessage.model === this.model.id;
    if (!sameModel || !isContextOverflow(assistantMessage, contextWindow)) {
      return { action: "stop" };
    }

    const compactionEntry = getLatestCompactionEntry(
      this.sessionManager.getBranch(),
    );
    const errorIsFromBeforeCompaction =
      compactionEntry !== null &&
      assistantMessage.timestamp < new Date(compactionEntry.timestamp).getTime();
    if (errorIsFromBeforeCompaction) return { action: "stop" };

    const messages = this.agent.state.messages;
    this.agent.replaceMessages(
      pruneRecoverableErrorTail(messages, assistantMessage),
    );

    const recoveredMessages = await this._runAutoCompaction("overflow", true, {
      triggerContinue: false,
    });
    if (!recoveredMessages) return { action: "stop" };
    return {
      action: "retry",
      messages: recoveredMessages,
      transition: {
        reason: "model_error_recovery",
        subtype: event.errorSubtype,
        attempt: event.attempt,
      },
    };
  }

  /**
   * Internal: Run auto-compaction with events.
   */
  private async _runAutoCompaction(
    reason: "overflow" | "threshold",
    willRetry: boolean,
    options?: { triggerContinue?: boolean },
  ): Promise<AgentMessage[] | undefined> {
    const triggerContinue = options?.triggerContinue ?? true;
    const messages = await this._compactionController.runAuto(reason, willRetry);
    if (messages === undefined) return undefined;

    // Loop continuation (owned by AgentSession): retry the failed turn or kick the queue.
    if (willRetry && triggerContinue) {
      const current = this.agent.state.messages;
      const lastMsg = current[current.length - 1];
      if (lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).stopReason === "error") {
        this.agent.replaceMessages(current.slice(0, -1));
      }
      setTimeout(() => {
        this.agent.continue().catch(() => {});
      }, 100);
    } else if (!willRetry && this.agent.hasQueuedMessages()) {
      // Auto-compaction can complete while follow-up/steering/custom messages are waiting.
      // Kick the loop so queued messages are actually delivered.
      setTimeout(() => {
        this.agent.continue().catch(() => {});
      }, 100);
    }
    return messages;
  }

  /**
   * Toggle auto-compaction setting.
   */
  setAutoCompactionEnabled(enabled: boolean): void {
    this._compactionController.setAutoCompactionEnabled(enabled);
  }

  /** Whether auto-compaction is enabled */
  get autoCompactionEnabled(): boolean {
    return this._compactionController.autoCompactionEnabled;
  }

  async bindExtensions(bindings: ExtensionBindings): Promise<void> {
    if (bindings.uiContext !== undefined) {
      this._extensionUIContext = bindings.uiContext;
    }
    if (bindings.commandContextActions !== undefined) {
      this._extensionCommandContextActions = bindings.commandContextActions;
    }
    if (bindings.shutdownHandler !== undefined) {
      this._extensionShutdownHandler = bindings.shutdownHandler;
    }
    if (bindings.onError !== undefined) {
      this._extensionErrorListener = bindings.onError;
    }

    if (this._extensionRunner) {
      this._applyExtensionBindings(this._extensionRunner);
      await this._extensionRunner.emit({ type: "session_start" });
      await this.extendResourcesFromExtensions("startup");
    }
    this._emitDebug("basic", "extension", "extensions_bound");
  }

  private async extendResourcesFromExtensions(
    reason: "startup" | "reload",
  ): Promise<void> {
    if (!this._extensionRunner?.hasHandlers("resources_discover")) {
      return;
    }

    const { skillPaths, promptPaths, themePaths } =
      await this._extensionRunner.emitResourcesDiscover(this._cwd, reason);

    if (
      skillPaths.length === 0 &&
      promptPaths.length === 0 &&
      themePaths.length === 0
    ) {
      return;
    }

    const extensionPaths: ResourceExtensionPaths = {
      skillPaths: this.buildExtensionResourcePaths(skillPaths),
      promptPaths: this.buildExtensionResourcePaths(promptPaths),
      themePaths: this.buildExtensionResourcePaths(themePaths),
    };

    this._resourceLoader.extendResources(extensionPaths);
    this._baseSystemPrompt = this._rebuildSystemPrompt(
      this.getActiveToolNames(),
    );
    this.agent.setSystemPrompt(this._baseSystemPrompt);
  }

  private buildExtensionResourcePaths(
    entries: Array<{ path: string; extensionPath: string }>,
  ): Array<{
    path: string;
    metadata: {
      source: string;
      scope: "temporary";
      origin: "top-level";
      baseDir?: string;
    };
  }> {
    return entries.map((entry) => {
      const source = this.getExtensionSourceLabel(entry.extensionPath);
      const baseDir = entry.extensionPath.startsWith("<")
        ? undefined
        : dirname(entry.extensionPath);
      return {
        path: entry.path,
        metadata: {
          source,
          scope: "temporary",
          origin: "top-level",
          baseDir,
        },
      };
    });
  }

  private getExtensionSourceLabel(extensionPath: string): string {
    if (extensionPath.startsWith("<")) {
      return `extension:${extensionPath.replace(/[<>]/g, "")}`;
    }
    const base = basename(extensionPath);
    const name = base.replace(/\.(ts|js)$/, "");
    return `extension:${name}`;
  }

  private _applyExtensionBindings(runner: ExtensionRunner): void {
    runner.setUIContext(this._extensionUIContext);
    runner.bindCommandContext(this._extensionCommandContextActions);

    this._extensionErrorUnsubscriber?.();
    this._extensionErrorUnsubscriber = this._extensionErrorListener
      ? runner.onError(this._extensionErrorListener)
      : undefined;
  }

  private _bindExtensionCore(runner: ExtensionRunner): void {
    const thisSession = this;
    bindExtensionCore(runner, {
      promptTemplates: this.promptTemplates,
      resourceLoader: this._resourceLoader,
      modelRegistry: this.modelRegistry,
      sessionManager: this.sessionManager,
      settingsManager: this.settingsManager,
      shutdownHandler: this._extensionShutdownHandler,
      soulManager: this._soulManager,
      get model() {
        return thisSession.model;
      },
      get thinkingLevel() {
        return thisSession.thinkingLevel;
      },
      get isStreaming() {
        return thisSession.isStreaming;
      },
      get pendingMessageCount() {
        return thisSession.pendingMessageCount;
      },
      get systemPrompt() {
        return thisSession.systemPrompt;
      },
      sendCustomMessage: (message, options) =>
        this.sendCustomMessage(message, options),
      sendUserMessage: (content, options) =>
        this.sendUserMessage(content, options),
      executeSlashCommand: (text) => this.executeSlashCommand(text),
      getActiveToolNames: () => this.getActiveToolNames(),
      getAllTools: () => this.getAllTools(),
      setActiveToolsByName: (toolNames) =>
        this.setActiveToolsByName(toolNames),
      setModel: (model) => this.setModel(model),
      setThinkingLevel: (level) => this.setThinkingLevel(level),
      abort: () => this.abort(),
      clearFollowUpQueue: () => {
        this.agent.clearFollowUpQueue();
        // Keep the UI mirror in sync: cleared messages will never be delivered,
        // so the message_start removal path can never prune them.
        this._followUpMessages = [];
      },
      getContextUsage: () => this.getContextUsage(),
      compact: (customInstructions) => this.compact(customInstructions),
    });
  }

  private _buildRuntime(options: {
    activeToolNames?: string[];
    flagValues?: Map<string, boolean | string>;
    includeAllExtensionTools?: boolean;
  }): void {
    const baseTools = this._baseToolsOverride
      ? this._baseToolsOverride
      : createDefaultRuntimeTools(this._cwd, this.settingsManager);

    this._baseToolRegistry = new Map(
      Object.entries(baseTools).map(([name, tool]) => [
        name,
        tool as AgentTool,
      ]),
    );

    const extensionsResult = this._resourceLoader.getExtensions();
    if (options.flagValues) {
      for (const [name, value] of options.flagValues) {
        extensionsResult.runtime.flagValues.set(name, value);
      }
    }

    const hasExtensions = extensionsResult.extensions.length > 0;
    const hasCustomTools = this._customTools.length > 0;
    this._extensionRunner =
      hasExtensions || hasCustomTools
        ? new ExtensionRunner(
            extensionsResult.extensions,
            extensionsResult.runtime,
            this._cwd,
            this._agentDir,
            this.sessionManager,
            this._modelRegistry,
          )
        : undefined;
    if (this._extensionRunnerRef) {
      this._extensionRunnerRef.current = this._extensionRunner;
    }
    if (this._extensionRunner) {
      this._bindExtensionCore(this._extensionRunner);
      this._applyExtensionBindings(this._extensionRunner);
      // P1 extension telemetry: every /command invocation writes one row to
      // ext_command_events. Returns a noop sink when no insforge credentials
      // are configured, so this is zero-cost for users not opted in.
      this._extensionRunner.setTelemetrySink(
        createExtensionTelemetrySink({ workspaceRoot: this._cwd }),
      );
    }

    const toolRuntime = this._toolRuntimeController.build({
      baseTools: this._baseToolRegistry,
      baseToolsOverride: this._baseToolsOverride,
      customTools: this._customTools,
      activeToolNames: options.activeToolNames,
      includeAllExtensionTools: options.includeAllExtensionTools,
      extensionRunner: this._extensionRunner,
    });

    // --- CC-style Agent tool injection ---
    // Recreate on each build so the tool always references current model & MCP tools.
    const onSubAgentEvent = (event: SubAgentEvent) => {
      const mapped = mapSubAgentEvent(event);
      if (mapped) this._emit(mapped);
    };
    this._agentTool = createAgentTool({
      parentSession: this as any,  // any to avoid circular type reference
      parentPermissionMode: "default",
      parentModel: this.model,
      createSession: this._createSessionFactory!,
      onSubAgentEvent,
    });
    toolRuntime.activeTools.push(this._agentTool as unknown as AgentTool);
    this._toolOrchestrator.registerTool(AGENT_TOOL_NAME, this._agentTool as unknown as AgentTool);
    // Register Task alias too
    const taskTool = createTaskToolAlias({
      parentSession: this as any,
      parentPermissionMode: "default",
      parentModel: this.model,
      createSession: this._createSessionFactory!,
      onSubAgentEvent,
    });
    toolRuntime.activeTools.push(taskTool as unknown as AgentTool);
    this._toolOrchestrator.registerTool(TASK_TOOL_NAME, taskTool as unknown as AgentTool);

    // --- SendMessage tool (CC §XI: inter-agent messaging) ---
    const sendMessageTool = createSendMessageTool({
      parentSession: this as any,
      parentPermissionMode: "default",
      parentModel: this.model,
      createSession: this._createSessionFactory!,
    });
    toolRuntime.activeTools.push(sendMessageTool as unknown as AgentTool);
    this._toolOrchestrator.registerTool(SEND_MESSAGE_TOOL_NAME, sendMessageTool as unknown as AgentTool);

    // Also register Task alias name for system prompt tool name list
    if (!toolRuntime.systemPromptToolNames.includes(AGENT_TOOL_NAME)) {
      toolRuntime.systemPromptToolNames.push(AGENT_TOOL_NAME);
    }
    if (!toolRuntime.systemPromptToolNames.includes(SEND_MESSAGE_TOOL_NAME)) {
      toolRuntime.systemPromptToolNames.push(SEND_MESSAGE_TOOL_NAME);
    }
    this.agent.setTools(toolRuntime.activeTools);
    this._baseSystemPrompt = this._rebuildSystemPrompt(
      toolRuntime.systemPromptToolNames,
    );
    this.agent.setSystemPrompt(this._baseSystemPrompt);
  }

  /**
   * Run the MCP tools factory and merge the result into `_customTools`.
   * Shared by reload() and warmupMcpTools(). Does NOT rebuild the runtime —
   * the caller decides when to call _buildRuntime() (reload batches it with the
   * soul refresh; warmup rebuilds on its own).
   * @returns number of MCP tools now loaded.
   */
  private async _refreshMcpTools(): Promise<number> {
    if (!this._mcpToolsFactory) return 0;
    try {
      const nextMcpTools = await this._mcpToolsFactory();
      this._customTools = [...this._staticCustomTools, ...nextMcpTools];
      return nextMcpTools.length;
    } catch (error) {
      this._emit({ type: "sdk:error", source: "mcp", error });
      // Keep previously-loaded MCP tools on failure.
      const previousMcpTools = this._customTools.filter((t) =>
        // Heuristic: MCP tools are prefixed with mcp_ in current codebase.
        t.name.startsWith("mcp_"),
      );
      this._customTools = [...this._staticCustomTools, ...previousMcpTools];
      return previousMcpTools.length;
    }
  }

  /**
   * Load MCP tools and merge them into the live runtime WITHOUT a full reload.
   *
   * Startup no longer blocks on MCP server spawn/handshake (which can take many
   * seconds — npx-based default servers measured ~20s). Interactive mode calls
   * this fire-and-forget once the UI is ready; one-shot modes (print/acp/rpc)
   * await it before their first turn (createAgentSession does this internally
   * unless `deferMcpInit` is set). No-op when MCP is disabled.
   *
   * Emits `sdk:mcp_ready` so the UI can surface a status line.
   */
  async warmupMcpTools(): Promise<void> {
    if (!this._mcpToolsFactory) return;
    try {
      const toolCount = await this._refreshMcpTools();
      this._buildRuntime({
        activeToolNames: this.getActiveToolNames(),
        flagValues: this._extensionRunner?.getFlagValues(),
        includeAllExtensionTools: true,
      });
      this._emit({ type: "sdk:mcp_ready", toolCount });
      this._emitDebug("basic", "mcp", "mcp_warmup_complete", { toolCount });
    } catch (error) {
      // MCP problems must never crash startup (background warmup is
      // fire-and-forget; one-shot modes await but should still boot).
      this._emit({ type: "sdk:error", source: "mcp", error });
    }
  }

  async reload(): Promise<void> {
    this._emitDebug("basic", "resource", "reload_start");
    const previousFlagValues = this._extensionRunner?.getFlagValues();
    await this._extensionRunner?.emit({ type: "session_shutdown" });
    this.settingsManager.reload();
    resetApiProviders();
    await this._resourceLoader.reload();

    // Refresh dynamic managers/tools using updated env (e.g. persona switch).
    // This enables runtime tool changes without restarting the whole process.
    await this._refreshMcpTools();

    if (this._soulManagerFactory) {
      try {
        this._soulManager = await this._soulManagerFactory();
        this._lastSoulInjection = undefined;
      } catch (error) {
        this._emit({ type: "sdk:error", source: "soul", error });
        // Keep previous _soulManager on failure.
      }
    }

    this._buildRuntime({
      activeToolNames: this.getActiveToolNames(),
      flagValues: previousFlagValues,
      includeAllExtensionTools: true,
    });

    const hasBindings =
      this._extensionUIContext ||
      this._extensionCommandContextActions ||
      this._extensionShutdownHandler ||
      this._extensionErrorListener;
    if (this._extensionRunner && hasBindings) {
      await this._extensionRunner.emit({ type: "session_start" });
      await this.extendResourcesFromExtensions("reload");
    }
    this._emitDebug("basic", "resource", "reload_end");
  }

  // =========================================================================
  // Auto-Retry
  // =========================================================================

  /** Create the RetryCoordinator host adapter. */
  private _createRetryHost(): RetryCoordinatorHost {
    return {
      getContextWindow: () => this.model?.contextWindow ?? 0,
      getRetrySettings: () => this.settingsManager.getRetrySettings(),
      removeLastAssistantMessage: () => {
        const messages = this.agent.state.messages;
        if (
          messages.length > 0 &&
          messages[messages.length - 1].role === "assistant"
        ) {
          this.agent.replaceMessages(messages.slice(0, -1));
        }
      },
      triggerContinue: () => {
        setTimeout(() => {
          this.agent.continue().catch(() => {});
        }, 0);
      },
      emitEvent: (event: RetrySessionEvent) => {
        this._emit(event);
      },
    };
  }

  /**
   * Cancel in-progress retry.
   */
  abortRetry(): void {
    this._retryCoordinator.abort();
  }

  /**
   * Wait for any in-progress retry to complete.
   * Returns immediately if no retry is in progress.
   */
  private async waitForRetry(): Promise<void> {
    await this._retryCoordinator.waitForCompletion();
  }

  /** Whether auto-retry is currently in progress */
  get isRetrying(): boolean {
    return this._retryCoordinator.isActive;
  }

  /** Whether auto-retry is enabled */
  get autoRetryEnabled(): boolean {
    return this.settingsManager.getRetryEnabled();
  }

  /**
   * Toggle auto-retry setting.
   */
  setAutoRetryEnabled(enabled: boolean): void {
    this.settingsManager.setRetryEnabled(enabled);
  }

  // =========================================================================
  // Bash Execution
  // =========================================================================

  /**
   * Execute a bash command.
   * Adds result to agent context and session.
   * @param command The bash command to execute
   * @param onChunk Optional streaming callback for output
   * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
   * @param options.operations Custom BashOperations for remote execution
   */
  async executeBash(
    command: string,
    onChunk?: (chunk: string) => void,
    options?: { excludeFromContext?: boolean; operations?: BashOperations },
  ): Promise<BashResult> {
    return this._bashRunner.execute(command, onChunk, options);
  }

  /**
   * Record a bash execution result in session history.
   * Used by executeBash and by extensions that handle bash execution themselves.
   */
  recordBashResult(
    command: string,
    result: BashResult,
    options?: { excludeFromContext?: boolean },
  ): void {
    this._bashRunner.recordResult(command, result, options);
  }

  /**
   * Cancel running bash command.
   */
  abortBash(): void {
    this._bashRunner.abort();
  }

  /** Whether a bash command is currently running */
  get isBashRunning(): boolean {
    return this._bashRunner.isRunning;
  }

  /** Whether there are pending bash messages waiting to be flushed */
  get hasPendingBashMessages(): boolean {
    return this._bashRunner.hasPending;
  }

  // =========================================================================
  // Session Management
  // =========================================================================

  /**
   * Switch to a different session file.
   * Aborts current operation, loads messages, restores model/thinking.
   * Listeners are preserved and will continue receiving events.
   * @returns true if switch completed, false if cancelled by extension
   */
  async switchSession(sessionPath: string): Promise<boolean> {
    return this._lifecycleController.switchSession(sessionPath);
  }

  /**
   * Set a display name for the current session.
   */
  setSessionName(name: string): void {
    this.sessionManager.appendSessionInfo(name);
  }

  /**
   * Create a fork from a specific entry.
   * Emits before_fork/fork session events to extensions.
   *
   * @param entryId ID of the entry to fork from
   * @returns Object with:
   *   - selectedText: The text of the selected user message (for editor pre-fill)
   *   - cancelled: True if an extension cancelled the fork
   */
  async fork(
    entryId: string,
  ): Promise<{ selectedText: string; cancelled: boolean }> {
    return this._lifecycleController.fork(entryId);
  }

  // =========================================================================
  // Tree Navigation
  // =========================================================================

  /**
   * Navigate to a different node in the session tree.
   * Unlike fork() which creates a new session file, this stays in the same file.
   *
   * @param targetId The entry ID to navigate to
   * @param options.summarize Whether user wants to summarize abandoned branch
   * @param options.customInstructions Custom instructions for summarizer
   * @param options.replaceInstructions If true, customInstructions replaces the default prompt
   * @param options.label Label to attach to the branch summary entry
   * @returns Result with editorText (if user message) and cancelled status
   */
  async navigateTree(
    targetId: string,
    options: {
      summarize?: boolean;
      customInstructions?: string;
      replaceInstructions?: boolean;
      label?: string;
    } = {},
  ): Promise<{
    editorText?: string;
    cancelled: boolean;
    aborted?: boolean;
    summaryEntry?: BranchSummaryEntry;
  }> {
    return this._sessionTreeController.navigateTree(targetId, options);
  }

  /**
   * Get all user messages from session for fork selector.
   */
  getUserMessagesForForking(): Array<{ entryId: string; text: string }> {
    const entries = this.sessionManager.getEntries();
    const result: Array<{ entryId: string; text: string }> = [];

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      if (entry.message.role !== "user") continue;

      const text = this._extractUserMessageText(entry.message.content);
      if (text) {
        result.push({ entryId: entry.id, text });
      }
    }

    return result;
  }

  private _extractUserMessageText(
    content: string | Array<{ type: string; text?: string }>,
  ): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
    }
    return "";
  }

  /**
   * Get session statistics.
   */
  getSessionStats(): SessionStats {
    const state = this.state;
    const userMessages = state.messages.filter((m) => m.role === "user").length;
    const assistantMessages = state.messages.filter(
      (m) => m.role === "assistant",
    ).length;
    const toolResults = state.messages.filter(
      (m) => m.role === "toolResult",
    ).length;

    let toolCalls = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;

    for (const message of state.messages) {
      if (message.role === "assistant") {
        const assistantMsg = message as AssistantMessage;
        toolCalls += assistantMsg.content.filter(
          (c) => c.type === "toolCall",
        ).length;
        totalInput += assistantMsg.usage.input;
        totalOutput += assistantMsg.usage.output;
        totalCacheRead += assistantMsg.usage.cacheRead;
        totalCacheWrite += assistantMsg.usage.cacheWrite;
        totalCost += assistantMsg.usage.cost.total;
      }
    }

    return {
      sessionFile: this.sessionFile,
      sessionId: this.sessionId,
      userMessages,
      assistantMessages,
      toolCalls,
      toolResults,
      totalMessages: state.messages.length,
      tokens: {
        input: totalInput,
        output: totalOutput,
        cacheRead: totalCacheRead,
        cacheWrite: totalCacheWrite,
        total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
      },
      cost: totalCost,
    };
  }

  getContextUsage(): ContextUsage | undefined {
    const model = this.model;
    if (!model) return undefined;

    const contextWindow = model.contextWindow ?? 0;
    if (contextWindow <= 0) return undefined;

    // After compaction, the last assistant usage reflects pre-compaction context size.
    // We can only trust usage from an assistant that responded after the latest compaction.
    // If no such assistant exists, context token count is unknown until the next LLM response.
    const branchEntries = this.sessionManager.getBranch();
    const latestCompaction = getLatestCompactionEntry(branchEntries);

    if (latestCompaction) {
      // Check if there's a valid assistant usage after the compaction boundary
      const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
      let hasPostCompactionUsage = false;
      for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
        const entry = branchEntries[i];
        if (entry.type === "message" && entry.message.role === "assistant") {
          const assistant = entry.message;
          if (
            assistant.stopReason !== "aborted" &&
            assistant.stopReason !== "error"
          ) {
            const contextTokens = calculateContextTokens(assistant.usage);
            if (contextTokens > 0) {
              hasPostCompactionUsage = true;
            }
            break;
          }
        }
      }

      if (!hasPostCompactionUsage) {
        return { tokens: null, contextWindow, percent: null };
      }
    }

    const estimate = estimateContextTokens(this.messages);
    const percent = (estimate.tokens / contextWindow) * 100;

    return {
      tokens: estimate.tokens,
      contextWindow,
      percent,
    };
  }

  /**
   * Export session to HTML.
   * @param outputPath Optional output path (defaults to session directory)
   * @returns Path to exported file
   */
  async exportToHtml(outputPath?: string): Promise<string> {
    return await exportSessionHtml({
      sessionManager: this.sessionManager,
      state: this.state,
      outputPath,
      themeName: this.settingsManager.getTheme(),
      extensionRunner: this._extensionRunner,
      theme: this._theme,
    });
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  /**
   * Get text content of last assistant message.
   * Useful for /copy command.
   * @returns Text content, or undefined if no assistant message exists
   */
  getLastAssistantText(): string | undefined {
    return getLastAssistantText(this.messages);
  }

  // =========================================================================
  // Extension System
  // =========================================================================

  /**
   * Check if extensions have handlers for a specific event type.
   */
  hasExtensionHandlers(eventType: string): boolean {
    return this._extensionRunner?.hasHandlers(eventType) ?? false;
  }

  /**
   * Get the extension runner (for setting UI context and error handlers).
   */
  get extensionRunner(): ExtensionRunner | undefined {
    return this._extensionRunner;
  }
}
