/**
 * [WHO]: Factory functions that return the three goal LLM tools (get_goal, create_goal, update_goal) as ToolDefinition objects, plus a getter for the controller singleton map
 * [FROM]: Depends on @sinclair/typebox, @pencil-agent/agent-core, core/extensions-host/types, ./goal-controller, ./goal-types, ./goal-format, ./goal-prompts
 * [TO]: Consumed by ./index (registerTool); the controller map is shared with ./index via ./goal-runtime
 * [HERE]: extensions/builtin/goal/goal-tools.ts - LLM-facing tool boundary; no I/O beyond the controller
 */

import { Type } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type {
	ExtensionContext,
	ToolDefinition,
} from "../../../core/extensions-host/types.js";
import { Container, Text, type Component } from "@pencil-agent/tui";
import type { Theme } from "../../../core/theme-contract.js";
import type { GoalController } from "./goal-controller.js";
import type { ThreadGoal } from "./goal-types.js";
import {
	goalStatusLabel,
	goalUsageSummary,
	validateBudget,
	validateObjective,
} from "./goal-format.js";

const GetGoalInputSchema = Type.Object({}, { additionalProperties: false });

const CreateGoalInputSchema = Type.Object({
	objective: Type.String({ description: "Required. The concrete objective to pursue." }),
	token_budget: Type.Optional(
		Type.Number({ description: "Positive token budget. Omit for unlimited." }),
	),
});

const UpdateGoalInputSchema = Type.Object({
	status: Type.Union([Type.Literal("complete"), Type.Literal("blocked")], {
		description:
			"Set to 'complete' only when objective is achieved and verified. " +
			"Set to 'blocked' only after the same blocking condition has repeated for " +
			"3 or more consecutive goal turns (do not use for one-off hard questions).",
	}),
});

export interface GoalToolHost {
	getController(agentDir: string, threadId: string): GoalController | null;
}

function renderGoalResponse(
	goal: ThreadGoal,
	options: { includeUsage: boolean } = { includeUsage: true },
): string {
	const lines: string[] = [];
	lines.push(`Goal status: ${goalStatusLabel(goal.status)}`);
	lines.push(`Objective: ${goal.objective}`);
	if (options.includeUsage) {
		const summary = goalUsageSummary(goal);
		lines.push(`Time used: ${summary.elapsed}`);
		lines.push(`Tokens used: ${summary.tokensLabel}${summary.hasBudget ? " tokens" : ""}`);
	}
	return lines.join("\n");
}

// ============================================================================
// renderCall / renderResult helpers
// ============================================================================

function goalStatusColor(status: string, theme: Theme): string {
	switch (status) {
		case "active": return theme.fg("accent", status);
		case "complete": return theme.fg("success", status);
		case "blocked": return theme.fg("error", status);
		case "paused": return theme.fg("warning", status);
		case "usage_limited":
		case "budget_limited": return theme.fg("warning", status);
		default: return theme.fg("text", status);
	}
}

function renderGoalDetails(goal: ThreadGoal, container: Container, theme: Theme): void {
	const summary = goalUsageSummary(goal);
	container.addChild(
		new Text(theme.fg("muted", "  Status: ") + goalStatusColor(goal.status, theme), 0, 0),
	);
	container.addChild(
		new Text(theme.fg("muted", "  Objective: ") + theme.fg("text", goal.objective), 0, 0),
	);
	container.addChild(
		new Text(theme.fg("muted", "  Time: ") + theme.fg("text", summary.elapsed) +
			theme.fg("muted", "  Tokens: ") + theme.fg("text", summary.tokensLabel), 0, 0),
	);
}

function renderGoalCall(toolName: string, extra: string | undefined, theme: Theme): Component {
	const container = new Container();
	container.addChild(new Text(theme.fg("toolTitle", theme.bold(toolName)), 0, 0));
	if (extra) {
		container.addChild(new Text(theme.fg("muted", "  " + extra), 0, 0));
	}
	return container;
}

function renderGoalResult(
	result: AgentToolResult<unknown>,
	theme: Theme,
	fallbackLabel: string,
): Component {
	const container = new Container();
	const details = result.details as { goal?: ThreadGoal; error?: string; hasGoal?: boolean } | undefined;

	if (details?.error) {
		container.addChild(new Text(theme.fg("error", "  " + details.error), 0, 0));
		return container;
	}

	if (details?.hasGoal === false) {
		container.addChild(new Text(theme.fg("muted", "  No goal is currently set."), 0, 0));
		return container;
	}

	if (details?.goal) {
		renderGoalDetails(details.goal, container, theme);
	} else {
		const textOut = result.content
			?.filter((c) => c.type === "text")
			.map((c) => c.type === "text" ? c.text : "")
			.join("\n");
		if (textOut) {
			container.addChild(new Text(theme.fg("toolOutput", textOut), 0, 0));
		}
	}
	return container;
}

// ============================================================================

