/**
 * [WHO]: PlanModeState, PlanModeAttachment types, PlanModeConfig
 * [FROM]: Depends on core/extensions-host/types (EventBus reference)
 * [TO]: Consumed by all plan extension modules
 * [HERE]: extensions/builtin/plan/types.ts - type definitions for plan mode
 */

import type { EventBus } from "../../../core/runtime/event-bus.js";

export const PLAN_CUSTOM_TYPE = "plan_state";

// ============================================================================
// Plan Mode State
// ============================================================================

export type PlanModePermissionMode =
	| "default"
	| "plan"
	| "auto"
	| "acceptEdits"
	| "bypassPermissions";

export interface PlanModeState {
	/** Current permission mode */
	mode: PlanModePermissionMode;
	/** Mode before entering plan mode, restored on exit */
	prePlanMode: PlanModePermissionMode;
	/** Whether to inject plan mode exit attachment on next turn */
	needsPlanModeExitAttachment: boolean;
	/** Whether the user has exited plan mode in this session (for reentry detection) */
	hasExitedPlanModeInSession: boolean;
	/** Count of plan mode attachments sent (for throttling) */
	planAttachmentCount: number;
	/** Last session id this in-memory state was hydrated from */
	hydratedSessionId?: string;
	/** Number of human turns seen when the last plan attachment was injected */
	lastPlanAttachmentHumanTurn?: number;
	/** Current session id, when available */
	sessionId?: string;
	/** Current plan slug, persisted for resume/fork recovery */
	planSlug?: string;
	/** Last known plan file snapshot for recovery */
	planSnapshot?: string;
	/** Pre-approved tool permissions from the last ExitPlanMode call */
	lastAllowedPrompts?: Array<{ tool: string; prompt: string }>;
}

// ============================================================================
// Session-scoped state container
// ============================================================================

export interface PlanSessionState {
	state: PlanModeState;
	planSlugCache: string | undefined;
}

export type PlanStateMap = WeakMap<EventBus, PlanSessionState>;

// ============================================================================
// Plan File System
// ============================================================================

export interface PlanFileInfo {
	slug: string;
	path: string;
	content: string | null;
	exists: boolean;
}

// ============================================================================
// Workflow Prompt Attachments
// ============================================================================

export type PlanAttachmentType = "plan_mode" | "plan_mode_exit" | "plan_mode_reentry" | "plan_file_reference";

export interface PlanModeAttachment {
	type: "plan_mode";
	reminderType: "full" | "sparse";
	isSubAgent: boolean;
	planFilePath: string;
	planExists: boolean;
}

export interface PlanModeReentryAttachment {
	type: "plan_mode_reentry";
	planFilePath: string;
}

export interface PlanModeExitAttachment {
	type: "plan_mode_exit";
	planFilePath: string;
	planExists: boolean;
}

export interface PlanFileReferenceAttachment {
	type: "plan_file_reference";
	planFilePath: string;
	planContent: string;
}

export type PlanAttachment =
	| PlanModeAttachment
	| PlanModeReentryAttachment
	| PlanModeExitAttachment
	| PlanFileReferenceAttachment;

// ============================================================================
// Permission gating
// ============================================================================

export type ToolPermissionResult =
	| { allowed: true; classification?: "read" | "write" | "plan" | "agent" }
	| { allowed: false; reason: string; classification?: "write" | "unknown" | "agent" };

export interface PlanStateEntryData {
	version: 1;
	sessionId?: string;
	mode: PlanModePermissionMode;
	prePlanMode: PlanModePermissionMode;
	needsPlanModeExitAttachment: boolean;
	hasExitedPlanModeInSession: boolean;
	planAttachmentCount: number;
	lastPlanAttachmentHumanTurn?: number;
	planSlug?: string;
	planSnapshot?: string;
	lastAllowedPrompts?: Array<{ tool: string; prompt: string }>;
}

// ============================================================================
// Configuration
// ============================================================================

export interface PlanModeConfig {
	/** Plan file directory override */
	plansDirectory?: string;
	/** Number of turns between full plan mode reminders */
	turnsBetweenFullReminder: number;
	/** Every N attachments, inject a full reminder instead of sparse */
	fullReminderEveryN: number;
	/** Maximum number of Explore subagents */
	maxExploreAgents: number;
	/** Maximum number of Plan subagents */
	maxPlanAgents: number;
}

export const DEFAULT_PLAN_CONFIG: PlanModeConfig = {
	turnsBetweenFullReminder: 3,
	fullReminderEveryN: 3,
	maxExploreAgents: 3,
	maxPlanAgents: 1,
};

// ============================================================================
// Tool call event input shape (for permission checking)
// ============================================================================

export interface ToolCallInput {
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
}

// ============================================================================
// Teammate approval flow
// ============================================================================

export interface PlanApprovalRequest {
	type: "plan_approval_request";
	from: string;
	timestamp: string;
	planFilePath: string;
	planContent: string;
	requestId: string;
}

export interface PlanApprovalResponse {
	type: "plan_approval_response";
	requestId: string;
	approved: boolean;
	feedback?: string;
}

// ============================================================================
// Plan validation
// ============================================================================

export interface PlanValidationResult {
	valid: boolean;
	missingSections: string[];
}

export const REQUIRED_PLAN_SECTIONS = [
	"Context",
	"context",
] as const;
