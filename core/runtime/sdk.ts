/**
 * [WHO]: createAgentSession(options) → AgentSession + load results
 * [FROM]: Depends on agent-core, ai, core/config/*, core/tools/*, core/session/*, core/mcp-*, i18n/*
 * [TO]: Consumed by index.ts, main.ts, test/presence-opening.test.ts, extensions/defaults/team/index.ts
 * [HERE]: SDK factory; creates all services with DI, wires up extensions
 */
import { join } from "node:path";
import {
  Agent,
  type AgentMessage,
  type ThinkingLevel,
} from "@pencil-agent/agent-core";
import type { Message, Model } from "@pencil-agent/ai";
import { getAgentDir, getDocsPath } from "../../config.js";
import { AgentSession } from "./agent-session.js";
import { AuthStorage } from "../config/auth-storage.js";
import { DEFAULT_THINKING_LEVEL } from "../defaults.js";
import type {
  ExtensionRunner,
  LoadExtensionsResult,
  ToolDefinition,
} from "../extensions/index.js";
import { convertToLlm } from "../messages.js";
import { MCPManager } from "../mcp-manager.js";
import { registerFigmaMcpOAuthProvider } from "../mcp/figma-auth.js";
import { ModelRegistry } from "../model-registry.js";
import { findInitialModel } from "../model-resolver.js";
import type { ResourceLoader } from "../config/resource-loader.js";
import { DefaultResourceLoader } from "../config/resource-loader.js";
import { SessionManager } from "../session/session-manager.js";
import { SettingsManager } from "../config/settings-manager.js";
import { AgentDirContext, defaultAgentDirContext } from "../agent-dir/agent-dir-context.js";
import { time } from "../timings.js";
import {
  isSoulEnabled,
  toSoulContext,
  createSoulManager,
} from "../soul-integration.js";
// @ts-ignore - soul-core package is bundled at runtime
import type { SoulManager } from "@pencil-agent/soul-core";
import {
  allTools,
  bashTool,
  codingTools,
  createBashTool,
  createCodingTools,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadOnlyTools,
  createReadTool,
  createWriteTool,
  editTool,
  findTool,
  grepTool,
  lsTool,
  readOnlyTools,
  readTool,
  type Tool,
  type ToolName,
  writeTool,
} from "../tools/index.js";

// ============================================================================
// Logger Interface (for SDK users)
// ============================================================================

/**
 * Custom logger interface for SDK users.
 * Replace console.error/warn/info with user-provided handlers.
 */
export interface SDKLogger {
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
}

/**
 * Silent logger - suppresses all output
 */
export const silentLogger: SDKLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
};

/**
 * Default logger - uses console
 */
export const defaultLogger: SDKLogger = {
  error: (msg, ...args) => console.error(msg, ...args),
  warn: (msg, ...args) => console.warn(msg, ...args),
  info: (msg, ...args) => console.log(msg, ...args),
};

export interface CreateAgentSessionOptions {
  /** Working directory for project-local discovery. Default: process.cwd() */
  cwd?: string;
  /** Global config directory. Default: ~/.pencils/agents/default */
  agentDir?: string;
  /** Multi-agent context. */
  agentCtx?: AgentDirContext;

  /** Auth storage for credentials. Default: AuthStorage.create(agentDir/auth.json) */
  authStorage?: AuthStorage;
  /** Model registry. Default: new ModelRegistry(authStorage, agentDir/models.json) */
  modelRegistry?: ModelRegistry;

  /** Model to use. Default: from settings, else first available */
  model?: Model<any>;
  /** Thinking level. Default: from settings, else 'medium' (clamped to model capabilities) */
  thinkingLevel?: ThinkingLevel;
  /** Models available for cycling (Ctrl+P in interactive mode) */
  scopedModels?: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;

  /** Built-in tools to use. Default: codingTools [read, bash, edit, write] */
  tools?: Tool[];
  /** Custom tools to register (in addition to built-in tools). */
  customTools?: ToolDefinition[];
  /** Enable MCP (Model Context Protocol) tools. Default: false */
  enableMCP?: boolean;
  /** Enable Soul (AI personality evolution). Default: true */
  enableSoul?: boolean;

  /** Resource loader. When omitted, DefaultResourceLoader is used. */
  resourceLoader?: ResourceLoader;

  /** Session manager. Default: SessionManager.create(cwd) */
  sessionManager?: SessionManager;

  /** Settings manager. Default: SettingsManager.create(cwd, agentDir) */
  settingsManager?: SettingsManager;

  /** External abort signal for stopping the session (e.g., from SubAgent runtime) */
  signal?: AbortSignal;

  /** Suppress all console output. Default: false */
  silent?: boolean;

  /** Custom logger for SDK output. Default: console */
  logger?: SDKLogger;
}

