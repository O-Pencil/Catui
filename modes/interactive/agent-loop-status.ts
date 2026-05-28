/**
 * [WHO]: formatAgentLoopStatusLines()
 * [FROM]: Depends on @pencil-agent/agent-core AgentRunResult and AgentLoopTransition
 * [TO]: Consumed by modes/interactive/interactive-mode.ts and tests
 * [HERE]: modes/interactive/agent-loop-status.ts - /status loop outcome formatting
 */
import type { AgentLoopTransition, AgentRunResult } from "@pencil-agent/agent-core";

const LABEL_WIDTH = 22;

function formatLine(label: string, value: string): string {
	return `${label.padEnd(LABEL_WIDTH)}${value}`;
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralValue}`;
}

function formatDuration(durationMs: number): string {
	if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
	return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatTransition(transition: AgentLoopTransition): string {
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

export function formatAgentLoopStatusLines(result: AgentRunResult | undefined): string[] {
	if (!result) return [];

	const lines = [
		formatLine(
			"Last loop:",
			`${result.stopReason}, ${plural(result.turnCount, "turn")}, ${plural(result.toolCallCount, "tool")}, ${formatDuration(result.durationMs)}`,
		),
	];

	if (result.lastTransition) {
		lines.push(formatLine("Loop transition:", formatTransition(result.lastTransition)));
	}

	if (result.permissionDenialCount && result.permissionDenialCount > 0) {
		lines.push(formatLine("Tool denials:", String(result.permissionDenialCount)));
	}

	if (result.errorSubtype || result.errorMessage) {
		lines.push(formatLine("Loop error:", result.errorSubtype ?? result.errorMessage ?? "unknown"));
	}

	return lines;
}
