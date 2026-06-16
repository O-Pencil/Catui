/**
 * [WHO]: AgentDefinition interface, AgentDefinitionSource, AgentPermissionMode, built-in agent definitions
 * [FROM]: Depends on @catui/agent-core for AgentMessage, @catui/ai for Model
 * [TO]: Consumed by ./agent-tool, ./agent-registry, ./index.ts, extensions/builtin/subagent/*
 * [HERE]: core/sub-agent/agent-definition.ts - Agent type definitions per CC Agent architecture (cc-agent-design §IV, §V)
 * [COVENANT]: Add/remove fields → update P2 AGENT.md member list
 */

// ============================================================================
// Enums / Constants
// ============================================================================

/** Where an agent definition comes from (CC: source field). */
export type AgentDefinitionSource =
  | "built-in"
  | "plugin"
  | "flagSettings"
  | "userSettings"
  | "projectSettings";

/** Permission mode for spawned agents (CC: permissionMode field). */
export type AgentPermissionMode =
  | "acceptEdits"   // Default mode — edits need confirmation
  | "auto"          // Auto mode — most operations auto-approved
  | "bypassPermissions" // Skip all permission checks
  | "default"       // Standard mode
  | "dontAsk"       // Don't ask — reject unauthorized operations
  | "plan";         // Read-only + plan mode

/** Isolation mode. Currently only "worktree" is supported. */
export type AgentIsolationMode = "worktree";

/** Memory scope for agent definitions. */
export type AgentMemoryScope = "user" | "project" | "local";

/** Effort level for reasoning. */
export type AgentEffort = "low" | "medium" | "high" | number;

/** Fork context inheritance mode (CC: forksParentContext). */
export type ForksParentContext = true | "turn" | undefined;

/** Maximum result size in characters (CC: maxResultSizeChars = 1e5). */
export const MAX_RESULT_SIZE_CHARS = 100_000;

/** Auto-background threshold in milliseconds (CC: 120000 = 2 minutes). */
export const AUTO_BACKGROUND_THRESHOLD_MS = 120_000;

/** Default timeout for MCP server availability checks (CC: 30 seconds). */
export const MCP_AVAILABILITY_CHECK_TIMEOUT_MS = 30_000;

// ============================================================================
// AgentDefinition (CC §IV — full interface)
// ============================================================================

/**
 * Full agent definition matching CC's AgentDefinition interface.
 * Controls everything about a spawned sub-agent: tools, model, prompt, isolation, etc.
 */
export interface AgentDefinition {
  // === Required ===
  /** Unique identifier for this agent type, e.g. "general-purpose", "Explore" */
  agentType: string;
  /** One-line description shown to the parent agent when choosing which sub-agent to use */
  description: string;
  /**
   * When-to-use guidance for the parent agent.
   * ⚠️ Can be a function reference (like CC's Explore agent) — runs at runtime to
   * dynamically generate guidance based on context.
   */
  whenToUse: string | (() => string);
  /**
   * System prompt builder.
   * Receives a context object and returns the full system prompt string.
   * Fork mode uses the parent's renderedSystemPrompt directly instead.
   */
  getSystemPrompt: (ctx: AgentSystemPromptContext) => string;

  // === Tool control (mutually exclusive: tools OR disallowedTools) ===
  /**
   * Tool whitelist. ["*"] = inherit all parent tools.
   * If undefined, falls through to disallowedTools (blacklist approach).
   */
  tools?: string[];
  /**
   * Tool blacklist. Listed tools are removed from the parent's tool set.
   * E.g. Explore: ["Agent", "Edit", "Write"] prevents spawning + editing.
   */
  disallowedTools?: string[];

  // === Model ===
  /** Model override: "sonnet" | "opus" | "haiku" | "inherit" | a specific model ID. "inherit" = use parent model. */
  model?: string;
  /** Reasoning effort level. */
  effort?: AgentEffort;

  // === Permissions ===
  /** Permission mode for the spawned agent. Inherits from parent if undefined. */
  permissionMode?: AgentPermissionMode;

  // === Isolation ===
  /** Isolation mode. "worktree" creates a git worktree so the agent works on an isolated copy. */
  isolation?: AgentIsolationMode;