type SettingsManagerLike = Partial<SettingsManager> & {
  getSettings?: () => { locale?: "en" | "zh" };
};

/** Result from createAgentSession */
export interface CreateAgentSessionResult {
  /** The created session */
  session: AgentSession;
  /** Extensions result (for UI context setup in interactive mode) */
  extensionsResult: LoadExtensionsResult;
  /** Warning if session was restored with a different model than saved */
  modelFallbackMessage?: string;
  /** Soul manager for AI personality (if enabled) */
  soulManager?: any;
}

// Re-exports

export type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
  SlashCommandInfo,
  SlashCommandLocation,
  SlashCommandSource,
  ToolDefinition,
} from "../extensions/index.js";
export type { PromptTemplate } from "../prompt/prompt-templates.js";
export type { Skill } from "../skills.js";
export type { Tool } from "../tools/index.js";

export {
  // Pre-built tools (use process.cwd())
  readTool,
  bashTool,
  editTool,
  writeTool,
  grepTool,
  findTool,
  lsTool,
  codingTools,
  readOnlyTools,
  allTools as allBuiltInTools,
  // Tool factories (for custom cwd)
  createCodingTools,
  createReadOnlyTools,
  createReadTool,
  createBashTool,
  createEditTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
  createLsTool,
};

function normalizeSettingsManager(
  candidate: SettingsManagerLike | undefined,
  cwd: string,
  ctx: AgentDirContext,
): SettingsManager {
  if (candidate instanceof SettingsManager) {
    return candidate;
  }

  const fallback = SettingsManager.create(cwd, ctx);
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  if (typeof candidate.getSettings !== "function") {
    return fallback;
  }

  const wrapper = fallback as SettingsManagerLike;
  for (const key of Object.keys(candidate) as Array<keyof SettingsManagerLike>) {
    const value = candidate[key];
    if (typeof value === "function") {
      (wrapper as Record<string, unknown>)[key as string] = value.bind(candidate);
    }
  }
  return fallback;
}

// Helper Functions

function getDefaultAgentDir(): string {
  return getAgentDir();
}

/**
 * Create an AgentSession with the specified options.
 *
 * @example
 * ```typescript
 * // Minimal - uses defaults
 * const { session } = await createAgentSession();
 *
 * // With explicit model
 * import { getModel } from '@pencil-agent/ai';
 * const { session } = await createAgentSession({
 *   model: getModel('anthropic', 'claude-opus-4-5'),
 *   thinkingLevel: 'high',
 * });
 *
 * // Continue previous session
 * const { session, modelFallbackMessage } = await createAgentSession({
 *   continueSession: true,
 * });
 *
 * // Full control
 * const loader = new DefaultResourceLoader({
 *   cwd: process.cwd(),
 *   agentDir: getAgentDir(),
 *   settingsManager: SettingsManager.create(),
 * });
 * await loader.reload();
 * const { session } = await createAgentSession({
 *   model: myModel,
 *   tools: [readTool, bashTool],
 *   resourceLoader: loader,
 *   sessionManager: SessionManager.inMemory(),
 * });
 * ```
 */
