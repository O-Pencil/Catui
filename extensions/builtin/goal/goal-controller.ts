/**
 * [WHO]: GoalController class - per-thread runtime; serializes goal mutations via mutex; tracks per-turn accounting; emits idle continuation messages and budget-limit steering
 * [FROM]: Depends on ./goal-store, ./goal-types, ./goal-prompts, ./goal-format, core/extensions-host/types (ExtensionAPI)
 * [TO]: Consumed by ./index (lifecycle hooks) and ./goal-tools / ./goal-command (mutations)
 * [HERE]: extensions/builtin/goal/goal-controller.ts - thin per-thread state owner; pure logic, no I/O beyond the store
 */

import type { ExtensionAPI } from "../../../core/extensions-host/types.js";
import {
	isActiveStatus,
	isStoppedStatus,
	type GoalAccountingMode,
	type GoalControllerState,
	type GoalRunKind,
	type GoalTurnAccounting,
	type ThreadGoal,
	type ThreadGoalStatus,
	type UpdateGoalArgs,
} from "./goal-types.js";
import { GoalStore } from "./goal-store.js";
import { buildBudgetLimitPrompt, buildContinuationPrompt, buildObjectiveUpdatedPrompt } from "./goal-prompts.js";

const CONSECUTIVE_BLOCKED_THRESHOLD = 3;
const CONSECUTIVE_CONTINUATION_THRESHOLD = 5;

interface GoalDispatchOutcome {
	dispatched: boolean;
	reason:
		| "no_active_goal"
		| "not_active_status"
		| "plan_mode"
		| "already_dispatched"
		| "no_pending_messages"
		| "continuation_limit_reached"
		| "completed";
	goal?: ThreadGoal;
	consecutiveContinuations?: number;
}

export class GoalController {
	private readonly store: GoalStore;
	private readonly state: GoalControllerState = {
		currentTurn: null,
		consecutiveBlocked: 0,
		consecutiveIdleContinuations: 0,
		budgetLimitReportedGoalId: null,
		idleContinuationDispatched: false,
		pendingContinuationDispatch: false,
	};
	private mutex: Promise<void> = Promise.resolve();

	constructor(private readonly api: ExtensionAPI, private readonly threadId: string) {
		this.store = new GoalStore(api.agentDir, threadId);
	}

	get currentThreadId(): string {
		return this.threadId;
	}

	get goalStore(): GoalStore {
		return this.store;
	}

	get currentState(): GoalControllerState {
		return this.state;
	}

