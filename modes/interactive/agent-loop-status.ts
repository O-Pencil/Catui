/**
 * [WHO]: formatAgentLoopStatusLines()
 * [FROM]: Depends on @pencil-agent/agent-core AgentRunResult and AgentLoopTransition
 * [TO]: Consumed by modes/interactive/interactive-mode.ts and tests
 * [HERE]: modes/interactive/agent-loop-status.ts - /status loop outcome formatting
 */
import type { AgentRunResult } from "@pencil-agent/agent-core";
import {
	formatLoopPolicySummary,
	formatLoopTransitionHistory,
	formatLoopTransitionSummary,
} from "../utils/agent-loop-result-format.js";

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

export function formatAgentLoopStatusLines(result: AgentRunResult | undefined): string[] {
	if (!result) return [];

	const lines = [
		formatLine(
			"Last loop:",
			`${result.stopReason}, ${plural(result.turnCount, "turn")}, ${plural(result.toolCallCount, "tool")}, ${formatDuration(result.durationMs)}`,
		),
	];

	if (result.loopFramework) {
		lines.push(formatLine("Loop framework:", result.loopFramework));
	}

	const policySummary = formatLoopPolicySummary(result.loopPolicy);
	if (policySummary) {
		lines.push(formatLine("Loop policy:", policySummary));
	}

	const transitionHistory = formatLoopTransitionHistory(result.transitions);
	if (transitionHistory) {
		lines.push(formatLine("Loop transitions:", transitionHistory));
	} else if (result.lastTransition) {
		lines.push(formatLine("Loop transition:", formatLoopTransitionSummary(result.lastTransition)));
	}

	if (result.permissionDenialCount && result.permissionDenialCount > 0) {
		lines.push(formatLine("Tool denials:", String(result.permissionDenialCount)));
	}

	if (result.errorSubtype || result.errorMessage) {
		lines.push(formatLine("Loop error:", result.errorSubtype ?? result.errorMessage ?? "unknown"));
	}

	return lines;
}