  // === Background ===
  /**
   * Agent definition-level background flag.
   * ⚠️ Different from the run_in_background parameter — this controls whether
   * the agent type itself defaults to background execution.
   */
  background?: boolean;

  // === Fork behavior ===
  /**
   * Controls which parent messages the fork inherits.
   * true = inherit all parent messages
   * "turn" = only inherit current turn's messages
   * undefined = no inheritance (fresh start)
   */
  forksParentContext?: ForksParentContext;

  // === MCP ===
  /** MCP servers that must be available for this agent to function. Agent will error if missing. */
  requiredMcpServers?: string[];
  /** MCP servers associated with this agent. */
  mcpServers?: string[];

  // === Other ===
  /** Where this definition came from. */
  source: AgentDefinitionSource;
  /** Base directory for resolving relative paths in the definition. */
  baseDir: string;
  /** UI color identifier for status rendering. */
  color?: string;
  /** Maximum number of agent turns before forced completion. */
  maxTurns?: number;
  /** Skills associated with this agent definition. */
  skills?: string[];
  /** Initial prompt injected before the user's task prompt. */
  initialPrompt?: string;
  /** Memory scope: determines which memory context to load. */
  memory?: AgentMemoryScope;
  /** Whether to skip loading CLAUDE.md / AGENTS.md / .CATUI.md context files. */
  omitContextFiles?: boolean;
  /** Whether to append (rather than replace) the system prompt. */
  appendSystemPrompt?: boolean;
  /** Hook configuration for lifecycle events. */
  hooks?: Record<string, unknown>;
  /** Filename (for custom agents loaded from .md / .json files). */
  filename?: string;
}

// ============================================================================
// AgentSystemPromptContext
// ============================================================================

/**
 * Context passed to AgentDefinition.getSystemPrompt().
 * Mirrors CC's toolUseContext shape (simplified for Catui).
 */
export interface AgentSystemPromptContext {
  /** The cwd for this agent run (may differ from parent if worktree/cwd override is used). */
  cwd: string;
  /** Whether the agent is running in fork mode (inherits parent prompt). */
  isFork?: boolean;
  /** Additional working directories (worktree paths, etc.) for Notes injection. */
  additionalWorkingDirs?: string[];
  /** Model name being used by this agent. */
  model?: string;
  /** Tool use context from parent (for permission checks, tool resolution). */
  toolUseContext?: unknown;
}

// ============================================================================
// Built-in Agent Definitions (CC §V)
// ============================================================================

/**
 * general-purpose agent (CC §5.1)
 * - tools: ["*"] — inherits all parent tools
 * - System prompt: inherits parent agent's system prompt
 */
export const GENERAL_PURPOSE_AGENT: AgentDefinition = {
  agentType: "general-purpose",
  description: "General-purpose agent for complex multi-step tasks",
  whenToUse:
    "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. " +
    "When you are searching for a keyword or file and are not confident that you will find the right match " +
    "in the first few tries, use this agent to perform the search for you.",
  tools: ["*"],
  source: "built-in",
  baseDir: "built-in",
  getSystemPrompt: (ctx: AgentSystemPromptContext) => {
    // Inherit parent agent's system prompt — the actual inheritance
    // happens at spawn time via parentSession.renderedSystemPrompt.
    // This function is only called when fork mode isn't available.
    return buildDefaultSubAgentPrompt(ctx);
  },
};

/**
 * Explore agent (CC §5.2)
 * - disallowedTools: ["Agent", "Edit", "Write"] — read-only, no recursion
 * - model: "haiku" — fast and cheap
 * - omitContextFiles: true — skip CLAUDE.md / AGENTS.md
 */
export const EXPLORE_AGENT: AgentDefinition = {
  agentType: "Explore",
  description: "Read-only exploration agent for searching code and answering questions",
  whenToUse: () =>
    "Explore agent for searching code, finding files, and answering questions about the codebase. " +
    "Use this when you need to search for a specific pattern, understand how code works, " +
    "or find relevant files. This agent is read-only — it cannot edit files or spawn sub-agents.",
  disallowedTools: ["Agent", "Edit", "Write"],
  source: "built-in",
  baseDir: "built-in",
  model: "haiku",
  omitContextFiles: true,
  getSystemPrompt: () => buildExploreAgentPrompt(),
};

