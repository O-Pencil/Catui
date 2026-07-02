/**
 * [WHO]: planExtension - registers /plan command, EnterPlanMode/ExitPlanMode tools, plan mode state management, permission gating, and workflow prompt injection
 * [FROM]: Depends on core/extensions-host/types, ./types, ./plan-file-manager, ./plan-permissions, ./plan-workflow-prompt, ./enter-plan-mode-tool, ./exit-plan-mode-tool, ./plan-agents
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/plan/index.ts - main plan mode extension entry point
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "../../../core/extensions-host/types.js";
import {
	getPlanSessionState,
	getPlanFilePath,
	getPlan,
	writePlan,
	getPlansDirectory,
	serializePlanSessionState,
} from "./plan-file-manager.js";
import {
	handlePlanModeTransition,
	handlePlanModeExit,
	shouldAllowToolCall,
} from "./plan-permissions.js";
import {
	getPlanModeInstructions,
	getPlanModeExitInstructions,
	getPlanModeReentryInstructions,
} from "./plan-workflow-prompt.js";
import { createEnterPlanModeTool } from "./enter-plan-mode-tool.js";
import { createExitPlanModeTool } from "./exit-plan-mode-tool.js";
import { getAndClearPendingPlan } from "./clear-context-state.js";
import { PLAN_CUSTOM_TYPE, type PlanSessionState } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const PLAN_ATTACHMENT_CONFIG = {
	TURNS_BETWEEN_ATTACHMENTS: 3,
	FULL_REMINDER_EVERY_N: 3,
};

const PLAN_ROOT_COMPLETIONS = [
	{ value: "open", label: "open", description: "Edit the current plan" },
	{ value: "exit", label: "exit", description: "Ask to leave plan mode" },
	{ value: "validate", label: "validate", description: "Check the current plan" },
	{ value: "approve", label: "approve", description: "Approve a teammate plan" },
] as const;

function getPlanArgumentCompletions(
	argumentPrefix: string,
	context?: { tokenIndex: number },
): Array<{ value: string; label: string; description?: string }> | null {
	if (context && context.tokenIndex > 0) return null;
	const prefix = argumentPrefix.trim().toLowerCase();
	const values = PLAN_ROOT_COMPLETIONS.filter((value) => value.value.startsWith(prefix));
	return values.length > 0 ? values.map((value) => ({ ...value })) : null;
}

function countHumanTurns(ctx: ExtensionContext): number {
	return ctx.sessionManager.getBranch().filter((entry) => {
		if (entry.type !== "message") return false;
		if (entry.message.role !== "user") return false;
		const content = entry.message.content;
		return typeof content === "string"
			? content.trim().length > 0
			: content.some((block) => block.type === "text" && block.text.trim().length > 0);
	}).length;
}

// ============================================================================
// State helpers
// ============================================================================

function preparePlansDirectory(ctx: ExtensionContext): void {
	const settings = ctx.getSettings();
	getPlansDirectory(settings.plansDirectory, ctx.cwd);
}

function getSessionState(api: ExtensionAPI, ctx?: ExtensionContext): PlanSessionState {
	return getPlanSessionState(
		api.events,
		ctx?.sessionManager.getSessionId(),
		ctx?.sessionManager.getEntries(),
	);
}

function persistPlanState(api: ExtensionAPI, sessionState: PlanSessionState): void {
	api.appendEntry(PLAN_CUSTOM_TYPE, serializePlanSessionState(sessionState));
}

function setPlanModeUi(ctx: ExtensionContext, api: ExtensionAPI): void {
	const planFilePath = getPlanFilePath(api.events);
	ctx.ui.setStatus("plan", "Plan mode");
	ctx.ui.setWidget("plan-mode", [
		`\x1b[35mPlan Mode On\x1b[0m`,
	], { placement: "aboveEditor" });
}

// ============================================================================
// Plan mode entry helper
// ============================================================================

async function enterPlanMode(
	api: ExtensionAPI,
	ctx: ExtensionCommandContext,
	description: string,
): Promise<void> {
	preparePlansDirectory(ctx);
	const sessionState = getSessionState(api, ctx);
	const previousMode = sessionState.state.mode;

	handlePlanModeTransition(sessionState);
	sessionState.state.prePlanMode = previousMode;
	sessionState.state.mode = "plan";

	setPlanModeUi(ctx, api);
	persistPlanState(api, sessionState);
	ctx.ui.notify("Enabled plan mode. Read-only except the plan file.", "info");

	if (description) {
		api.sendUserMessage(description, { deliverAs: "followUp" });
	}
}

// ============================================================================
// Tool gating helper
// ============================================================================

function hasTool(api: ExtensionAPI, name: string): boolean {
	const activeTools = api.getActiveTools();
	return activeTools.includes(name);
}

// ============================================================================
// Plan display helper
// ============================================================================

function displayPlan(api: ExtensionAPI, ctx: ExtensionCommandContext): void {
	preparePlansDirectory(ctx);
	const planFilePath = getPlanFilePath(api.events);
	const planContent = getPlan(api.events);

	if (!planContent) {
		ctx.ui.notify("Already in plan mode. No plan written yet.", "warning");
		return;
	}

	const output = [
		"Current Plan",
		`Path: ${planFilePath}`,
		"",
		planContent,
		"",
		(process.env.VISUAL || process.env.EDITOR)
			? `Use /plan open to edit this plan in ${process.env.VISUAL || process.env.EDITOR}.`
			: "Use /plan open to edit this plan.",
	];

	ctx.ui.notify(output.join("\n"), "info");
}

// ============================================================================
// Extension entry point
// ============================================================================

export default async function planExtension(api: ExtensionAPI) {
	// =========================================================================
	// Register tools
	// =========================================================================

	const enterPlanModeTool = createEnterPlanModeTool(
		api,
		() => getSessionState(api),
		() => false, // channels not implemented in Catui
	);

	const exitPlanModeTool = createExitPlanModeTool(
		api,
		() => getSessionState(api),
		() => hasTool(api, "Agent") || hasTool(api, "Task"),
	);

	api.registerTool(enterPlanModeTool);
	api.registerTool(exitPlanModeTool);

	// =========================================================================
	// /plan command handler
	// =========================================================================

	const handlePlanCommand = async (args: string, ctx: ExtensionCommandContext) => {
		preparePlansDirectory(ctx);
		const sessionState = getSessionState(api, ctx);
		const currentMode = sessionState.state.mode;

		// Not in plan mode: enter plan mode
		if (currentMode !== "plan") {
			const trimmed = args.trim();
			const description = trimmed.length > 0 && trimmed !== "open" && trimmed !== "exit" ? trimmed : "";
			await enterPlanMode(api, ctx, description);
			return;
		}

		// Already in plan mode
		const trimmed = args.trim();

		if (trimmed === "open") {
			const planFilePath = getPlanFilePath(api.events);
			if (!getPlan(api.events)) {
				await writePlan(api.events, "");
			}
			if (process.env.VISUAL || process.env.EDITOR) {
				const opened = await ctx.ui.openExternalEditor(planFilePath, "Edit Plan");
				if (opened) {
					const state = getSessionState(api, ctx);
					state.state.planSnapshot = getPlan(api.events) ?? undefined;
					persistPlanState(api, state);
					ctx.ui.notify(`Opened plan in editor: ${planFilePath}`, "info");
				} else {
					ctx.ui.notify("Failed to open plan in external editor.", "warning");
				}
				return;
			}

			const editedContent = await ctx.ui.editor("Edit Plan", getPlan(api.events) || "");
			if (editedContent === undefined) {
				ctx.ui.notify("Plan editing cancelled.", "info");
				return;
			}
			await writePlan(api.events, editedContent);
			const state = getSessionState(api, ctx);
			state.state.planSnapshot = editedContent;
			persistPlanState(api, state);
			ctx.ui.notify(`Plan saved to: ${planFilePath}`, "info");
			return;
		}

		if (trimmed === "exit") {
			try {
				await exitPlanModeTool.execute("plan-exit", { forceExit: true }, undefined, undefined, ctx);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(message, "warning");
			}
			return;
		}

		// Display plan content
		displayPlan(api, ctx);
	};

	// =========================================================================
	// /plan:validate command - validate current plan structure
	// =========================================================================

	const handlePlanValidateCommand = async (args: string, ctx: ExtensionCommandContext) => {
		const { validatePlan, formatValidationMessage } = await import("./plan-validation.js");

		const planFilePath = getPlanFilePath(api.events);
		const planContent = getPlan(api.events);

		if (!planContent) {
			ctx.ui.notify("No plan found. Write a plan first using the write tool.", "warning");
			return;
		}

		const result = validatePlan(planContent);
		const message = formatValidationMessage(result);

		if (result.valid) {
			ctx.ui.notify(`Plan validation passed:\n${message}`, "info");
		} else {
			ctx.ui.notify(`Plan validation failed:\n${message}`, "warning");
		}
	};

	api.registerCommand("plan:validate", {
		description: "Validate the current plan structure",
		handler: handlePlanValidateCommand,
	});

	// =========================================================================
	// /plan:approve command - approve a teammate's plan (for team leaders)
	// =========================================================================

	const handlePlanApproveCommand = async (args: string, ctx: ExtensionCommandContext) => {
		const fs = await import("node:fs");
		const os = await import("node:os");
		const path = await import("node:path");

		const mailDir = path.join(os.homedir(), ".catui", "agent", "team-mail");
		const requestId = args.trim();

		if (!requestId) {
			// List pending approval requests
			if (!fs.existsSync(mailDir)) {
				ctx.ui.notify("No pending plan approval requests.", "info");
				return;
			}

			const files = fs.readdirSync(mailDir).filter((f) => f.startsWith("plan_approval-") && f.endsWith(".json"));
			if (files.length === 0) {
				ctx.ui.notify("No pending plan approval requests.", "info");
				return;
			}

			const requests = files.map((file) => {
				const content = fs.readFileSync(path.join(mailDir, file), "utf-8");
				const request = JSON.parse(content);
				return `- Request ID: ${request.requestId}\n  From: ${request.from}\n  Time: ${new Date(request.timestamp).toLocaleString()}`;
			});

			ctx.ui.notify(
				"Pending plan approval requests:\n\n" + requests.join("\n\n") + "\n\nUse `/plan:approve <request-id>` to approve.",
				"info",
			);
			return;
		}

		// Find the request
		const requestFile = path.join(mailDir, `${requestId}.json`);
		if (!fs.existsSync(requestFile)) {
			ctx.ui.notify(`Request not found: ${requestId}`, "error");
			return;
		}

		// Read and display the request
		const requestContent = fs.readFileSync(requestFile, "utf-8");
		const request = JSON.parse(requestContent);

		// Create response
		const response = {
			type: "plan_approval_response",
			requestId,
			approved: true,
			approvedBy: "leader",
			timestamp: new Date().toISOString(),
		};

		// Write response file
		const responseFile = path.join(mailDir, `response-${requestId}.json`);
		fs.writeFileSync(responseFile, JSON.stringify(response, null, 2), "utf-8");

		// Show the plan content
		ctx.ui.notify(
			`Plan approved for ${request.from}.\n\nPlan content:\n\`\`\`\n${request.planContent.slice(0, 500)}${request.planContent.length > 500 ? "\n...(truncated)" : ""}\n\`\`\`\n\nThe teammate can now proceed with implementation.`,
			"info",
		);
	};

	api.registerCommand("plan:approve", {
		description: "Approve a teammate's plan (for team leaders)",
		handler: handlePlanApproveCommand,
	});

	api.registerCommand("plan", {
		description: "Plan, edit, validate, approve, or exit the current session plan",
		getArgumentCompletions: getPlanArgumentCompletions,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [action, ...rest] = args.trim().split(/\s+/);
			if (action === "validate") {
				await handlePlanValidateCommand("", ctx);
				return;
			}
			if (action === "approve") {
				await handlePlanApproveCommand(rest.join(" "), ctx);
				return;
			}
			await handlePlanCommand(args, ctx);
		},
	});

	// =========================================================================
	// Permission gating: block write tools in plan mode
	// =========================================================================

	api.on("tool_call", (event: ToolCallEvent): ToolCallEventResult | void => {
		const sessionState = getSessionState(api);
		if (sessionState.state.mode !== "plan") return;

		const toolCall = {
			toolName: event.toolName,
			toolCallId: event.toolCallId,
			input: event.input,
		};

		const planFilePath = getPlanFilePath(api.events);
		const result = shouldAllowToolCall(toolCall, planFilePath, api.cwd);

		if (!result.allowed) {
			return { block: true, reason: result.reason };
		}
	});

	// =========================================================================
	// Agent abort: soft-exit plan mode when user interrupts the agent
	// =========================================================================

	api.on("agent_abort", (_event, ctx) => {
		const sessionState = getSessionState(api);
		if (sessionState.state.mode !== "plan") return;

		// Soft-exit plan mode: restore prePlanMode, persist state, clear UI
		handlePlanModeExit(sessionState);
		api.appendEntry(PLAN_CUSTOM_TYPE, serializePlanSessionState(sessionState));

		ctx.ui.setStatus("plan", undefined);
		ctx.ui.setWidget("plan-mode", undefined);

		ctx.ui.notify("Plan mode exited (interrupted). Plan file preserved.", "info");
	});

	// =========================================================================
	// System prompt injection: plan mode workflow
	// =========================================================================

	api.on("before_agent_start", async (_event, ctx) => {
		// Clear-context plan injection: if a plan was queued before /new, inject it now
		const pendingPlan = getAndClearPendingPlan();
		if (pendingPlan) {
			return {
				appendSystemPrompt: `## Plan to Implement\n\nThe user approved the following plan in a previous context. Implement it now:\n\n${pendingPlan}`,
			};
		}

		preparePlansDirectory(ctx);
		const sessionState = getSessionState(api, ctx);
		const { mode, needsPlanModeExitAttachment, hasExitedPlanModeInSession, planAttachmentCount } = sessionState.state;

		// Exit attachment: injected once after plan mode exit
		if (mode !== "plan" && needsPlanModeExitAttachment) {
			sessionState.state.needsPlanModeExitAttachment = false;
			persistPlanState(api, sessionState);
			const planFilePath = getPlanFilePath(api.events);
			const planExists = getPlan(api.events) !== null;
			return {
				appendSystemPrompt: getPlanModeExitInstructions(
					planFilePath,
					planExists,
					sessionState.state.lastAllowedPrompts,
				),
			};
		}

		// Plan mode: inject workflow prompt
		if (mode === "plan") {
			setPlanModeUi(ctx, api);
			const planFilePath = getPlanFilePath(api.events);
			const existingPlan = getPlan(api.events);
			const humanTurns = countHumanTurns(ctx);
			if (
				sessionState.state.lastPlanAttachmentHumanTurn !== undefined &&
				humanTurns - sessionState.state.lastPlanAttachmentHumanTurn < PLAN_ATTACHMENT_CONFIG.TURNS_BETWEEN_ATTACHMENTS
			) {
				return;
			}

			// Reentry detection
			if (hasExitedPlanModeInSession && existingPlan !== null) {
				sessionState.state.hasExitedPlanModeInSession = false;
				sessionState.state.lastPlanAttachmentHumanTurn = humanTurns;
				persistPlanState(api, sessionState);
				// Prepend reentry instructions
				const reentry = getPlanModeReentryInstructions(planFilePath);
				const workflow = getPlanModeInstructions(sessionState, planFilePath, existingPlan, "full");
				return {
					appendSystemPrompt: reentry + "\n\n" + workflow,
				};
			}

			// Throttle: sparse reminder if we've sent recently
			const shouldFullReminder = planAttachmentCount % PLAN_ATTACHMENT_CONFIG.FULL_REMINDER_EVERY_N === 0;
			const reminderType = shouldFullReminder ? "full" : "sparse";

			sessionState.state.planAttachmentCount += 1;
			sessionState.state.lastPlanAttachmentHumanTurn = humanTurns;
			sessionState.state.planSnapshot = existingPlan ?? undefined;
			persistPlanState(api, sessionState);

			const prompt = getPlanModeInstructions(sessionState, planFilePath, existingPlan, reminderType);
			return {
				appendSystemPrompt: prompt,
			};
		}
	});

	// =========================================================================
	// Alt+G shortcut: open plan file in external editor
	// (ctrl+g is the built-in externalEditor binding and may not be shadowed)
	// =========================================================================

	api.registerShortcut("alt+g" as any, {
		description: "Open plan file in external editor",
		handler: async (ctx: ExtensionContext) => {
			const sessionState = getSessionState(api, ctx);
			if (sessionState.state.mode !== "plan") {
				ctx.ui.notify("Not in plan mode.", "info");
				return;
			}

			const planFilePath = getPlanFilePath(api.events);
			if (!getPlan(api.events)) {
				await writePlan(api.events, "");
			}

			if (process.env.VISUAL || process.env.EDITOR) {
				const opened = await ctx.ui.openExternalEditor(planFilePath, "Edit Plan");
				if (opened) {
					const state = getSessionState(api, ctx);
					state.state.planSnapshot = getPlan(api.events) ?? undefined;
					persistPlanState(api, state);
					ctx.ui.notify(`Opened plan in editor: ${planFilePath}`, "info");
				} else {
					ctx.ui.notify("Failed to open plan in external editor.", "warning");
				}
			} else {
				ctx.ui.notify("No $VISUAL or $EDITOR set. Cannot open external editor.", "warning");
			}
		},
	});

	// =========================================================================
	// Session lifecycle
	// =========================================================================

	api.on("session_start", (_event, ctx) => {
		// Initialize plan directory
		preparePlansDirectory(ctx);

		// Restore plan mode status if we're in plan mode (session restored while in plan mode)
		const sessionState = getSessionState(api, ctx);
		if (sessionState.state.mode === "plan") {
			setPlanModeUi(ctx, api);
		}
	});

	api.on("session_shutdown", () => {
		// Cleanup: nothing needed for plan mode
	});
}
