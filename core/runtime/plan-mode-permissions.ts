/**
 * [WHO]: createPlanModeCanUseTool() — SDK-level plan mode permission enforcement
 * [FROM]: Permission logic derived from extensions/builtin/plan/plan-permissions.ts
 * [TO]: Consumed by core/runtime/sdk.ts when permissionMode === 'plan'
 * [HERE]: core/runtime/plan-mode-permissions.ts — standalone plan mode tool gating for SDK consumers
 */

import { resolve } from "node:path";
import type { AgentToolPermissionDecision } from "@catui/agent-core";

// ============================================================================
// Read-only tools that are always allowed in plan mode
// ============================================================================

const READ_ONLY_TOOLS = new Set([
  "read", "Read",
  "grep", "Grep",
  "find", "Find",
  "ls", "Ls",
  "time", "Time",
  "source",
  "LSP",
  "AskUserQuestion",
  "WebSearch",
  "WebFetch",
  "GetGoal",
]);

const PLAN_SAFE_AGENT_TYPES = new Set(["Explore", "Plan", "explore", "plan"]);

const ALWAYS_BLOCKED_TOOLS = new Set([
  "notebookEdit", "NotebookEdit",
  "write_file", "edit_file", "replace", "create_file", "delete_file",
]);

// ============================================================================
// Read-only bash commands
// ============================================================================

const READONLY_BASH_PREFIXES = [
  "ls ", "ls\t", "ls\n",
  "cat ", "cat\t",
  "head ", "head\t",
  "tail ", "tail\t",
  "wc ", "wc\t",
  "echo ", "echo\t", "echo\n",
  "find ", "find\t",
  "grep ", "grep\t",
  "rg ", "rg\t",
  "stat ", "stat\t",
  "file ", "file\t",
  "pwd", "pwd\n", "pwd ",
  "which ", "which\t",
  "whoami", "whoami\n",
  "date", "date\n", "date ",
  "uname ", "uname\t",
  "git status", "git log ", "git log\n", "git log\t", "git diff ", "git diff\n", "git diff\t",
  "git branch", "git branch\n", "git branch\t",
  "git show ", "git show\n", "git show\t",
  "git describe", "git describe\n",
  "tree ", "tree\t", "tree\n",
  "du ", "du\t",
  "df ", "df\t",
];

const DANGEROUS_BASH_PATTERNS = [
  />/,
  /\brm\s+/,
  /\bmv\s+/,
  /\bcp\s+/,
  /\bchmod\s+/,
  /\bchown\s+/,
  /\bcurl\s.*\|.*sh/,
  /\bwget\s.*\|.*sh/,
  /\bgit\s+(commit|push|reset\s+--hard|clean\s+-f)/,
  /\bnpm\s+(publish|install|update|add|remove|uninstall|ci)\b/,
  /\bpnpm\s+(publish|install|update|add|remove|uninstall)\b/,
  /\byarn\s+(publish|install|add|remove|upgrade)\b/,
  /\bpip\s+install/,
  /\btouch\s+/,
  /\bmkdir\s+/,
  /\btee\s+/,
  /\bsed\s+-i\b/,
  /\bsudo\s+/,
  /\bdd\s+/,
];

// ============================================================================
// Helpers
// ============================================================================

function isReadOnlyBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return true;

  for (const pattern of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  for (const prefix of READONLY_BASH_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true;
  }

  const safeCommands = ["pwd", "whoami", "date", "uname"];
  for (const cmd of safeCommands) {
    if (trimmed === cmd || trimmed.startsWith(cmd + " ") || trimmed.startsWith(cmd + "\t")) {
      return true;
    }
  }

  if (trimmed.startsWith("git ")) {
    const safeGitCmds = ["status", "log", "diff", "branch", "show", "describe", "tag"];
    for (const gitCmd of safeGitCmds) {
      if (trimmed.startsWith(`git ${gitCmd}`)) return true;
    }
    return false;
  }

  return false;
}

function isMarkdownFile(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const path = (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).path;
  if (typeof path !== "string") return false;
  return /\.md$/i.test(path);
}

function targetsPlanFile(input: unknown, planFilePath: string, cwd: string): boolean {
  if (!input || typeof input !== "object") return false;
  const path = (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).path;
  return typeof path === "string" && resolve(cwd, path) === resolve(cwd, planFilePath);
}