	/** Serialize every mutation through a single in-process mutex. */
	private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
		const release = this.mutex;
		let unlock: () => void = () => {};
		this.mutex = new Promise<void>((resolve) => {
			unlock = resolve;
		});
		try {
			await release;
			return await fn();
		} finally {
			unlock();
		}
	}

	/** Public API: read current persisted goal. */
	async get_goal(): Promise<ThreadGoal | null> {
		return this.withLock(() => this.store.get_goal());
	}

	/**
	 * Public API: set / replace / update the goal objective.
	 * Caller is responsible for showing the ConfirmIfExists dialog and re-dispatching
	 * with mode=ReplaceExisting if the user confirms.
	 */
	async set_objective(
		objective: string,
		mode: "ConfirmIfExists" | "ReplaceExisting" | "UpdateExisting",
		options: {
			status?: ThreadGoalStatus;
			tokenBudget?: number | null;
		} = {},
	): Promise<{ kind: "ok" | "confirm_required" | "blocked_existing"; goal: ThreadGoal | null; replaced: boolean }> {
		return this.withLock(() => {
			if (mode === "ConfirmIfExists") {
				const existing = this.store.get_goal();
				if (existing && existing.status !== "complete") {
					return { kind: "confirm_required" as const, goal: existing, replaced: false };
				}
			const created = this.store.replace_goal(objective, "active", options.tokenBudget ?? null);
				this.state.idleContinuationDispatched = false;
				this.state.pendingContinuationDispatch = false;
				this.state.consecutiveIdleContinuations = 0;
				return { kind: "ok" as const, goal: created, replaced: existing !== null };
			}
			if (mode === "ReplaceExisting") {
				const replaced = this.store.replace_goal(objective, "active", options.tokenBudget ?? null);
				this.state.idleContinuationDispatched = false;
				this.state.pendingContinuationDispatch = false;
				this.state.consecutiveIdleContinuations = 0;
				return { kind: "ok" as const, goal: replaced, replaced: true };
			}
			const next = this.store.update_goal({
				objective,
				status: options.status,
				tokenBudget: options.tokenBudget,
			});
			if (!next) {
				return { kind: "blocked_existing" as const, goal: null, replaced: false };
			}
			this.state.idleContinuationDispatched = false;
			this.state.pendingContinuationDispatch = false;
			this.state.consecutiveIdleContinuations = 0;
			return { kind: "ok" as const, goal: next, replaced: false };
		});
	}

	/** Public API: clear the goal entirely. */
	async clear(): Promise<boolean> {
		return this.withLock(() => {
			const ok = this.store.delete_goal();
			this.state.currentTurn = null;
			this.state.budgetLimitReportedGoalId = null;
			this.state.idleContinuationDispatched = false;
			this.state.pendingContinuationDispatch = false;
			this.state.consecutiveIdleContinuations = 0;
			return ok;
		});
	}

	/** Public API: pause / resume. */
	async set_status(status: ThreadGoalStatus): Promise<ThreadGoal | null> {
		return this.withLock(() => {
			const result = this.store.set_status(status);
			if (result && status === "active") {
				this.state.consecutiveIdleContinuations = 0;
				this.state.idleContinuationDispatched = false;
				this.state.pendingContinuationDispatch = false;
			}
			return result;
		});
	}

	/** Public API: insert a new goal only if the existing one is complete. */
	async insert_goal(objective: string, tokenBudget: number | null): Promise<ThreadGoal | null> {
		return this.withLock(() => {
			const created = this.store.insert_goal(objective, "active", tokenBudget);
			if (created) {
				this.state.idleContinuationDispatched = false;
				this.state.pendingContinuationDispatch = false;
				this.state.consecutiveIdleContinuations = 0;
				this.state.budgetLimitReportedGoalId = null;
			}
			return created;
		});
	}

	/** Public API: tool-driven update_goal. Only complete/blocked transitions. */
	async apply_update_goal(args: UpdateGoalArgs): Promise<ThreadGoal | null> {
		return this.withLock(() => {
			const mode: GoalAccountingMode = args.status === "complete" ? "ActiveOrComplete" : "ActiveOrStopped";
			const turn = this.state.currentTurn;
			if (turn) {
				const delta = Math.max(0, turn.tokensNow - turn.tokensLastAccounted);
				const timeDelta = Math.max(0, (Date.now() - turn.lastAccountedAt) / 1000);
				this.store.account_usage(timeDelta, delta, "ActiveOnly", turn.activeGoalId ?? undefined);
			}
			const next = this.store.update_goal({ status: args.status });
			if (next) {
				this.clearActiveTurn();
			}
			void mode;
			return next;
		});
	}

	/** Hook: turn_start. Marks the current turn as goal-active if goal is active.
	 *  Uses pendingContinuationDispatch to distinguish user-initiated turns from
	 *  continuation-triggered turns. User turns reset the consecutive continuation
	 *  counter; continuation turns increment it. */
	on_turn_start(turnId: string, runKind: GoalRunKind, totalTokensAtStart: number): void {
		// Distinguish user turns from continuation turns
		const isContinuationTurn = this.state.pendingContinuationDispatch;
		this.state.pendingContinuationDispatch = false;
		this.state.idleContinuationDispatched = false;
		if (isContinuationTurn) {
			// This turn was triggered by a goal continuation dispatch
			// (counter was already incremented at dispatch time in on_turn_end)
		} else {
			// User-initiated turn — reset consecutive continuation counter
			this.state.consecutiveIdleContinuations = 0;
		}
		const goal = this.store.get_goal();
		const isPlan = runKind === "plan";
		const isReview = runKind === "review";
		if (!goal || isPlan || isReview) {
			this.state.currentTurn = {
				turnId,
				activeGoalId: null,
				tokensAtStart: totalTokensAtStart,
				tokensNow: totalTokensAtStart,
				tokensLastAccounted: totalTokensAtStart,
				turnStartedAt: Date.now(),
				lastAccountedAt: Date.now(),
				runKind,
				budgetLimitReported: false,
			};
			return;
		}
		const isEligible = isActiveStatus(goal.status) || goal.status === "budget_limited";
		this.state.currentTurn = {
			turnId,
			activeGoalId: isEligible ? goal.goal_id : null,
			tokensAtStart: totalTokensAtStart,
			tokensNow: totalTokensAtStart,
			tokensLastAccounted: totalTokensAtStart,
			turnStartedAt: Date.now(),
			lastAccountedAt: Date.now(),
			runKind,
			budgetLimitReported: false,
		};
	}

	/** Hook: token usage updates from the agent loop (called on every message_end). */
	on_token_usage(totalTokens: number): { crossed: boolean; goal?: ThreadGoal } {
		const turn = this.state.currentTurn;
		if (!turn || !turn.activeGoalId) return { crossed: false };
		turn.tokensNow = totalTokens;
		const before = turn.tokensLastAccounted;
		const after = totalTokens;
		if (after > before) {
			const delta = after - before;
			const timeDelta = (Date.now() - turn.lastAccountedAt) / 1000;
			const outcome = this.store.account_usage(timeDelta, delta, "ActiveStatusOnly", turn.activeGoalId);
			if (outcome.kind === "Updated") {
				turn.tokensLastAccounted = after;
				turn.lastAccountedAt = Date.now();
				if (outcome.goal.status === "budget_limited" && !turn.budgetLimitReported) {
					if (this.state.budgetLimitReportedGoalId !== outcome.goal.goal_id) {
						turn.budgetLimitReported = true;
						this.state.budgetLimitReportedGoalId = outcome.goal.goal_id;
						return { crossed: true, goal: outcome.goal };
					}
				}
			}
		}
		return { crossed: false };
	}

	/** Hook: a tool finished. Accrue usage from internal turn state.
	 *  Skips the update_goal tool itself (it should not be counted toward goal progress). */
	on_tool_finish(toolName: string): { crossed: boolean; goal?: ThreadGoal } {
		if (toolName === "update_goal") return { crossed: false };
		const turn = this.state.currentTurn;
		if (!turn || !turn.activeGoalId) return { crossed: false };
		// Re-account using the tokens already recorded via on_token_usage (message_end)
		return this.on_token_usage(turn.tokensNow);
	}

	/**
	 * Hook: turn_end. Final accounting, clear active-turn state, then
	 * decide whether to inject an idle continuation prompt.
	 *
	 * Concurrency: `idleContinuationDispatched` is the sole guard against
	 * double-dispatch. It resets at `on_turn_start` and sets here, so each
	 * turn can dispatch at most once. agent-core guarantees one `turn_end`
	 * per turn, so no additional lock is needed.  Mirrors Codex's
	 * `continue_if_idle()` + `goal_state_lock` pattern.
	 */
	async on_turn_end(): Promise<GoalDispatchOutcome> {
		const turn = this.state.currentTurn;
		if (turn && turn.activeGoalId) {
			const delta = Math.max(0, turn.tokensNow - turn.tokensLastAccounted);
			const timeDelta = Math.max(0, (Date.now() - turn.lastAccountedAt) / 1000);
			this.store.account_usage(timeDelta, delta, "ActiveOnly", turn.activeGoalId);
		}
		const goal = this.store.get_goal();
		this.clearActiveTurn();

		if (!goal) {
			this.state.consecutiveIdleContinuations = 0;
			return { dispatched: false, reason: "no_active_goal" };
		}
		if (!isActiveStatus(goal.status)) {
			if (isStoppedStatus(goal.status)) {
				this.state.consecutiveBlocked = 0;
			}
			this.state.consecutiveIdleContinuations = 0;
			return { dispatched: false, reason: "not_active_status", goal };
		}
		// Active goal on successful turn — reset blocked counter
		this.state.consecutiveBlocked = 0;
		if (this.state.idleContinuationDispatched) {
			return { dispatched: false, reason: "already_dispatched", goal };
		}

		// Guard: too many consecutive idle continuations → pause goal to break the loop
		if (this.state.consecutiveIdleContinuations >= CONSECUTIVE_CONTINUATION_THRESHOLD) {
			this.store.set_status("paused");
			const count = this.state.consecutiveIdleContinuations;
			this.state.consecutiveIdleContinuations = 0;
			this.state.pendingContinuationDispatch = false;
			return { dispatched: false, reason: "continuation_limit_reached", goal, consecutiveContinuations: count };
		}

		const prompt = buildContinuationPrompt(goal);
		try {
			this.state.pendingContinuationDispatch = true;
			this.api.sendUserMessage(prompt, { deliverAs: "followUp" });
			this.state.idleContinuationDispatched = true;
			this.state.consecutiveIdleContinuations += 1;
			return { dispatched: true, reason: "completed", goal };
		} catch {
			// Dispatch failed — keep flag false so next attempt can retry
			this.state.pendingContinuationDispatch = false;
			return { dispatched: false, reason: "no_pending_messages", goal };
		}
	}

	/** Hook: turn aborted (different from error). Final accounting. */
	async on_turn_abort(): Promise<void> {
		const turn = this.state.currentTurn;
		if (turn && turn.activeGoalId) {
			const delta = Math.max(0, turn.tokensNow - turn.tokensLastAccounted);
			const timeDelta = Math.max(0, (Date.now() - turn.lastAccountedAt) / 1000);
			this.store.account_usage(timeDelta, delta, "ActiveOnly", turn.activeGoalId);
		}
		this.clearActiveTurn();
	}

	/** Hook: usage limit hit. Mark current active goal usage_limited. */
	on_usage_limit(): ThreadGoal | null {
		return this.store.usage_limit_active();
	}

	/** Hook: turn error. Mark current active goal blocked. */
	on_turn_error(): ThreadGoal | null {
		const turn = this.state.currentTurn;
		if (!turn || !turn.activeGoalId) {
			return this.store.stop_active_as_blocked();
		}
		const outcome = this.store.stop_active_as_blocked();
		this.clearActiveTurn();
		return outcome;
	}

	/**
	 * Read consecutive-blocked counter; called by tools / commands that need to
	 * decide whether to escalate a single-turn block into a stored "blocked" state.
	 */
	record_blocked_signal(): { escalated: boolean; consecutiveBlocked: number } {
		this.state.consecutiveBlocked += 1;
		const escalated = this.state.consecutiveBlocked >= CONSECUTIVE_BLOCKED_THRESHOLD;
		if (escalated) {
			this.store.stop_active_as_blocked();
		}
		return { escalated, consecutiveBlocked: this.state.consecutiveBlocked };
	}

	/** Reset consecutive-blocked counter (called from successful turn_end). */
	reset_blocked_signal(): void {
		this.state.consecutiveBlocked = 0;
	}

	/** Inject budget-limit steering into the active prompt if not already surfaced. */
	maybe_build_budget_limit_steering(): string | null {
		const goal = this.store.get_goal();
		if (!goal) return null;
		if (goal.status !== "budget_limited") return null;
		if (this.state.budgetLimitReportedGoalId === goal.goal_id) return null;
		this.state.budgetLimitReportedGoalId = goal.goal_id;
		return buildBudgetLimitPrompt(goal);
	}

	/** Build and inject objective_updated steering after a /goal edit.
	 *  Sends the prompt as a follow-up user message so the LLM re-derives
	 *  requirements against the updated objective. */
	inject_objective_updated_steering(): boolean {
		const goal = this.store.get_goal();
		if (!goal) return false;
		const prompt = buildObjectiveUpdatedPrompt(goal);
		try {
			this.state.pendingContinuationDispatch = true;
			this.api.sendUserMessage(prompt, { deliverAs: "followUp" });
			this.state.idleContinuationDispatched = true;
			return true;
		} catch {
			this.state.pendingContinuationDispatch = false;
			return false;
		}
	}

	/** Kick off agent work immediately after /goal set.
	 *  Sends a continuation prompt so the agent starts pursuing the goal
	 *  without waiting for the user to send a follow-up message. */
	kickOffContinuation(): boolean {
		const goal = this.store.get_goal();
		if (!goal || !isActiveStatus(goal.status)) return false;
		if (this.state.idleContinuationDispatched) return false;
		const prompt = buildContinuationPrompt(goal);
		try {
			this.state.pendingContinuationDispatch = true;
			this.api.sendUserMessage(prompt, { deliverAs: "followUp" });
			this.state.idleContinuationDispatched = true;
			return true;
		} catch {
			this.state.pendingContinuationDispatch = false;
			return false;
		}
	}

	/** Build objective_updated prompt string (for external injection or display). */
	build_objective_updated_steering(): string | null {
		const goal = this.store.get_goal();
		if (!goal) return null;
		return buildObjectiveUpdatedPrompt(goal);
	}

	private clearActiveTurn(): void {
		this.state.currentTurn = null;
	}

	/** Send a persistent goal feedback message to the TUI chat stream. */
	sendGoalFeedback(content: string, details?: Record<string, unknown>): void {
		try {
			this.api.sendMessage({
				customType: "goal",
				content,
				display: true,
				details,
			});
		} catch {
			// Non-critical; UI feedback should not break the flow
		}
	}

	/** Used by session_start to reset the idempotency flag. */
	resetIdleContinuationFlag(): void {
		this.state.idleContinuationDispatched = false;
		this.state.pendingContinuationDispatch = false;
	}

	/** Snapshot the bookkeeping turn for testing / display. */
	currentTurnSnapshot(): GoalTurnAccounting | null {
		return this.state.currentTurn;
	}
}
