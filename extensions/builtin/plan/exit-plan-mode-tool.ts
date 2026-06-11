/**
 * [WHO]: createExitPlanModeTool()
 * [FROM]: Depends on @sinclair/typebox, core/extensions-host/types, ./types, ./plan-permissions, ./plan-workflow-prompt, ./plan-file-manager, ./plan-validation, ./teammate-approval
 * [TO]: Consumed by plan extension index.ts
 * [HERE]: extensions/builtin/plan/exit-plan-mode-tool.ts - ExitPlanMode tool for model-requested plan approval
 */

import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionAPI, ToolDefinition } from "../../../core/extensions-host/types.js";
import { Container, Text, type Component } from "@pencil-agent/tui";
import type { Theme } from "../../../core/theme-contract.js";
import type { AgentToolResult } from "@pencil-agent/agent-core";
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
import { setPendingClearContextPlan } from "./clear-context-state.js";
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
	allowedPrompts: Type.Optional(Type.Array(
		Type.Object({
			tool: Type.String({ description: "Tool name (e.g. 'Bash')" }),
			prompt: Type.String({ description: "Semantic description of the permitted action" }),
		}),
		{ description: "Pre-approved tool permission rules for the implementation phase" },
	)),
});

type ExitPlanModeInput = Static<typeof ExitPlanModeInputSchema>;

// ============================================================================
// renderCall / renderResult (rich TUI display in message flow)
// ============================================================================

function renderCallForExitPlanMode(args: unknown, theme: Theme): Component {
	const container = new Container();
	container.addChild(
		new Text(theme.fg("toolTitle", theme.bold("ExitPlanMode")), 0, 0),
	);

	const a = args as ExitPlanModeInput;
	const plan = "plan" in a && typeof a.plan === "string" ? a.plan : undefined;
	if (plan) {
		container.addChild(new Text("", 0, 0));
		container.addChild(
			new Text(theme.fg("accent", "Plan preview:") + (plan.length > 1200 ? theme.fg("muted", " (truncated)") : ""), 0, 0),
		);
		const preview = plan.slice(0, 1200);
		// Render plan content as readable text lines
		for (const line of preview.split("\n")) {
			container.addChild(new Text(theme.fg("text", `  ${line}`), 0, 0));
		}
	} else {
		container.addChild(
			new Text(theme.fg("muted", "  Requesting plan approval..."), 0, 0),
		);
	}

	const allowedPrompts = "allowedPrompts" in a && Array.isArray(a.allowedPrompts)
		? a.allowedPrompts as Array<{ tool: string; prompt: string }>
		: undefined;
	if (allowedPrompts && allowedPrompts.length > 0) {
		container.addChild(new Text("", 0, 0));
		container.addChild(new Text(theme.fg("accent", "Requested permissions:"), 0, 0));
		for (const p of allowedPrompts) {
			container.addChild(new Text(theme.fg("toolOutput", `  - ${p.tool}: ${p.prompt}`), 0, 0));
		}
	}

	return container;
}

function renderResultForExitPlanMode(
	result: AgentToolResult<unknown>,
	_options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
): Component {
	const container = new Container();
	const isError = (result as any).isError === true;
	const textOut = result.content
		?.filter((c) => c.type === "text")
		.map((c) => c.type === "text" ? c.text : "")
		.join("\n");
	if (textOut) {
		if (isError) {
			container.addChild(new Text(theme.fg("error", textOut), 0, 0));
		} else {
			container.addChild(new Text(theme.fg("success", "Plan approved"), 0, 0));
			// Show truncated result text
			const preview = textOut.length > 300 ? textOut.slice(0, 300) + "..." : textOut;
			container.addChild(new Text(theme.fg("toolOutput", preview), 0, 0));
		}
	}
	return container;
}