/**
 * Plan agent (CC §5.3)
 * - disallowedTools: ["Agent", "Edit", "Write"] — read-only, no recursion
 * - model: "inherit" — uses parent model
 * - omitContextFiles: true
 */
export const PLAN_AGENT: AgentDefinition = {
  agentType: "Plan",
  description: "Software architect agent for designing implementation plans",
  whenToUse:
    "Software architect agent for designing implementation plans. Use this when you need to plan " +
    "the implementation strategy for a task. Returns step-by-step plans, identifies critical files, " +
    "and considers architectural trade-offs.",
  disallowedTools: ["Agent", "Edit", "Write"],
  source: "built-in",
  baseDir: "built-in",
  model: "inherit",
  omitContextFiles: true,
  getSystemPrompt: () => buildPlanAgentPrompt(),
};

/**
 * statusline-setup agent (CC §5.4)
 * - tools: ["Read", "Edit"] — only read and edit, no Bash/Write
 * - model: "sonnet"
 * - color: "orange"
 */
export const STATUSLINE_SETUP_AGENT: AgentDefinition = {
  agentType: "statusline-setup",
  description: "Agent for configuring the TUI status line settings",
  whenToUse: "Use this agent to configure the user's Catui status line setting.",
  tools: ["Read", "Edit"],
  source: "built-in",
  baseDir: "built-in",
  model: "sonnet",
  color: "orange",
  getSystemPrompt: () => buildStatuslineSetupPrompt(),
};

/**
 * Catui-guide agent (CC §5.5)
 * - Conditional tools: Read, Grep, Glob, Agent (if web access), else Read, Grep, Glob
 * - model: "haiku"
 * - permissionMode: "dontAsk"
 */
export const CATUI_GUIDE_AGENT: AgentDefinition = {
  agentType: "catui-guide",
  description: "Agent for answering questions about Catui features and usage",
  whenToUse:
    'Use this agent when the user asks questions ("Can Catui...", "Does Catui...", "How do I...") about: ' +
    "(1) Catui (the terminal AI coding agent) - features, slash commands, MCP servers, settings, extensions, " +
    "keybindings, configuration; (2) the Agent SDK - building custom agents; (3) supported model APIs - usage, tool use. " +
    "IMPORTANT: Before spawning a new agent, check if there is already a running or recently completed " +
    "catui-guide agent that you can continue via SendMessage.",
  tools: ["Read", "Grep", "Find"],
  source: "built-in",
  baseDir: "built-in",
  model: "haiku",
  permissionMode: "dontAsk",
  getSystemPrompt: () => buildCatuiGuidePrompt(),
};

/** All built-in agent definitions, keyed by agentType. */
export const BUILT_IN_AGENT_DEFINITIONS: ReadonlyMap<string, AgentDefinition> = new Map([
  [GENERAL_PURPOSE_AGENT.agentType, GENERAL_PURPOSE_AGENT],
  [EXPLORE_AGENT.agentType, EXPLORE_AGENT],
  [PLAN_AGENT.agentType, PLAN_AGENT],
  [STATUSLINE_SETUP_AGENT.agentType, STATUSLINE_SETUP_AGENT],
  [CATUI_GUIDE_AGENT.agentType, CATUI_GUIDE_AGENT],
]);

// ============================================================================
// Default Fork Agent Definition
// ============================================================================

/**
 * The default "fork" agent definition used when subagent_type is not specified.
 * In CC, this creates an agent that inherits the parent's system prompt, messages,
 * and tool set — effectively creating a "fork" of the parent session.
 */
export const DEFAULT_FORK_AGENT: AgentDefinition = {
  agentType: "__fork__",
  description: "Fork of the current agent session",
  whenToUse: "Default fork mode — inherits parent session's prompt, tools, and messages",
  tools: ["*"],
  source: "built-in",
  baseDir: "built-in",
  forksParentContext: true,
  getSystemPrompt: (ctx: AgentSystemPromptContext) => {
    // Fork mode: uses parentSession.renderedSystemPrompt directly.
    // This is a fallback; real fork path reads from parent session.
    return buildDefaultSubAgentPrompt(ctx);
  },
};

