/**
 * [WHO]: createExitPlanModeTool()
 * [FROM]: Depends on @sinclair/typebox, core/extensions-host/types, ./types, ./plan-permissions, ./plan-workflow-prompt, ./plan-file-manager, ./plan-validation, ./teammate-approval
 * [TO]: Consumed by plan extension index.ts
 * [HERE]: extensions/builtin/plan/exit-plan-mode-tool.ts - ExitPlanMode tool for model-requested plan approval
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionAPI, ToolDefinition } from "../../../core/extensions-host/types.js";
import { PLAN_CUSTOM_TYPE, type PlanSessionState } from "./types.js";
import { handlePlanModeExit } from "./plan-permissions.js";
import {
	getPlanFilePath,
	getPlan,
	getPlansDirectory,
	serializePlanSessionState,
	writePlan,
} from "./plan-file-manager.js";
import { getExitPlanModeApprovedResult } from "./plan-workflow-prompt.js";
import { validatePlan, formatValidationMessage } from "./plan-validation.js";
import {
	isInTeammateContext,
	submitPlanToLeader,
	formatPlanSubmittedMessage,
} from "./teammate-approval.js";

// ============================================================================
// Schema
// ============================================================================

// Schema with optional plan field for external editor integration
// (CCR/web UI may pass edited plan content)
const ExitPlanModeInputSchema = Type.Object({
	plan: Type.Optional(Type.String({
		description: "Edited plan content from external editor (optional)",
	})),
	forceExit: Type.Optional(Type.Boolean({
		description: "Force exit even if plan validation fails (for trivial changes)",
	})),
});

type ExitPlanModeInput = Static<typeof ExitPlanModeInputSchema>;

// ============================================================================
// Tool creation
// ============================================================================

export function createExitPlanModeTool(
	api: ExtensionAPI,
	getSessionState: () => PlanSessionState,
	hasAgentTool: () => boolean,
): ToolDefinition {
	return {
		name: "ExitPlanMode",
		label: "Exit Plan Mode",
		description: "Present your plan for approval and start coding. Only usable in plan mode after writing a plan.",
		parameters: ExitPlanModeInputSchema,

		execute: async (
			_toolCallId: string,
			input: ExitPlanModeInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx,
		) => {
			getPlansDirectory(ctx.getSettings().plansDirectory, ctx.cwd);
			const sessionState = getSessionState();

			// Validate: must be in plan mode
			if (sessionState.state.mode !== "plan") {
				return {
					content: [{
						type: "text",
						text: "You are not in plan mode. This tool is only for exiting plan mode after writing a plan. If your plan was already approved, continue with implementation.",
					}],
					isError: true,
					details: null,
				};
			}

			// Extract input fields
			const inputPlan =
				"plan" in input && typeof input.plan === "string"
					? input.plan
					: undefined;
			const forceExit =
				"forceExit" in input && input.forceExit === true;

			// Read plan file
			const planFilePath = getPlanFilePath(api.events);
			const filePlan = getPlan(api.events);
			const plan = inputPlan ?? filePlan;

			// If input.plan was provided, write it back to the plan file
			const planWasEdited = inputPlan !== undefined;
			if (planWasEdited && plan !== null) {
				await writePlan(api.events, plan);
			}
			sessionState.state.planSnapshot = plan ?? undefined;

			// Plan validation
			if (!forceExit) {
				const validation = validatePlan(plan || "");
				if (!validation.valid) {
					const message = formatValidationMessage(validation);
					return {
						content: [{
							type: "text",
							text: `Plan validation failed:\n\n${message}\n\nPlease add the missing sections and try again, or use forceExit: true for trivial changes.`,
						}],
						isError: true,
						details: null,
					};
				}
			}

			// Check if we're in teammate context
			if (isInTeammateContext()) {
				if (!plan || plan.trim().length === 0) {
					throw new Error(
						`No plan file found at ${planFilePath}. Please write your plan to this file before calling ExitPlanMode.`,
					);
				}
				// Submit plan to leader for approval
				try {
					const { requestId } = await submitPlanToLeader(planFilePath, plan || "");
					const submittedMessage = formatPlanSubmittedMessage(requestId, planFilePath);

					// Mark as awaiting approval - mode is still "plan" until approved
					sessionState.state.mode = "plan"; // Keep in plan mode
					// Note: handlePlanModeExit is NOT called here - we stay in plan mode
					api.appendEntry(PLAN_CUSTOM_TYPE, serializePlanSessionState(sessionState));
					ctx.abort();

					return {
						content: [{
							type: "text",
							text: submittedMessage,
						}],
						details: null,
					};
				} catch (err) {
					// Fall through to normal exit if submission fails
					console.error(`Failed to submit plan to leader: ${err}`);
				}
			}

			if (!ctx.hasUI) {
				ctx.abort();
				throw new Error(
					"ExitPlanMode requires user approval, but no interactive UI is available. Stay in plan mode and ask the user to approve from an interactive session.",
				);
			}

			const preview = plan && plan.trim().length > 0
				? plan.trim().slice(0, 1200)
				: "No plan content was written.";
			const choice = await ctx.ui.select(
				[
					"Plan ready for review:",
					`Plan file: ${planFilePath}`,
					"",
					preview,
					plan && plan.length > 1200 ? "\n...(truncated)" : "",
					"",
					"Choose next action:",
				].join("\n"),
				["Execute plan", "Keep planning"],
			);
			const approved = choice === "Execute plan";

			if (!approved) {
				ctx.abort();
				throw new Error(
					"User rejected exiting plan mode. Stay in plan mode, revise the plan file, and call ExitPlanMode again when ready.",
				);
			}

			// Normal exit: restore permissions
			handlePlanModeExit(sessionState);
			api.appendEntry(PLAN_CUSTOM_TYPE, serializePlanSessionState(sessionState));

			// Clear plan mode status in TUI footer
			ctx.ui.setStatus("plan", undefined);
			ctx.ui.setWidget("plan-mode", undefined);

			// Build result message
			const resultText = getExitPlanModeApprovedResult(
				plan,
				planFilePath,
				planWasEdited,
				hasAgentTool(),
			);

			// Notify user
			ctx.ui.notify("Plan approved. Implementation mode active.", "info");

			return {
				content: [{
					type: "text",
					text: resultText,
				}],
				details: null,
			};
		},
	};
}