export function createExitPlanModeTool(
	api: ExtensionAPI,
	getSessionState: () => PlanSessionState,
	hasAgentTool: () => boolean,
): ToolDefinition<typeof ExitPlanModeInputSchema, null> {
	return {
		name: "ExitPlanMode",
		label: "Exit Plan Mode",
		description: "Present your plan for approval and start coding. Only usable in plan mode after writing a plan.",
		parameters: ExitPlanModeInputSchema,

		renderCall: renderCallForExitPlanMode,
		renderResult: renderResultForExitPlanMode,

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

			// Extract allowedPrompts
			const allowedPrompts = "allowedPrompts" in input && Array.isArray(input.allowedPrompts)
				? input.allowedPrompts as Array<{ tool: string; prompt: string }>
				: undefined;

			// Build preview
			const preview = plan && plan.trim().length > 0
				? plan.trim().slice(0, 1200)
				: "No plan content was written.";

			const allowedPromptsBlock = allowedPrompts && allowedPrompts.length > 0
				? `\nRequested permissions:\n${allowedPrompts.map((p) => `  - ${p.tool}: ${p.prompt}`).join("\n")}\n`
				: "";

			const choice = await ctx.ui.select(
				[
					"Plan ready for review:",
					`Plan file: ${planFilePath}`,
					"",
					preview,
					plan && plan.length > 1200 ? "\n...(truncated)" : "",
					allowedPromptsBlock,
					"Choose next action:",
				].join("\n"),
				[
					"Execute plan (standard)",
					"Execute plan (elevated mode)",
					"Execute plan (clear context + elevated)",
					"Keep planning",
					"Reject plan",
				],
			);

			// Handle "Keep planning" — reject, stay in plan mode
			if (choice === "Keep planning") {
				ctx.abort();
				throw new Error(
					"User chose to keep planning. Stay in plan mode, revise the plan file, and call ExitPlanMode again when ready.",
				);
			}

			// Handle "Reject plan" — reject with feedback
			if (choice === "Reject plan") {
				ctx.abort();
				throw new Error(
					"User rejected the plan. Stay in plan mode and revise the plan based on user feedback.",
				);
			}

			// Approved — store allowedPrompts in session state
			if (allowedPrompts) {
				sessionState.state.lastAllowedPrompts = allowedPrompts;
			}

			// Handle "Execute plan (clear context + elevated)"
			if (choice === "Execute plan (clear context + elevated)") {
				handlePlanModeExit(sessionState);
				sessionState.state.mode = "bypassPermissions";
				api.appendEntry(PLAN_CUSTOM_TYPE, serializePlanSessionState(sessionState));
				ctx.ui.setStatus("plan", undefined);
				ctx.ui.setWidget("plan-mode", undefined);

				// Queue plan for injection into the new session
				const planSnippet = plan ? plan.trim().slice(0, 8000) : "(no plan content)";
				setPendingClearContextPlan(planSnippet);

				// Create a new session (clears old context)
				await api.executeCommand("/new");

				ctx.ui.notify("Plan approved. Starting fresh context with elevated permissions.", "info");
				return {
					content: [{
						type: "text",
						text: "Plan approved. New context started with elevated permissions. The plan has been injected as the initial message.",
					}],
					details: null,
				};
			}

			// Handle "Execute plan (elevated mode)"
			if (choice === "Execute plan (elevated mode)") {
				handlePlanModeExit(sessionState);
				sessionState.state.mode = "bypassPermissions";
				api.appendEntry(PLAN_CUSTOM_TYPE, serializePlanSessionState(sessionState));
				ctx.ui.setStatus("plan", undefined);
				ctx.ui.setWidget("plan-mode", undefined);

				const resultText = getExitPlanModeApprovedResult(plan, planFilePath, planWasEdited, hasAgentTool(), allowedPrompts);
				ctx.ui.notify("Plan approved. Elevated mode active.", "info");
				return {
					content: [{ type: "text", text: resultText }],
					details: null,
				};
			}

			// Handle "Execute plan (standard)" — default
			handlePlanModeExit(sessionState);
			api.appendEntry(PLAN_CUSTOM_TYPE, serializePlanSessionState(sessionState));
			ctx.ui.setStatus("plan", undefined);
			ctx.ui.setWidget("plan-mode", undefined);

			const resultText = getExitPlanModeApprovedResult(plan, planFilePath, planWasEdited, hasAgentTool(), allowedPrompts);
			ctx.ui.notify("Plan approved. Implementation mode active.", "info");
			return {
				content: [{ type: "text", text: resultText }],
				details: null,
			};
		},
	};
}