// ============================================================================
// System Prompt Builders
// ============================================================================

function buildDefaultSubAgentPrompt(ctx: AgentSystemPromptContext): string {
  const parts: string[] = [
    "You are a sub-agent tasked with completing a specific assignment.",
    "Based on the user's instructions, you should use available tools to complete the task.",
    "Complete the task thoroughly — don't gold-plate, but don't half-finish either.",
    "When finished, reply with a concise report covering what was accomplished and any key findings —",
    "the caller will relay this to the user, so just the essentials.",
  ];
  if (ctx.cwd) {
    parts.push(`Working directory: ${ctx.cwd}`);
  }
  if (ctx.additionalWorkingDirs?.length) {
    parts.push("Notes:");
    for (const dir of ctx.additionalWorkingDirs) {
      parts.push(`- Working directory: ${dir}`);
    }
  }
  if (ctx.model) {
    parts.push(`Model: ${ctx.model}`);
  }
  parts.push("");
  parts.push("Additional notes:");
  parts.push("- Agent threads always reset their cwd between bash calls, so use only absolute file paths.");
  parts.push("- In your final response, share file paths relevant to the task (always absolute, never relative).");
  parts.push("  Only include code snippets when the exact text carries weight (e.g., a bug you found, a function signature the caller asked for) — don't recap code you merely read.");
  parts.push("- To communicate clearly with the user, the assistant must avoid using emoji.");
  parts.push("- Don't use a colon before tool calls. Like 'Let me read the file:' followed by a read tool call should be 'Let me read the file.' with a period.");
  return parts.join("\n");
}

function buildExploreAgentPrompt(): string {
  return [
    "You are an exploration agent. Your role is to search and understand code without modifying it.",
    "",
    "Rules:",
    "- You may only READ files, SEARCH for patterns, and LIST directories.",
    "- You may NOT edit, write, or modify any files.",
    "- You may NOT spawn additional sub-agents.",
    "- Focus on thoroughness: examine multiple files, trace dependencies, understand the full picture.",
    "- When done, provide a clear, organized summary of your findings.",
    "",
    "Available tools: read, grep, find, ls, time, bash (read-only commands only).",
  ].join("\n");
}

function buildStatuslineSetupPrompt(): string {
  return [
    "You are a status line setup agent for Catui.",
    "Your task is to help configure the user's terminal status line / TUI theme settings.",
    "",
    "You can read the current configuration and edit settings files.",
    "When making changes, explain what you are changing and why.",
    "After making changes, read the file back to confirm the changes were applied correctly.",
  ].join("\n");
}

function buildCatuiGuidePrompt(): string {
  return [
    "You are a Catui documentation guide agent.",
    "Your task is to answer questions about Catui features, configuration, and usage.",
    "",
    "You have access to:",
    "- Read: to read documentation files, AGENTS.md, .CATUI.md, and source code",
    "- Grep: to search for specific patterns in the codebase",
    "- Find: to locate files by name or pattern",
    "",
    "When answering questions:",
    "- Search the codebase and documentation for accurate information",
    "- Provide specific file paths and line numbers when referencing features",
    "- If you cannot find the answer, say so honestly rather than guessing",
    "- Include practical examples when possible",
  ].join("\n");
}

function buildPlanAgentPrompt(): string {
  return [
    "You are a planning agent — a software architect who designs implementation strategies.",
    "",
    "Your responsibilities:",
    "- Analyze the task and identify all files that need to be modified or created.",
    "- Break the task into ordered implementation steps.",
    "- Identify potential risks, edge cases, and architectural trade-offs.",
    "- Consider dependencies between steps and suggest the optimal order.",
    "",
    "Rules:",
    "- You may only READ files and SEARCH for patterns.",
    "- You may NOT edit, write, or modify any files.",
    "- You may NOT spawn additional sub-agents.",
    "- Your output must be a concrete, actionable plan — not vague guidance.",
    "- Include file paths, function names, and specific changes needed.",
    "",
    "Available tools: read, grep, find, ls, time, bash (read-only commands only).",
  ].join("\n");
}
