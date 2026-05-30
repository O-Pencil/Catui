/**
 * [WHO]: Provides formatLoopPolicySummary(), formatLoopTransitionSummary(), and formatLoopTransitionHistory()
 * [FROM]: Depends on @pencil-agent/agent-core AgentRunPolicy and AgentLoopTransition
 * [TO]: Consumed by interactive and ACP status formatters
 * [HERE]: modes/agent-loop-result-format.ts - shared run-result display helpers
 */
import type { AgentLoopTransition, AgentRunPolicy } from "@pencil-agent/agent-core";

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralValue}`;
}

function formatPercent(value: number): string {
	const percent = value * 100;
	return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

export function formatLoopPolicySummary(policy: AgentRunPolicy | undefined): string | undefined {
	if (!policy) return undefined;
	const parts: string[] = [];
	if (policy.maxTurnsPerPrompt !== undefined) parts.push(`turns=${policy.maxTurnsPerPrompt}`);
	if (policy.maxToolCallsPerPrompt !== undefined) parts.push(`tools=${policy.maxToolCallsPerPrompt}`);
	if (policy.maxToolConcurrency !== undefined) parts.push(`concurrency=${policy.maxToolConcurrency}`);
	if (policy.maxToolResultBatchSizeChars !== undefined) {
		parts.push(`toolResultChars=${policy.maxToolResultBatchSizeChars}`);
	}
	if (policy.maxModelErrorRecoveryAttempts !== undefined) {
		parts.push(`modelRecoveries=${policy.maxModelErrorRecoveryAttempts}`);
	}
	if (policy.maxOutputTokenRecoveryAttempts !== undefined) {
		parts.push(`outputRecoveries=${policy.maxOutputTokenRecoveryAttempts}`);
	}
	if (policy.outputTokenBudget !== undefined) {
		const budget = policy.outputTokenBudget;
		let value = `outputBudget=${budget.targetTokens}`;
		if (budget.thresholdPct !== undefined) value += `@${formatPercent(budget.thresholdPct)}`;
		if (budget.maxContinuations !== undefined) value += `/${budget.maxContinuations}`;
		parts.push(value);
	}
	if (policy.maxStopHookContinuations !== undefined) {
		parts.push(`stopHooks=${policy.maxStopHookContinuations}`);
	}
	return parts.length > 0 ? parts.join(", ") : undefined;
}

export function formatLoopTransitionSummary(transition: AgentLoopTransition): string {
	switch (transition.reason) {
		case "start":
			return "start";
		case "tool_result":
			return `tool_result (${plural(transition.toolCallCount, "tool call")})`;
		case "follow_up":
			return "follow_up";
		case "max_turns_reached":
			return `max_turns_reached (${transition.turnCount}/${transition.maxTurns} turns)`;
		case "tool_call_limit_reached":
			return `tool_call_limit_reached (${transition.toolCallCount}/${transition.maxToolCalls} used, ${transition.requestedToolCalls} requested)`;
		case "stop_hook_limit_reached":
			return `stop_hook_limit_reached (${transition.continuationCount}/${transition.maxContinuations} continuations)`;
		case "max_output_tokens_recovery":
			return `max_output_tokens_recovery (attempt ${transition.attempt})`;
		case "stop_hook_blocking":
			return `stop_hook_blocking (${transition.continuationCount} continuations)`;
		case "model_error_recovery":
			return `model_error_recovery (${transition.subtype}, attempt ${transition.attempt})`;
		case "token_budget_continuation":
			return `token_budget_continuation (${transition.outputTokens}/${transition.targetTokens} output tokens)`;
	}
}

export function formatLoopTransitionHistory(transitions: AgentLoopTransition[] | undefined): string | undefined {
	if (!transitions || transitions.length === 0) return undefined;
	return transitions.map(formatLoopTransitionSummary).join(" -> ");
}
