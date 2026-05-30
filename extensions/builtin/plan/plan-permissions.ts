/**
 * [WHO]: shouldAllowToolCall(), getPlanModeToolBlockReason()
 * [FROM]: Depends on node:path, ./types, ./plan-file-manager
 * [TO]: Consumed by plan extension index.ts (tool_call event handler)
 * [HERE]: extensions/builtin/plan/plan-permissions.ts - tool call permission gating for plan mode
 */

import { resolve } from "node:path";
import type { ToolCallInput, ToolPermissionResult } from "./types.js";
import type { PlanSessionState } from "./types.js";

// ============================================================================
// Read-only tools that are always allowed in plan mode
// ============================================================================

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "time", "source"]);
const PLAN_SAFE_AGENT_TYPES = new Set(["Explore", "Plan", "explore", "plan"]);
const ALWAYS_BLOCKED_TOOLS = new Set([
	"notebookEdit",
	"NotebookEdit",
	"write_file",
	"edit_file",
	"replace",
	"create_file",
	"delete_file",
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
	/>/,           // Output redirection
	/\brm\s+/,     // File deletion
	/\bmv\s+/,     // File move/rename
	/\bcp\s+/,     // File copy (could be used for destruction)
	/\bchmod\s+/,  // Permission change
	/\bchown\s+/,  // Ownership change
	/\bcurl\s.*\|.*sh/,  // Pipe curl to sh
	/\bwget\s.*\|.*sh/,
	/\bgit\s+(commit|push|reset\s+--hard|clean\s+-f)/,
	/\bnpm\s+(publish|install|update|add|remove|uninstall|ci)\b/,
	/\bpnpm\s+(publish|install|update|add|remove|uninstall)\b/,
	/\byarn\s+(publish|install|add|remove|upgrade)\b/,
	/\byarn\s+(publish)/,
	/\bpip\s+install/,
	/\btouch\s+/,
	/\bmkdir\s+/,
	/\btee\s+/,
	/\bsed\s+-i\b/,
	/\bsudo\s+/,
	/\bdd\s+/,
];

// ============================================================================
// Permission checking
// ============================================================================

/**
 * Check if a tool call is allowed in plan mode.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export function shouldAllowToolCall(
	toolCall: ToolCallInput,
	planFilePath: string,
	cwd = process.cwd(),
): ToolPermissionResult {
	const { toolName, input } = toolCall;

	// Plan mode tools are always allowed
	if (toolName === "ExitPlanMode") {
		return { allowed: true, classification: "plan" };
	}

	if (toolName === "EnterPlanMode") {
		if (isAgentContext(input)) {
			return {
				allowed: false,
				classification: "agent",
				reason: "EnterPlanMode is not allowed from agent contexts.",
			};
		}
		return { allowed: true, classification: "plan" };
	}

	// Read-only tools are always allowed
	if (READ_ONLY_TOOLS.has(toolName)) {
		return { allowed: true, classification: "read" };
	}

	// Write/edit tools: only allowed if targeting the plan file
	if (toolName === "write" || toolName === "edit") {
		const targetPath = typeof input.path === "string" ? input.path : "";
		if (targetPath && pathsMatch(targetPath, planFilePath, cwd)) {
			return { allowed: true, classification: "write" };
		}
		return {
			allowed: false,
			classification: "write",
			reason: `In plan mode, ${toolName} is only allowed for the plan file: ${planFilePath}`,
		};
	}

	if (toolName === "Agent" || toolName === "Task") {
		if (isPlanSafeAgent(input)) {
			return { allowed: true, classification: "agent" };
		}
		return {
			allowed: false,
			classification: "agent",
			reason: "In plan mode, Agent/Task is only allowed for read-only Explore or Plan agents.",
		};
	}

	// Bash: check if command is read-only
	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		if (isReadOnlyBashCommand(command)) {
			return { allowed: true, classification: "read" };
		}
		return {
			allowed: false,
			classification: "write",
			reason: `In plan mode, only read-only bash commands are allowed. Command "${command.slice(0, 80)}${command.length > 80 ? "..." : ""}" appears to modify the filesystem.`,
		};
	}

	// NotebookEdit: always blocked in plan mode
	if (ALWAYS_BLOCKED_TOOLS.has(toolName)) {
		return {
			allowed: false,
			classification: "write",
			reason: `${toolName} is not allowed in plan mode.`,
		};
	}

	return {
		allowed: false,
		classification: "unknown",
		reason: `In plan mode, unknown tool "${toolName}" is blocked unless it is explicitly classified as read-only.`,
	};
}

/**
 * Check if a bash command appears to be read-only.
 */
function isReadOnlyBashCommand(command: string): boolean {
	const trimmed = command.trim();

	// Empty command is safe
	if (!trimmed) return true;

	// Check against dangerous patterns first
	for (const pattern of DANGEROUS_BASH_PATTERNS) {
		if (pattern.test(trimmed)) return false;
	}

	// Check against read-only allowlist
	for (const prefix of READONLY_BASH_PREFIXES) {
		if (trimmed.startsWith(prefix)) return true;
	}

	// Simple commands without arguments that are safe
	const safeCommands = ["pwd", "whoami", "date", "uname"];
	for (const cmd of safeCommands) {
		if (trimmed === cmd || trimmed.startsWith(cmd + " ") || trimmed.startsWith(cmd + "\t")) {
			return true;
		}
	}

	// Git read-only subcommands
	if (trimmed.startsWith("git ")) {
		const safeGitCmds = ["status", "log", "diff", "branch", "show", "describe", "tag"];
		for (const gitCmd of safeGitCmds) {
			if (trimmed.startsWith(`git ${gitCmd}`)) return true;
		}
		return false;
	}

	// Default: deny unknown commands (conservative)
	return false;
}

/**
 * Check if a target path matches the plan file path.
 * Handles both absolute and relative path comparisons.
 */
function pathsMatch(targetPath: string, planFilePath: string, cwd: string): boolean {
	// Direct match
	if (targetPath === planFilePath) return true;

	// Normalize and compare
	try {
		const resolvedTarget = resolve(cwd, targetPath);
		const resolvedPlan = resolve(planFilePath);
		return resolvedTarget === resolvedPlan;
	} catch {
		return false;
	}
}

function isAgentContext(input: Record<string, unknown>): boolean {
	return typeof input.agentId === "string" || typeof input.parentAgentId === "string";
}

function isPlanSafeAgent(input: Record<string, unknown>): boolean {
	const type =
		typeof input.agentType === "string"
			? input.agentType
			: typeof input.subagent_type === "string"
				? input.subagent_type
				: typeof input.type === "string"
					? input.type
					: "";
	if (type && PLAN_SAFE_AGENT_TYPES.has(type)) return true;

	const prompt = typeof input.prompt === "string" ? input.prompt : "";
	if (!prompt) return false;
	const looksPlanSafe = /\b(Explore|Plan) agent\b/i.test(prompt) || /\bread-only\b/i.test(prompt);
	const looksMutating = /\b(write|edit|modify|delete|commit|apply)\b/i.test(prompt);
	return looksPlanSafe && !looksMutating;
}

// ============================================================================
// State transitions
// ============================================================================

export function handlePlanModeTransition(sessionState: PlanSessionState): void {
	sessionState.state.needsPlanModeExitAttachment = false;
	sessionState.state.planAttachmentCount = 0;
}

export function handlePlanModeExit(sessionState: PlanSessionState): void {
	sessionState.state.hasExitedPlanModeInSession = true;
	sessionState.state.needsPlanModeExitAttachment = true;
	sessionState.state.mode = sessionState.state.prePlanMode;
	sessionState.state.prePlanMode = "default";
}
