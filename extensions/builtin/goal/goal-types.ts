/**
 * [WHO]: Goal extension type surface — ThreadGoalStatus, ThreadGoal, GoalSetMode, GoalAccountingMode, helper predicates, and runtime handle contracts
 * [FROM]: Depends on @pencil-agent/agent-core (AgentMessage) and the local store contract in ./goal-store
 * [TO]: Consumed by ./goal-store, ./goal-controller, ./goal-tools, ./goal-command, ./goal-format, ./goal-prompts, ./index
 * [HERE]: extensions/builtin/goal/goal-types.ts - single source of truth for the goal data model and per-thread runtime state shape
 */

/**
 * Lifecycle status of a per-thread goal.
 */
export type ThreadGoalStatus =
	| "active"
	| "paused"
	| "blocked"
	| "usage_limited"
	| "budget_limited"
	| "complete";

export const GOAL_STATUSES = [
	"active",
	"paused",
	"blocked",
	"usage_limited",
	"budget_limited",
	"complete",
] as const;

export type GoalSetMode = "ConfirmIfExists" | "ReplaceExisting" | "UpdateExisting";

/**
 * Accounting mode controls which status rows may be updated during usage accrual.
 */
export type GoalAccountingMode =
	| "ActiveStatusOnly"
	| "ActiveOnly"
	| "ActiveOrComplete"
	| "ActiveOrStopped";

/** A persisted thread goal. Mirrors codex-rs ThreadGoal. */
export interface ThreadGoal {
	thread_id: string;
	goal_id: string;
	objective: string;
	status: ThreadGoalStatus;
	token_budget: number | null;
	tokens_used: number;
	time_used_seconds: number;
	created_at: number;
	updated_at: number;
}

export interface PersistedThreadGoal extends ThreadGoal {
	version: 1;
}

export type GoalSetOutcome =
	| { kind: "ok"; goal: ThreadGoal; replaced: boolean }
	| { kind: "confirm_required"; goal: ThreadGoal; candidate: string }
	| { kind: "blocked_existing"; goal: ThreadGoal };

export type GoalAccountingOutcome =
	| { kind: "Updated"; goal: ThreadGoal }
	| { kind: "Unchanged"; goal: ThreadGoal | null };

export function isActiveStatus(status: ThreadGoalStatus): boolean {
	return status === "active";
}

export function isTerminalStatus(status: ThreadGoalStatus): boolean {
	return status === "budget_limited" || status === "complete";
}

export function isStoppedStatus(status: ThreadGoalStatus): boolean {
	return status === "paused" || status === "blocked" || status === "usage_limited";
}

export type GoalRunKind = "normal" | "plan" | "review";

export interface GoalTurnAccounting {
	turnId: string;
	activeGoalId: string | null;
	tokensAtStart: number;
	tokensNow: number;
	tokensLastAccounted: number;
	turnStartedAt: number;
	lastAccountedAt: number;
	runKind: GoalRunKind;
	budgetLimitReported: boolean;
}

export interface GoalControllerState {
	currentTurn: GoalTurnAccounting | null;
	consecutiveBlocked: number;
	consecutiveIdleContinuations: number;
	budgetLimitReportedGoalId: string | null;
	idleContinuationDispatched: boolean;
	pendingContinuationDispatch: boolean;
}

export interface CreateGoalArgs {
	objective: string;
	token_budget?: number | null;
}

export interface UpdateGoalArgs {
	status: Extract<ThreadGoalStatus, "complete" | "blocked">;
}

export interface GoalMenuChoice {
	id: "open_editor" | "pause" | "resume" | "clear" | "show_status";
	label: string;
}

export const MAX_THREAD_GOAL_OBJECTIVE_CHARS = 4_000;
export const MIN_TOKEN_BUDGET = 1;
export const GOAL_STORE_VERSION = 1 as const;
