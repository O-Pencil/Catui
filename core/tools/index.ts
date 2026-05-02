/**
 * [WHO]: Tool registry, all tool creators and types
 * [FROM]: Depends on bash.ts, read.ts, edit.ts, write.ts, grep.ts, find.ts, ls.ts, source.ts
 * [TO]: Consumed by index.ts, main.ts, cli/args.ts, modes/interactive/components/tool-execution.ts, extensions/defaults/team/index.ts, and test files
 * [HERE]: Tool system public API; consumed by SDK and orchestrator
 */

export {
	type BashOperations,
	type BashSandboxOptions,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	bashTool,
	createBashTool,
	createSandboxHook,
} from "./bash.js";
export {
	createEditTool,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
	editTool,
} from "./edit.js";
export {
	createFindTool,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
	findTool,
} from "./find.js";
export {
	createGrepTool,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
	grepTool,
} from "./grep.js";
export {
	createLsTool,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
	lsTool,
} from "./ls.js";
export {
	createReadTool,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
	readTool,
} from "./read.js";
export { createTimeTool, type TimeToolInput, timeTool } from "./time.js";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.js";
export {
	createWriteTool,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
	writeTool,
} from "./write.js";

import type { AgentTool } from "@pencil-agent/agent-core";
import { type BashToolOptions, bashTool, createBashTool } from "./bash.js";
import { createEditTool, type EditToolOptions, editTool } from "./edit.js";
import { createFindTool, findTool } from "./find.js";
import { createGrepTool, grepTool } from "./grep.js";
import { createLsTool, lsTool } from "./ls.js";
import { createReadTool, type ReadToolOptions, readTool } from "./read.js";
import { createTimeTool, timeTool } from "./time.js";
import { createWriteTool, type WriteToolOptions, writeTool } from "./write.js";

/** Tool type (AgentTool from nanopencil-ai) */
export type Tool = AgentTool<any>;

// Default tools for full access mode (using process.cwd())
export const codingTools: Tool[] = [readTool, bashTool, editTool, writeTool, timeTool];

// Read-only tools for exploration without modification (using process.cwd())
export const readOnlyTools: Tool[] = [readTool, grepTool, findTool, lsTool, timeTool];

// All available tools (using process.cwd())
export const allTools = {
	read: readTool,
	bash: bashTool,
	edit: editTool,
	write: writeTool,
	grep: grepTool,
	find: findTool,
	ls: lsTool,
	time: timeTool,
};

export type ToolName = keyof typeof allTools;

export interface ToolsOptions {
	/** Options for the read tool */
	read?: ReadToolOptions;
	/** Options for the bash tool */
	bash?: BashToolOptions;
	/** Options for the edit tool */
	edit?: EditToolOptions;
	/** Options for the write tool */
	write?: WriteToolOptions;
}

/**
 * Create coding tools configured for a specific working directory.
 */
export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd, options?.edit),
		createWriteTool(cwd, options?.write),
		createTimeTool(),
	];
}

/**
 * Create read-only tools configured for a specific working directory.
 */
export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [createReadTool(cwd, options?.read), createGrepTool(cwd), createFindTool(cwd), createLsTool(cwd), createTimeTool()];
}

/**
 * Create all tools configured for a specific working directory.
 */
export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		read: createReadTool(cwd, options?.read),
		bash: createBashTool(cwd, options?.bash),
		edit: createEditTool(cwd, options?.edit),
		write: createWriteTool(cwd, options?.write),
		grep: createGrepTool(cwd),
		find: createFindTool(cwd),
		ls: createLsTool(cwd),
		time: createTimeTool(),
	};
}

// ============================================================================
// Tool Guidance (for system prompt)
// ============================================================================

/**
 * Tool guidance for system prompt.
 * These are usage guidelines shown to the AI to help it use tools correctly.
 */
export const toolGuidance: Record<string, string> = {
	read: "Read file contents. Prefer this tool to view files; do not use cat or other commands.",
	bash: "Execute bash commands (ls, grep, find, etc.) for file operations and system interaction.",
	edit: "Perform precise edits on files. Uses find-and-replace; old text must match exactly. Use read to view the file before editing.",
	write: "Create or overwrite files. Use only when creating new files or doing complete rewrites.",
	grep: "Search for patterns in file contents (respects .gitignore). Suitable for finding specific strings in code.",
	find: "Find files by glob pattern (respects .gitignore). Suitable for finding files with specific names.",
	ls: "List directory contents.",
};

toolGuidance.time =
	"Get the real current system time. You must use this for current time/date questions, today/tomorrow/yesterday, deadlines, schedules, or any temporal reasoning that depends on the live system clock.";

/**
 * Get guidance for a specific tool
 */
export function getToolGuidance(toolName: string): string | undefined {
	return toolGuidance[toolName];
}

/**
 * Get guidance for multiple tools
 */
export function getToolsGuidance(toolNames: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const name of toolNames) {
		const guidance = toolGuidance[name];
		if (guidance) {
			result[name] = guidance;
		}
	}
	return result;
}
