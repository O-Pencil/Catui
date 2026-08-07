/**
 * [WHO]: shouldAllowToolCall(), plan-mode state transition helpers
 * [FROM]: Depends on core/runtime/plan-mode-permissions and ./types
 * [TO]: Consumed by plan extension index.ts and plan tools
 * [HERE]: extensions/builtin/plan/plan-permissions.ts - interactive adapter over the shared plan policy
 */

import { evaluatePlanModeToolCall } from "../../../core/runtime/plan-mode-permissions.js";
import type { PlanSessionState, ToolCallInput, ToolPermissionResult } from "./types.js";

function classificationFor(toolName: string, allowed: boolean): ToolPermissionResult["classification"] {
	if (toolName === "ExitPlanMode" || toolName === "EnterPlanMode") return "plan";
	if (["write", "Write", "edit", "Edit", "notebookEdit", "NotebookEdit", "write_file", "edit_file", "replace", "create_file", "delete_file"].includes(toolName)) return "write";
	if (["Agent", "Task", "TaskCreate"].includes(toolName)) return "agent";
	if (toolName === "bash" || toolName === "Bash") return allowed ? "read" : "write";
	if (["read", "Read", "grep", "Grep", "find", "Find", "ls", "Ls", "time", "Time", "source", "LSP", "AskUserQuestion", "WebSearch", "WebFetch", "GetGoal"].includes(toolName)) return "read";
	return "unknown";
}

/** Interactive plan mode always supplies the exact active plan file. */
export function shouldAllowToolCall(
	toolCall: ToolCallInput,
	planFilePath: string,
	cwd = process.cwd(),
): ToolPermissionResult {
	const decision = evaluatePlanModeToolCall({
		toolCallId: toolCall.toolCallId,
		toolName: toolCall.toolName,
		requestedToolName: toolCall.toolName,
		input: toolCall.input,
		rawInput: toolCall.input,
	}, cwd, { planFilePath });
	const classification = classificationFor(toolCall.toolName, decision.decision === "allow");
	if (decision.decision === "allow") {
		return { allowed: true, classification: classification === "unknown" ? undefined : classification };
	}
	const deniedClassification = classification === "plan"
		? "agent"
		: classification === "read"
			? "unknown"
			: classification;
	return {
		allowed: false,
		classification: deniedClassification,
		reason: decision.reason ?? `In plan mode, tool "${toolCall.toolName}" is not allowed.`,
	};
}

export function handlePlanModeTransition(sessionState: PlanSessionState): void {
	sessionState.state.needsPlanModeExitAttachment = false;
	sessionState.state.planAttachmentCount = 0;
}

export function handlePlanModeExit(sessionState: PlanSessionState): void {
	sessionState.state.hasExitedPlanModeInSession = true;
	sessionState.state.needsPlanModeExitAttachment = true;
	sessionState.state.mode = sessionState.state.prePlanMode;
	sessionState.state.prePlanMode = "default";
}