export function createGetGoalTool(): ToolDefinition {
	return {
		name: "get_goal",
		label: "Get Goal",
		description:
			"Get the current thread goal. Returns null-equivalent (\"No goal is currently set.\") when none exists.",
		parameters: GetGoalInputSchema,
		isConcurrencySafe: true,
		guidance:
			"Call get_goal before deciding whether the user wants a new goal or to continue the existing one. " +
			"Use the returned objective verbatim when judging whether the work is done.",
		renderCall: (_args, theme) => renderGoalCall("get_goal", undefined, theme),
		renderResult: (result, _opts, theme) => renderGoalResult(result, theme, "Get Goal"),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const controller = getControllerFromContext(ctx);
			if (!controller) {
				return textResult("No goal is currently set.", { hasGoal: false });
			}
			const goal = await controller.get_goal();
			if (!goal) {
				return textResult("No goal is currently set.", { hasGoal: false });
			}
			return textResult(renderGoalResponse(goal), { goal });
		},
	};
}

export function createCreateGoalTool(): ToolDefinition {
	return {
		name: "create_goal",
		label: "Create Goal",
		description:
			"Create a new goal. Use only when the user explicitly asks for one. " +
			"If this thread already has an unfinished goal, the call fails \u2014 " +
			"do not retry; tell the user to /goal clear or /goal resume instead.",
		parameters: CreateGoalInputSchema,
		isConcurrencySafe: false,
		interruptBehavior: "cancel",
		guidance:
			"Prefer /goal <objective> from the user. Tool is reserved for cases where the user " +
			"asked for a goal in natural language and the assistant has to set it on their behalf.",
		renderCall: (args, theme) => {
			const a = args as { objective?: string; token_budget?: number };
			const parts = [a.objective ? `"${a.objective}"` : "(objective)"];
			if (a.token_budget) parts.push(`budget: ${a.token_budget}`);
			return renderGoalCall("create_goal", parts.join(" | "), theme);
		},
		renderResult: (result, _opts, theme) => renderGoalResult(result, theme, "Create Goal"),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const controller = getControllerFromContext(ctx);
			if (!controller) {
				return errorResult("create_goal is unavailable: goal runtime is not initialized.");
			}
			const obj = params as { objective?: unknown; token_budget?: unknown };
			const validatedObjective = validateObjective(typeof obj.objective === "string" ? obj.objective : "");
			if (!validatedObjective.ok) {
				return errorResult(validatedObjective.reason);
			}
			const validatedBudget = validateBudget(
				typeof obj.token_budget === "number" ? obj.token_budget : null,
			);
			if (!validatedBudget.ok) {
				return errorResult(validatedBudget.reason);
			}
			const goal = await controller.insert_goal(validatedObjective.value, validatedBudget.value);
			if (!goal) {
				return errorResult(
					"cannot create a new goal because this thread has an unfinished goal. " +
						"Tell the user to run /goal clear or /goal resume first.",
				);
			}
			return textResult(renderGoalResponse(goal), { goal });
		},
	};
}

export function createUpdateGoalTool(): ToolDefinition {
	return {
		name: "update_goal",
		label: "Update Goal",
		description:
			"Update the existing goal. Use only to mark 'complete' or 'blocked'. " +
			"'complete' is allowed only when the objective has been verified against the actual current state. " +
			"'blocked' is allowed only after 3 or more consecutive goal turns have ended in the same blocking condition.",
		parameters: UpdateGoalInputSchema,
		isConcurrencySafe: false,
		interruptBehavior: "cancel",
		guidance:
			"Do not call update_goal with pause/resume/budget_limited/usage_limited \u2014 those are user-driven and happen via /goal. " +
			"Do not call update_goal during plan mode.",
		renderCall: (args, theme) => {
			const a = args as { status?: string };
			return renderGoalCall("update_goal", `status -> ${a.status ?? "?"}`, theme);
		},
		renderResult: (result, _opts, theme) => renderGoalResult(result, theme, "Update Goal"),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const controller = getControllerFromContext(ctx);
			if (!controller) {
				return errorResult("update_goal is unavailable: goal runtime is not initialized.");
			}
			const obj = params as { status?: unknown };
			if (obj.status !== "complete" && obj.status !== "blocked") {
				return errorResult("status must be 'complete' or 'blocked'");
			}
			const goal = await controller.apply_update_goal({ status: obj.status });
			if (!goal) {
				return errorResult("cannot update goal because this thread has no goal");
			}
			return textResult(renderGoalResponse(goal, { includeUsage: obj.status === "complete" }), { goal });
		},
	};
}

function textResult(text: string, details: unknown): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

function errorResult(reason: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: `Error: ${reason}` }],
		details: { error: reason },
	};
}

// ----------------------------------------------------------------------------
// Controller access
// ----------------------------------------------------------------------------

let host: GoalToolHost | null = null;

export function setGoalToolHost(h: GoalToolHost): void {
	host = h;
}

function getControllerFromContext(ctx: ExtensionContext): GoalController | null {
	if (!host) return null;
	const threadId = ctx.sessionManager.getSessionId();
	if (!threadId) return null;
	return host.getController(ctx.agentDir, threadId);
}

export function buildAllGoalTools(): [ToolDefinition, ToolDefinition, ToolDefinition] {
	return [createGetGoalTool(), createCreateGoalTool(), createUpdateGoalTool()];
}

export const __test = {
	GetGoalInputSchema,
	CreateGoalInputSchema,
	UpdateGoalInputSchema,
};
