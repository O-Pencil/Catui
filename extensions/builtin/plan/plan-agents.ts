/**
 * [WHO]: createExploreAgentSpec(), createPlanAgentSpec(), getExploreAgentCount(), getPlanAgentCount()
 * [FROM]: No external dependencies
 * [TO]: Consumed by model during plan mode workflow (via subagent spawning)
 * [HERE]: extensions/builtin/plan/plan-agents.ts - Explore/Plan subagent definitions for plan mode
 */

// ============================================================================
// Agent count configuration
// ============================================================================

export function getExploreAgentCount(): number {
	const env = process.env.NANOPENCIL_PLAN_EXPLORE_AGENT_COUNT;
	if (env) {
		const n = parseInt(env, 10);
		if (!isNaN(n) && n >= 1 && n <= 10) return n;
	}
	return 3;
}

export function getPlanAgentCount(): number {
	const env = process.env.NANOPENCIL_PLAN_AGENT_COUNT;
	if (env) {
		const n = parseInt(env, 10);
		if (!isNaN(n) && n >= 1 && n <= 10) return n;
	}
	return 1;
}

// ============================================================================
// Explore Agent
// ============================================================================

/**
 * Prompt for the Explore subagent.
 * Focuses on codebase search and pattern identification.
 */
export function getExploreAgentPrompt(
	taskDescription: string,
	searchFocus: string,
): string {
	return `You are an Explore agent. Your job is to search the codebase to understand how to implement the following task:

**Task**: ${taskDescription}

**Your specific focus**: ${searchFocus}

Instructions:
1. Use read, grep, find, ls, and time tools to search the codebase
2. Look for existing functions, tools, patterns, and architectural approaches that can be reused
3. Search for related components, utilities, and modules
4. Report your findings with specific file paths and function names
5. Do NOT write or edit any files
6. Do NOT run bash commands that modify the filesystem
7. Do NOT call ExitPlanMode or EnterPlanMode
8. Do NOT spawn other agents

Be thorough but focused on your specific search area. Report concrete findings with file paths.`;
}

// ============================================================================
// Plan Agent
// ============================================================================

/**
 * Prompt for the Plan subagent.
 * Focuses on implementation design based on exploration results.
 */
export function getPlanAgentPrompt(
	taskDescription: string,
	explorationResults: string,
	contextFiles: string,
): string {
	return `You are a Plan agent (software architect). Your job is to design an implementation approach for the following task:

**Task**: ${taskDescription}

## Exploration Results from Phase 1:
${explorationResults}

## Relevant Context Files:
${contextFiles}

Instructions:
1. Design a concrete implementation approach based on the exploration results
2. Identify the key files that need to be modified
3. Describe the approach step by step
4. Reference specific existing functions and utilities that should be reused
5. Consider trade-offs and potential risks
6. Do NOT write or edit any files
7. Do NOT run bash commands that modify the filesystem
8. Do NOT call ExitPlanMode or EnterPlanMode
9. Do NOT spawn other agents

Your output should include:
- Recommended approach with rationale
- List of critical files to modify
- Existing code to reuse
- Step-by-step implementation strategy
- Verification approach`;
}

// ============================================================================
// Read-only tool list for subagents
// ============================================================================

/**
 * List of tool names available to Explore/Plan subagents.
 * Restricted to read-only operations.
 */
export const PLAN_SUBAGENT_TOOLS = ["read", "grep", "find", "ls", "time"];