function isPlanSafeAgent(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const inp = input as Record<string, unknown>;
  const type =
    typeof inp.agentType === "string" ? inp.agentType
      : typeof inp.subagent_type === "string" ? inp.subagent_type
        : typeof inp.type === "string" ? inp.type
          : "";
  if (type && PLAN_SAFE_AGENT_TYPES.has(type)) return true;

  const prompt = typeof inp.prompt === "string" ? inp.prompt : "";
  if (!prompt) return false;
  const looksSafe = /\b(Explore|Plan) agent\b/i.test(prompt) || /\bread-only\b/i.test(prompt);
  const looksMutating = /\b(write|edit|modify|delete|commit|apply)\b/i.test(prompt);
  return looksSafe && !looksMutating;
}

// ============================================================================
// Public API
// ============================================================================

export type PlanModeToolCall = {
  toolCallId: string;
  toolName: string;
  requestedToolName: string;
  input: unknown;
  rawInput: unknown;
};

type CanUseToolFn = (event: PlanModeToolCall) => Promise<AgentToolPermissionDecision> | AgentToolPermissionDecision;

export function evaluatePlanModeToolCall(
  event: PlanModeToolCall,
  cwd: string,
  options: { planFilePath?: string } = {},
): AgentToolPermissionDecision {
  const { toolName, input } = event;

  if (toolName === "ExitPlanMode") return { decision: "allow" };
  if (toolName === "EnterPlanMode") {
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      if (typeof record.agentId === "string" || typeof record.parentAgentId === "string") {
        return { decision: "deny", reason: "EnterPlanMode is not allowed from agent contexts." };
      }
    }
    return { decision: "allow" };
  }
  if (READ_ONLY_TOOLS.has(toolName)) return { decision: "allow" };

  if (toolName === "write" || toolName === "Write" || toolName === "edit" || toolName === "Edit") {
    const allowed = options.planFilePath
      ? targetsPlanFile(input, options.planFilePath, cwd)
      : isMarkdownFile(input);
    return allowed
      ? { decision: "allow" }
      : {
          decision: "deny",
          reason: options.planFilePath
            ? `In plan mode, ${toolName} is only allowed for the plan file: ${options.planFilePath}`
            : `In plan mode, ${toolName} is only allowed for .md files.`,
        };
  }

  if (toolName === "bash" || toolName === "Bash") {
    const command = input && typeof input === "object" ? (input as Record<string, unknown>).command : undefined;
    if (typeof command === "string" && isReadOnlyBashCommand(command)) return { decision: "allow" };
    const preview = typeof command === "string" ? command.slice(0, 80) : String(command);
    return { decision: "deny", reason: `In plan mode, only read-only bash commands are allowed. Command "${preview}${typeof command === "string" && command.length > 80 ? "..." : ""}" is not permitted.` };
  }

  if (toolName === "Agent" || toolName === "Task" || toolName === "TaskCreate") {
    return isPlanSafeAgent(input)
      ? { decision: "allow" }
      : { decision: "deny", reason: "In plan mode, Agent/Task is only allowed for read-only Explore or Plan agents." };
  }

  if (ALWAYS_BLOCKED_TOOLS.has(toolName)) return { decision: "deny", reason: `${toolName} is not allowed in plan mode.` };
  return { decision: "deny", reason: `In plan mode, tool "${toolName}" is blocked. Only read-only tools are allowed.` };
}

/**
 * Create a canUseTool function that enforces plan mode restrictions.
 *
 * Rules:
 * - Read-only tools (Read, Grep, Find, Ls, LSP, AskUserQuestion, etc.): always allowed
 * - Plan tools (ExitPlanMode, EnterPlanMode): always allowed
 * - Write/Edit: only allowed for .md files
 * - Bash: only allowed for read-only commands
 * - Agent/Task: only allowed for Explore/Plan types
 * - Everything else: denied
 */
export function createPlanModeCanUseTool(
  cwd: string,
  options: { planFilePath?: string } = {},
): CanUseToolFn {
  return (event: PlanModeToolCall): AgentToolPermissionDecision => evaluatePlanModeToolCall(event, cwd, options);
}

/**
 * Compose a plan mode canUseTool with an optional user-provided canUseTool.
 * Plan mode check runs first; if it allows, the user's check is also consulted.
 */
export function composePlanModeCanUseTool(
  planModeCheck: CanUseToolFn,
  userCheck?: CanUseToolFn,
): CanUseToolFn {
  if (!userCheck) return planModeCheck;
  return async (event: PlanModeToolCall): Promise<AgentToolPermissionDecision> => {
    const planResult = await planModeCheck(event);
    if (planResult.decision === "deny") return planResult;
    return userCheck(event);
  };
}
