/**
 * [WHO]: Goal slash command handler - dispatches /goal subcommands (show/clear/edit/pause/resume/set), manages ConfirmIfExists confirmation dialog, and renders the multi-line summary
 * [FROM]: Depends on core/extensions-host/types, ./goal-controller, ./goal-parser, ./goal-types, ./goal-format
 * [TO]: Consumed by ./index via registerCommand
 * [HERE]: extensions/builtin/goal/goal-command.ts - UI + persistence boundary for /goal
 */

import type { ExtensionCommandContext } from "../../../core/extensions-host/types.js";
import type { GoalController } from "./goal-controller.js";
import {
	editedGoalStatus,
	formatGoalElapsedSeconds,
	formatTokens,
	goalStatusLabel,
	goalSummaryLines,
	goalUsageSummary,
	shouldConfirmBeforeReplacing,
	validateBudget,
	validateObjective,
} from "./goal-format.js";
import { buildGoalHelp, parseGoalCommand } from "./goal-parser.js";
import type { ThreadGoal, ThreadGoalStatus } from "./goal-types.js";

export async function runGoalCommand(
	args: string,
	ctx: ExtensionCommandContext,
	controller: GoalController | null,
): Promise<void> {
	const parsed = parseGoalCommand(args);

	if (!controller) {
		ctx.ui.notify("Goal runtime is not initialized.", "warning");
		return;
	}

	switch (parsed.type) {
		case "help":
			ctx.ui.notify(buildGoalHelp(), "info");
			return;

		case "show":
			await showGoal(controller, ctx);
			return;

		case "clear":
			await clearGoal(controller, ctx);
			return;

		case "edit":
			await editGoal(controller, ctx);
			return;

		case "pause":
			await setStatus(controller, ctx, "paused");
			return;

		case "resume":
			await setStatus(controller, ctx, "active");
			return;

		case "set":
			await setObjective(controller, ctx, parsed.objective);
			return;
	}
}

async function showGoal(controller: GoalController, ctx: ExtensionCommandContext): Promise<void> {
	const goal = await controller.get_goal();
	if (!goal) {
		ctx.ui.notify(`${buildGoalHelp()}\n\nNo goal is currently set.`, "info");
		return;
	}
	const lines = goalSummaryLines(goal);
	for (const line of lines) {
		ctx.ui.notify(line, "info");
	}
}

async function clearGoal(controller: GoalController, ctx: ExtensionCommandContext): Promise<void> {
	const existing = await controller.get_goal();
	if (!existing) {
		ctx.ui.notify("No goal is currently set.", "info");
		return;
	}
	const ok = await controller.clear();
	if (ok) {
		controller.sendGoalFeedback("Goal cleared.", { kind: "clear" });
	} else {
		ctx.ui.notify("Goal was already cleared.", "info");
	}
}

async function editGoal(controller: GoalController, ctx: ExtensionCommandContext): Promise<void> {
	const existing = await controller.get_goal();
	if (!existing) {
		ctx.ui.notify("No goal is currently set.", "info");
		return;
	}
	const edited = await ctx.ui.editor("Edit goal objective", existing.objective);
	if (edited === undefined) {
		ctx.ui.notify("Edit cancelled.", "info");
		return;
	}
	const validated = validateObjective(edited);
	if (!validated.ok) {
		ctx.ui.notify(validated.reason, "error");
		return;
	}
	const next = editedGoalStatus(existing.status);
	const result = await controller.set_objective(validated.value, "UpdateExisting", { status: next });
	if (!result.goal) {
		ctx.ui.notify("Goal update failed: no goal row found.", "error");
		return;
	}
		controller.inject_objective_updated_steering();
	controller.sendGoalFeedback(`Goal updated.\n${summarizeGoal(result.goal)}`, { kind: "edit", goal: result.goal });
}

async function setStatus(
	controller: GoalController,
	ctx: ExtensionCommandContext,
	status: ThreadGoalStatus,
): Promise<void> {
	const existing = await controller.get_goal();
	if (!existing) {
		ctx.ui.notify("No goal is currently set.", "info");
		return;
	}
	const updated = await controller.set_status(status);
	if (!updated) {
		ctx.ui.notify("Failed to update goal status.", "error");
		return;
	}
	const verb = status === "active" ? "resumed" : status === "paused" ? "paused" : `set to ${goalStatusLabel(status)}`;
	ctx.ui.notify(`Goal ${verb}.\n${summarizeGoal(updated)}`, "info");
}

async function setObjective(
	controller: GoalController,
	ctx: ExtensionCommandContext,
	objectiveRaw: string,
): Promise<void> {
	const validated = validateObjective(objectiveRaw);
	if (!validated.ok) {
		ctx.ui.notify(validated.reason, "error");
		return;
	}
	const validatedBudget = validateBudget(null);
	if (!validatedBudget.ok) {
		ctx.ui.notify(validatedBudget.reason, "error");
		return;
	}

	const existing = await controller.get_goal();
	if (existing && shouldConfirmBeforeReplacing(existing)) {
		const ok = await ctx.ui.confirm(
			"Replace goal?",
			`Existing objective: ${existing.objective}\nNew objective: ${validated.value}`,
		);
		if (!ok) {
			ctx.ui.notify("Goal unchanged.", "info");
			return;
		}
		const result = await controller.set_objective(validated.value, "ReplaceExisting", {
			tokenBudget: validatedBudget.value,
		});
		if (!result.goal) {
			ctx.ui.notify("Goal replace failed.", "error");
			return;
		}
		controller.sendGoalFeedback(`Goal replaced.\n${summarizeGoal(result.goal)}`, { kind: "set", goal: result.goal });
		controller.kickOffContinuation();
		return;
	}

	const result = await controller.set_objective(validated.value, "ConfirmIfExists", {
		tokenBudget: validatedBudget.value,
	});
	if (result.kind === "confirm_required") {
		// Should not happen — shouldConfirmBeforeReplacing handled this — but guard anyway.
		ctx.ui.notify("Goal replace requires confirmation.", "warning");
		return;
	}
	if (!result.goal) {
		ctx.ui.notify("Goal set failed.", "error");
		return;
	}
	controller.sendGoalFeedback(`Goal active.\n${summarizeGoal(result.goal)}`, { kind: "set", goal: result.goal });
	// Kick off agent to start pursuing the goal immediately
	controller.kickOffContinuation();
}

function summarizeGoal(goal: ThreadGoal): string {
	const summary = goalUsageSummary(goal);
	const lines = [
		`  Status: ${goalStatusLabel(goal.status)}`,
		`  Objective: ${goal.objective}`,
		`  Time used: ${summary.elapsed}`,
		`  Tokens used: ${summary.tokensLabel}${summary.hasBudget ? " tokens" : ""}`,
	];
	return lines.join("\n");
}

export { formatGoalElapsedSeconds, formatTokens, summarizeGoal };
