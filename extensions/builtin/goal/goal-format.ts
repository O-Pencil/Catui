/**
 * [WHO]: Pure formatting helpers for goal display: formatGoalElapsedSeconds, formatTokens, goalStatusLabel, goalUsageSummary, goalSummaryLines, goalStatusIndicator, shouldConfirmBeforeReplacing, editedGoalStatus, validateObjective, validateBudget
 * [FROM]: Depends on ./goal-types
 * [TO]: Consumed by ./goal-command, ./goal-tools, ./index (status line)
 * [HERE]: extensions/builtin/goal/goal-format.ts - display & validation boundary; no I/O
 */

import {
	MAX_THREAD_GOAL_OBJECTIVE_CHARS,
	MIN_TOKEN_BUDGET,
	type ThreadGoal,
	type ThreadGoalStatus,
} from "./goal-types.js";

export function formatGoalElapsedSeconds(seconds: number): string {
	const safe = Math.max(0, seconds);
	if (safe < 60) return `${safe.toFixed(1)}s`;
	const whole = Math.floor(safe);
	const minutes = Math.floor(whole / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (hours >= 24) {
		const days = Math.floor(hours / 24);
		const remainingHours = hours % 24;
		return `${days}d ${remainingHours}h ${remainingMinutes}m`;
	}
	if (remainingMinutes === 0) return `${hours}h`;
	return `${hours}h ${remainingMinutes}m`;
}

export function formatTokens(tokens: number): string {
	const safe = Math.max(0, Math.floor(tokens));
	if (safe < 1_000) return `${safe}`;
	if (safe < 1_000_000) {
		const k = safe / 1_000;
		return `${k.toFixed(k >= 100 ? 0 : 1)}K`;
	}
	const m = safe / 1_000_000;
	return `${m.toFixed(m >= 100 ? 0 : 1)}M`;
}

export function goalStatusLabel(status: ThreadGoalStatus): string {
	switch (status) {
		case "active":
			return "active";
		case "paused":
			return "paused";
		case "blocked":
			return "blocked";
		case "usage_limited":
			return "usage_limited";
		case "budget_limited":
			return "budget_limited";
		case "complete":
			return "complete";
	}
}

export interface GoalUsageSummary {
	elapsed: string;
	tokensLabel: string;
	tokensUsed: string;
	tokensBudget: string;
	hasBudget: boolean;
}

export function goalUsageSummary(goal: ThreadGoal): GoalUsageSummary {
	const elapsed = formatGoalElapsedSeconds(goal.time_used_seconds);
	const tokensUsed = formatTokens(goal.tokens_used);
	const hasBudget = goal.token_budget !== null;
	const tokensBudget = hasBudget ? formatTokens(goal.token_budget ?? 0) : "";
	const tokensLabel = hasBudget ? `${tokensUsed} / ${tokensBudget}` : tokensUsed;
	return { elapsed, tokensLabel, tokensUsed, tokensBudget, hasBudget };
}

export function goalSummaryLines(goal: ThreadGoal): string[] {
	const summary = goalUsageSummary(goal);
	const lines: string[] = [];
	lines.push("Goal");
	lines.push(`  Status: ${goalStatusLabel(goal.status)}`);
	lines.push(`  Objective: ${goal.objective}`);
	lines.push(`  Time used: ${summary.elapsed}`);
	lines.push(`  Tokens used: ${summary.tokensLabel}${summary.hasBudget ? " tokens" : ""}`);
	lines.push("");
	const commands = commandsForStatus(goal.status);
	lines.push(`Commands: ${commands}`);
	return lines;
}

function commandsForStatus(status: ThreadGoalStatus): string {
	switch (status) {
		case "active":
			return "/goal edit, /goal pause, /goal clear";
		case "paused":
		case "blocked":
		case "usage_limited":
			return "/goal edit, /goal resume, /goal clear";
		case "budget_limited":
		case "complete":
			return "/goal edit, /goal clear";
	}
}

export type GoalStatusIndicator =
	| { type: "Active"; usage: string }
	| { type: "Paused" }
	| { type: "Blocked" }
	| { type: "UsageLimited" }
	| { type: "BudgetLimited"; usage: string | null }
	| { type: "Complete"; usage: string };

export function goalStatusIndicator(goal: ThreadGoal, activeTurnStartedAt: number | null): GoalStatusIndicator {
	const summary = goalUsageSummary(goal);
	switch (goal.status) {
		case "active": {
			let displaySeconds = goal.time_used_seconds;
			if (activeTurnStartedAt) {
				const baseline = Math.max(goal.updated_at, activeTurnStartedAt);
				const activeSeconds = Math.max(0, (Date.now() - baseline) / 1000);
				displaySeconds += activeSeconds;
			}
			const elapsed = formatGoalElapsedSeconds(displaySeconds);
			const usage = goal.token_budget !== null
				? `${elapsed}, ${summary.tokensUsed}/${summary.tokensBudget}`
				: `${elapsed}, ${summary.tokensUsed}`;
			return { type: "Active", usage };
		}
		case "paused":
			return { type: "Paused" };
		case "blocked":
			return { type: "Blocked" };
		case "usage_limited":
			return { type: "UsageLimited" };
		case "budget_limited": {
			const usage = goal.token_budget !== null ? `${summary.tokensUsed} / ${summary.tokensBudget} tokens` : null;
			return { type: "BudgetLimited", usage };
		}
		case "complete": {
			const usage = goal.token_budget !== null
				? `${summary.tokensUsed} tokens`
				: formatGoalElapsedSeconds(goal.time_used_seconds);
			return { type: "Complete", usage };
		}
	}
}

export function shouldConfirmBeforeReplacing(goal: ThreadGoal): boolean {
	return goal.status !== "complete";
}

export function editedGoalStatus(status: ThreadGoalStatus): ThreadGoalStatus {
	switch (status) {
		case "active":
		case "paused":
		case "blocked":
		case "usage_limited":
			return status;
		case "budget_limited":
		case "complete":
			return "active";
	}
}

export function validateObjective(input: string): { ok: true; value: string } | { ok: false; reason: string } {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return { ok: false, reason: "Goal objective must not be empty." };
	}
	if (trimmed.length > MAX_THREAD_GOAL_OBJECTIVE_CHARS) {
		return {
			ok: false,
			reason: `Goal objective is too long: ${trimmed.length} characters. Limit: ${MAX_THREAD_GOAL_OBJECTIVE_CHARS}.`,
		};
	}
	return { ok: true, value: trimmed };
}

export function validateBudget(
	input: number | null | undefined,
): { ok: true; value: number | null } | { ok: false; reason: string } {
	if (input === undefined || input === null) return { ok: true, value: null };
	if (!Number.isFinite(input) || !Number.isInteger(input) || input < MIN_TOKEN_BUDGET) {
		return {
			ok: false,
			reason: `Goal token_budget must be a positive integer when provided. Got: ${String(input)}.`,
		};
	}
	return { ok: true, value: input };
}