export async function createAgentSession(
  options: CreateAgentSessionOptions = {},
): Promise<CreateAgentSessionResult> {
  registerFigmaMcpOAuthProvider();
  const isProductionBuild =
    typeof import.meta.url === "string" && import.meta.url.includes("node_modules");
  const isProductionLike =
    process.env.NODE_ENV === "production" ||
    (process.env.NODE_ENV !== "development" && isProductionBuild);

  // Setup logger
  const logger = options.silent ? silentLogger : (options.logger ?? defaultLogger);

  const cwd = options.cwd ?? process.cwd();
  const agentCtx = options.agentCtx ?? defaultAgentDirContext();
  const agentDir = options.agentDir ?? agentCtx.path;
  let resourceLoader = options.resourceLoader;

  const settingsManager = normalizeSettingsManager(
    options.settingsManager as SettingsManagerLike | undefined,
    cwd,
    agentCtx,
  );

  // Initialize i18n with locale from settings (or default to English)
  const locale = settingsManager.getSettings().locale ?? "en";
  const { setLocale } = await import("../i18n/index.js");
  setLocale(locale);

  // Use provided or create AuthStorage and ModelRegistry
  const authStorage = options.authStorage ?? AuthStorage.create(agentCtx);
  const modelsPath = join(agentDir, "models.json");
  const modelRegistry =
    options.modelRegistry ?? new ModelRegistry(authStorage, modelsPath);

  const sessionManager = options.sessionManager ?? SessionManager.create(cwd, undefined, agentCtx);

  if (!resourceLoader) {
    resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      agentCtx,
    });
    await resourceLoader.reload();
    time("resourceLoader.reload");
  }

  // Check if session has existing data to restore
  const existingSession = sessionManager.buildSessionContext();
  const hasExistingSession = existingSession.messages.length > 0;
  const hasThinkingEntry = sessionManager
    .getBranch()
    .some((entry) => entry.type === "thinking_level_change");

  let model = options.model;
  let modelFallbackMessage: string | undefined;

  // If session has data, try to restore model from it
  if (!model && hasExistingSession && existingSession.model) {
    const restoredModel = modelRegistry.find(
      existingSession.model.provider,
      existingSession.model.modelId,
    );
    if (restoredModel && (await modelRegistry.getApiKey(restoredModel))) {
      model = restoredModel;
    }
    if (!model) {
      modelFallbackMessage = `Could not restore model ${existingSession.model.provider}/${existingSession.model.modelId}`;
    }
  }

  // If still no model, use findInitialModel (checks settings default, then provider defaults)
  if (!model) {
    const result = await findInitialModel({
      scopedModels: [],
      isContinuing: hasExistingSession,
      defaultProvider: settingsManager.getDefaultProvider(),
      defaultModelId: settingsManager.getDefaultModel(),
      defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
      modelRegistry,
    });
    model = result.model;
    if (!model) {
      modelFallbackMessage = `No models available. Use /login or set an API key environment variable. See ${join(getDocsPath(), "providers.md")}. Then use /model to select a model.`;
    } else if (modelFallbackMessage) {
      modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
    }
  }

  let thinkingLevel = options.thinkingLevel;

  // If session has data, restore thinking level from it
  if (thinkingLevel === undefined && hasExistingSession) {
    thinkingLevel = hasThinkingEntry
      ? (existingSession.thinkingLevel as ThinkingLevel)
      : (settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
  }

  // Fall back to settings default
  if (thinkingLevel === undefined) {
    thinkingLevel =
      settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
  }

  // Clamp to model capabilities
  if (!model || !model.reasoning) {
    thinkingLevel = "off";
  }

  const defaultActiveToolNames: ToolName[] = ["read", "bash", "edit", "write"];
  const initialActiveToolNames: ToolName[] = options.tools
    ? options.tools
        .map((t) => t.name)
        .filter((n): n is ToolName => n in allTools)
    : defaultActiveToolNames;

  let agent: Agent;

  // Create convertToLlm wrapper that filters images if blockImages is enabled (defense-in-depth)
  const convertToLlmWithBlockImages = (messages: AgentMessage[]): Message[] => {
    const converted = convertToLlm(messages);
    // Check setting dynamically so mid-session changes take effect
    if (!settingsManager.getBlockImages()) {
      return converted;
    }
    // Filter out ImageContent from all messages, replacing with text placeholder
    return converted.map((msg) => {
      if (msg.role === "user" || msg.role === "toolResult") {
        const content = msg.content;
        if (Array.isArray(content)) {
          const hasImages = content.some((c) => c.type === "image");
          if (hasImages) {
            const filteredContent = content
              .map((c) =>
                c.type === "image"
                  ? {
                      type: "text" as const,
                      text: "Image reading is disabled.",
                    }
                  : c,
              )
              .filter(
                (c, i, arr) =>
                  // Dedupe consecutive "Image reading is disabled." texts
                  !(
                    c.type === "text" &&
                    c.text === "Image reading is disabled." &&
                    i > 0 &&
                    arr[i - 1].type === "text" &&
                    (arr[i - 1] as { type: "text"; text: string }).text ===
                      "Image reading is disabled."
                  ),
              );
            return { ...msg, content: filteredContent };
          }
        }
      }
      return msg;
    });
  };

  const extensionRunnerRef: { current?: ExtensionRunner } = {};

  agent = new Agent({
    initialState: {
      systemPrompt: "",
      model,
      thinkingLevel,
      tools: [],
    },
    convertToLlm: convertToLlmWithBlockImages,
    sessionId: sessionManager.getSessionId(),
    transformContext: async (messages) => {
      const runner = extensionRunnerRef.current;
      if (!runner) return messages;
      return runner.emitContext(messages);
    },
    steeringMode: settingsManager.getSteeringMode(),
    followUpMode: settingsManager.getFollowUpMode(),
    transport: settingsManager.getTransport(),
    thinkingBudgets: settingsManager.getThinkingBudgets(),
    maxRetryDelayMs: settingsManager.getRetrySettings().maxDelayMs,
    getApiKey: async (provider) => {
      // Use the provider argument from the in-flight request;
      // agent.state.model may already be switched mid-turn.
      const resolvedProvider = provider || agent.state.model?.provider;
      if (!resolvedProvider) {
        throw new Error("No model selected");
      }
      const key = await modelRegistry.getApiKeyForProvider(resolvedProvider);
      if (!key) {
        const model = agent.state.model;
        const isOAuth = model && modelRegistry.isUsingOAuth(model);
        if (isOAuth) {
          throw new Error(
            `Authentication failed for "${resolvedProvider}". ` +
              `Credentials may have expired or network is unavailable. ` +
              `Run '/login ${resolvedProvider}' to re-authenticate.`,
          );
        }
        throw new Error(
          `No API key found for "${resolvedProvider}". ` +
            `Set an API key environment variable or run '/login ${resolvedProvider}'.`,
        );
      }
      return key;
    },
  });

  // Restore messages if session has existing data
  if (hasExistingSession) {
    agent.replaceMessages(existingSession.messages);
    if (!hasThinkingEntry) {
      sessionManager.appendThinkingLevelChange(thinkingLevel);
    }
  } else {
    // Save initial model and thinking level for new sessions so they can be restored on resume
    if (model) {
      sessionManager.appendModelChange(model.provider, model.id);
    }
    sessionManager.appendThinkingLevelChange(thinkingLevel);
  }

  // Initialize MCP if enabled (before creating AgentSession)
  let currentMcpManager: MCPManager | undefined;
  let initialMcpTools: ToolDefinition[] = [];
  const staticCustomTools = options.customTools ?? [];
  let mcpToolsFactory: (() => Promise<ToolDefinition[]>) | undefined;
  if (options.enableMCP) {
    try {
      currentMcpManager = new MCPManager();
      currentMcpManager.setWorkingDir(cwd);
      await currentMcpManager.initialize();
      initialMcpTools = [...currentMcpManager.getTools()];
      time("mcp.initialize");
      const mcpStatus = currentMcpManager.getStatus();
      if (isProductionLike) {
        // Production mode: concise summary
        const started = mcpStatus.startedServers;
        const failed = mcpStatus.failedServers;
        if (started.length > 0) {
          logger.info(`MCP: ${started.length} server(s) ready (${started.join(", ")})`);
        }
        if (failed.length > 0) {
          logger.warn(`MCP: ${failed.length} failed (${failed.join(", ")})`);
        }
      } else {
        // Dev mode: detailed info
        if (mcpStatus.toolCount === 0) {
          const failed =
            mcpStatus.failedServers.length > 0
              ? ` failed=${mcpStatus.failedServers.join(",")}`
              : "";
          logger.warn(
            `MCP enabled but no tools loaded (enabled=${mcpStatus.enabledServers.length}, started=${mcpStatus.startedServers.length}, tools=0).${failed}`,
          );
        } else {
          logger.info(`MCP tools loaded: ${mcpStatus.toolCount}`);
          if (mcpStatus.failedServers.length > 0) {
            logger.warn(
              `MCP: ${mcpStatus.failedServers.length} server(s) failed to start (${mcpStatus.failedServers.join(", ")}); tools from other servers are still available.`,
            );
          }
        }
      }
      process.once("exit", () => currentMcpManager?.dispose());
    } catch (error) {
      logger.warn(`Failed to initialize MCP: ${error}`);
    }

    mcpToolsFactory = async () => {
      try {
        // Stop old MCP servers before re-initializing with updated env/config.
        currentMcpManager?.dispose();
      } catch {
        // ignore
      }
      currentMcpManager = new MCPManager();
      currentMcpManager.setWorkingDir(cwd);
      await currentMcpManager.initialize();
      time("mcp.initialize");
      return currentMcpManager.getTools();
    };
  }

  // Initialize Soul if enabled (before creating AgentSession)
  let soulManager: SoulManager | undefined;
  let soulManagerFactory: (() => Promise<SoulManager | null>) | undefined;
  if (isSoulEnabled(options)) {
    try {
      const soulMgr = await createSoulManager(agentCtx);
      if (soulMgr) {
        soulManager = soulMgr;
        await soulMgr.initialize();
        time("soul.initialize");
      } else {
        logger.warn(
          "Soul not available (nanosoul package not installed). Skipping...",
        );
      }
    } catch (error) {
      logger.warn(`Failed to initialize Soul: ${error}`);
    }

    soulManagerFactory = async () => {
      try {
        const mgr = await createSoulManager(agentCtx);
        if (!mgr) return null;
        await mgr.initialize();
        time("soul.initialize");
        return mgr;
      } catch (error) {
        logger.warn(`Failed to refresh Soul: ${error}`);
        return null;
      }
    };
  }

  const session = new AgentSession({
    agent,
    sessionManager,
    settingsManager,
    cwd,
    agentDir,
    agentCtx,
    scopedModels: options.scopedModels,
    resourceLoader,
    customTools: staticCustomTools,
    initialMcpTools,
    mcpToolsFactory,
    modelRegistry,
    initialActiveToolNames,
    extensionRunnerRef,
    soulManager,
    soulManagerFactory,
    signal: options.signal,
  });

  const extensionsResult = resourceLoader.getExtensions();

  return {
    session,
    extensionsResult,
    modelFallbackMessage,
    soulManager,
  };
}
