/**
 * [WHO]: GoalController class - per-thread runtime; serializes goal mutations via mutex; tracks per-turn accounting (on_turn_end); dispatches pull-model continuations at the agent idle point (maybe_dispatch_continuation) and budget-limit steering
 * [FROM]: Depends on ./goal-store, ./goal-types, ./goal-prompts, ./goal-format, core/extensions-host/types (ExtensionAPI)
 * [TO]: Consumed by ./index (lifecycle hooks) and ./goal-tools / ./goal-command (mutations)
 * [HERE]: extensions/builtin/goal/goal-controller.ts - per-thread state, exclusive continuation ownership, scoped cancellation and run-level limits
 */

import type { ContinuationLease, ExtensionAPI } from "../../../core/extensions-host/types.js";
import {
	isActiveStatus,
	type GoalControllerState,
	type GoalRunKind,
	type GoalTurnAccounting,
	type ThreadGoal,
	type ThreadGoalStatus,
	type UpdateGoalArgs,
} from "./goal-types.js";
import { GoalStore } from "./goal-store.js";
import { buildBudgetLimitPrompt, buildCompletionAuditPrompt, buildContinuationPrompt, buildObjectiveUpdatedPrompt } from "./goal-prompts.js";

const CONSECUTIVE_CONTINUATION_THRESHOLD = 10;
const MAX_TOTAL_CONTINUATION_TURNS = 30;

interface GoalDispatchOutcome {
	dispatched: boolean;
	reason:
		| "no_active_goal"
		| "not_active_status"
		| "plan_mode"
		| "already_dispatched"
		| "no_pending_messages"
		| "pending_messages"
		| "continuation_limit_reached"
		| "total_continuation_limit_reached"
		| "completed";
	goal?: ThreadGoal;
	consecutiveContinuations?: number;
}

/** Outcome of per-turn accounting at turn_end. Dispatch decisions live in
 *  maybe_dispatch_continuation (called when the agent run actually ends). */
interface GoalTurnEndOutcome {
	reason: "no_active_goal" | "not_active_status" | "active";
	goal?: ThreadGoal;
}

export class GoalController {
	private readonly store: GoalStore;
	private readonly state: GoalControllerState = {
		currentTurn: null,
		consecutiveIdleContinuations: 0,
		budgetLimitReportedGoalId: null,
		idleContinuationDispatched: false,
		pendingContinuationDispatch: false,
	};
	private mutex: Promise<void> = Promise.resolve();
	/** Monotonic counter of all continuation dispatches for the current goal.
	 *  Resets on explicit resume or goal edits, never on ordinary user turns. */
	private totalContinuationTurns = 0;
	/** Set when the goal transitions to a terminal status during the current turn.
	 *  Prevents on_turn_end from dispatching a continuation for a just-completed goal. */
	private goalJustTransitionedToTerminal = false;
	/** stopReason of the most recent agent run (from agent_result).
	 *  Consulted at agent_end before dispatching a continuation. */
	private lastRunStopReason: string | null = null;
	private lease: ContinuationLease | undefined;
	private suspended = false;
	private readonly queuedPrompts = new Set<string>();
	private dispatchId = 0;
	private requested = false;

	/** Only explicit activation may take continuation ownership from another driver. */
	activateContinuation(): void {
		this.suspended = false;
		if (!this.lease?.isCurrent()) this.lease = this.api.claimContinuation?.(() => this.suspendContinuation());
	}

	suspendContinuation(): void {
		this.suspended = true;
		this.requested = false;
		this.cancelContinuation();
		if (this.store.get_goal()?.status === "active") this.store.set_status("paused");
	}

	cancelContinuation(): void {
		const prompts = new Set(this.queuedPrompts);
		this.queuedPrompts.clear();
		this.api.clearFollowUpQueue?.(text => prompts.has(text));
		this.state.pendingContinuationDispatch = false;
		this.state.idleContinuationDispatched = false;
		this.lease?.release();
		this.lease = undefined;
	}

	acceptPrompt(text: string): boolean {
		return this.queuedPrompts.has(text) && !this.suspended && this.store.get_goal()?.status === "active";
	}

	on_run_start(): void {
		if (!this.state.pendingContinuationDispatch) this.state.consecutiveIdleContinuations = 0;
		this.state.pendingContinuationDispatch = false;
		this.state.idleContinuationDispatched = false;
		this.lastRunStopReason = null;
	}

	private dispatch(prompt: string): void {
		const goal = this.store.get_goal()!;
		const tagged = `[GOAL:${goal.goal_id}:${++this.dispatchId}]\n${prompt}`;
		this.queuedPrompts.add(tagged);
		this.api.sendUserMessage(tagged, { deliverAs: "followUp" });
	}

	constructor(private readonly api: ExtensionAPI, private readonly threadId: string) {
		this.store = new GoalStore(api.agentDir, threadId);
	}

	get goalStore(): GoalStore {
		return this.store;
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
				this.cancelContinuation();
				this.activateContinuation();
				this.state.idleContinuationDispatched = false;
				this.state.pendingContinuationDispatch = false;
				this.state.consecutiveIdleContinuations = 0;
				this.totalContinuationTurns = 0;
				return { kind: "ok" as const, goal: created, replaced: existing !== null };
			}
			if (mode === "ReplaceExisting") {
				const replaced = this.store.replace_goal(objective, "active", options.tokenBudget ?? null);
				this.cancelContinuation();
				this.activateContinuation();
				this.state.idleContinuationDispatched = false;
				this.state.pendingContinuationDispatch = false;
				this.state.consecutiveIdleContinuations = 0;
				this.totalContinuationTurns = 0;
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
			this.cancelContinuation();
			if (isActiveStatus(next.status)) this.activateContinuation();
			this.state.idleContinuationDispatched = false;
			this.state.pendingContinuationDispatch = false;
			this.state.consecutiveIdleContinuations = 0;
			this.totalContinuationTurns = 0;
			return { kind: "ok" as const, goal: next, replaced: false };
		});
	}

	/** Public API: clear the goal entirely. */
	async clear(): Promise<boolean> {
		return this.withLock(() => {
			const ok = this.store.delete_goal();
			this.cancelContinuation();
			this.requested = false;
			this.state.currentTurn = null;
			this.state.budgetLimitReportedGoalId = null;
			this.state.idleContinuationDispatched = false;
			this.state.pendingContinuationDispatch = false;
			this.state.consecutiveIdleContinuations = 0;
			this.totalContinuationTurns = 0;
			return ok;
		});
	}

	/** Public API: pause / resume. */
	async set_status(status: ThreadGoalStatus): Promise<ThreadGoal | null> {
		return this.withLock(() => {
			const existing = this.store.get_goal();
			if (status === "active" && existing?.status === "active" &&
				(this.state.idleContinuationDispatched || this.requested || (this.api.isIdle && !this.api.isIdle()))) return existing;
			const result = this.store.set_status(status);
			if (result && status === "active") {
				this.totalContinuationTurns = 0;
				this.activateContinuation();
				this.state.consecutiveIdleContinuations = 0;
				this.state.idleContinuationDispatched = false;
				this.state.pendingContinuationDispatch = false;
			}
			if (result && status !== "active") { this.requested = false; this.cancelContinuation(); }
			return result;
		});
	}

	/** Public API: insert a new goal only if the existing one is complete. */
	async insert_goal(objective: string, tokenBudget: number | null): Promise<ThreadGoal | null> {
		return this.withLock(() => {
			const created = this.store.insert_goal(objective, "active", tokenBudget);
			if (created) {
				this.activateContinuation();
				this.state.idleContinuationDispatched = false;
				this.state.pendingContinuationDispatch = false;
				this.state.consecutiveIdleContinuations = 0;
				this.state.budgetLimitReportedGoalId = null;
				this.totalContinuationTurns = 0;
			}
			return created;
		});
	}

	/** Public API: tool-driven UpdateGoal. Only complete/blocked transitions. */
	async apply_update_goal(args: UpdateGoalArgs): Promise<ThreadGoal | null> {
		return this.withLock(() => {
			const turn = this.state.currentTurn;
			if (turn) {
				const delta = Math.max(0, turn.tokensNow - turn.tokensLastAccounted);
				const timeDelta = Math.max(0, (Date.now() - turn.lastAccountedAt) / 1000);
				this.store.account_usage(timeDelta, delta, "ActiveOnly", turn.activeGoalId ?? undefined);
			}
			const next = this.store.update_goal({ status: args.status });
			if (next) {
				this.requested = false;
				this.cancelContinuation();
				this.goalJustTransitionedToTerminal = true;
				this.clearActiveTurn();
			}
			return next;
		});
	}

	/** Hook: turn_start. Marks the current turn as goal-active if goal is active.
	 *  Uses pendingContinuationDispatch to distinguish user-initiated turns from
	 *  continuation-triggered turns. User turns reset the consecutive continuation
	 *  counter; continuation turns increment it. */
	on_turn_start(turnId: string, runKind: GoalRunKind, totalTokensAtStart: number): void {
		// Distinguish user turns from continuation turns
		this.state.idleContinuationDispatched = false;
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
						return { crossed: true, goal: outcome.goal };
					}
				}
			}
		}
		return { crossed: false };
	}

	/** Hook: a tool finished. Accrue usage from internal turn state.
	 *  Skips the UpdateGoal tool itself (it should not be counted toward goal progress). */
	on_tool_finish(toolName: string): { crossed: boolean; goal?: ThreadGoal } {
		if (toolName === "UpdateGoal") return { crossed: false };
		const turn = this.state.currentTurn;
		if (!turn || !turn.activeGoalId) return { crossed: false };
		// Re-account using the tokens already recorded via on_token_usage (message_end)
		return this.on_token_usage(turn.tokensNow);
	}

	/**
	 * Hook: turn_end. Final accounting and active-turn cleanup only.
	 *
	 * agent-core fires turn_end per assistant cycle — a single prompt loop can
	 * end many turns before the agent is actually idle. Continuation dispatch
	 * therefore lives in maybe_dispatch_continuation(), called at agent_end
	 * (the true idle point, mirroring Codex's continue_if_idle()).
	 */
	async on_turn_end(): Promise<GoalTurnEndOutcome> {
		const turn = this.state.currentTurn;
		if (turn && turn.activeGoalId) {
			const delta = Math.max(0, turn.tokensNow - turn.tokensLastAccounted);
			const timeDelta = Math.max(0, (Date.now() - turn.lastAccountedAt) / 1000);
			this.store.account_usage(timeDelta, delta, "ActiveOnly", turn.activeGoalId);
		}
		const goal = this.store.get_goal();
		this.clearActiveTurn();

		// If the goal just transitioned to terminal (complete/blocked) during this
		// turn via the UpdateGoal tool, surface it as not_active_status so the
		// extension can clear stale followUps and report the terminal state.
		if (this.goalJustTransitionedToTerminal) {
			this.goalJustTransitionedToTerminal = false;
			this.state.consecutiveIdleContinuations = 0;
			return { reason: "not_active_status", goal: goal ?? undefined };
		}

		if (!goal) {
			this.state.consecutiveIdleContinuations = 0;
			return { reason: "no_active_goal" };
		}
		if (!isActiveStatus(goal.status)) {
			this.state.consecutiveIdleContinuations = 0;
			return { reason: "not_active_status", goal };
		}
		return { reason: "active", goal };
	}

	/**
	 * Pull-model continuation: called when the agent run truly ends (agent_end,
	 * after retry/compaction settle and the agent is idle). Reads goal state and
	 * decides whether to start a new continuation turn — the equivalent of
	 * Codex's continue_if_idle(): non-Active state means no new turn, cleanly.
	 *
	 * `idleContinuationDispatched` guards double-dispatch within one idle window;
	 * it resets at the next on_turn_start.
	 */
	maybe_dispatch_continuation(options: { hasPendingMessages: boolean }): GoalDispatchOutcome {
		const goal = this.store.get_goal();
		if (!goal) {
			return { dispatched: false, reason: "no_active_goal" };
		}
		if (!isActiveStatus(goal.status)) {
			return { dispatched: false, reason: "not_active_status", goal };
		}
		if (this.suspended || (this.lease && !this.lease.isCurrent()) || (this.api.isIdle && !this.api.isIdle())) {
			return { dispatched: false, reason: "pending_messages", goal };
		}
		if (this.state.idleContinuationDispatched) {
			return { dispatched: false, reason: "already_dispatched", goal };
		}
		// Something else is already queued (e.g. a user followUp typed during the
		// run) — let it drive the next turn; its turn_end/agent_end will re-check.
		if (options.hasPendingMessages) {
			return { dispatched: false, reason: "pending_messages", goal };
		}

		// Guard: too many consecutive idle continuations → stop dispatching.
		// Goal stays active — user can manually continue or the agent can still complete it.
		if (this.state.consecutiveIdleContinuations >= CONSECUTIVE_CONTINUATION_THRESHOLD) {
			const count = this.state.consecutiveIdleContinuations;
			this.state.pendingContinuationDispatch = false;
			return { dispatched: false, reason: "continuation_limit_reached", goal, consecutiveContinuations: count };
		}

		// Hard cap: total continuation turns across the goal's lifetime.
		// Prevents the agent from running indefinitely when it keeps finding work.
		if (this.totalContinuationTurns >= MAX_TOTAL_CONTINUATION_TURNS) {
			this.state.pendingContinuationDispatch = false;
			const paused = this.store.set_status("paused");
			return { dispatched: false, reason: "total_continuation_limit_reached", goal: paused ?? goal, consecutiveContinuations: this.totalContinuationTurns };
		}

		// Every 3rd continuation: inject a focused completion audit instead of the
		// full continuation prompt. Short messages are harder to ignore.
		const isAuditTurn = this.totalContinuationTurns > 0 && this.totalContinuationTurns % 3 === 0;
		const prompt = isAuditTurn ? buildCompletionAuditPrompt(goal) : buildContinuationPrompt(goal);
		try {
			this.state.pendingContinuationDispatch = true;
			// The agent is idle here, so sendUserMessage starts a fresh turn
			// directly instead of sitting in the followUp queue.
			this.dispatch(prompt);
			this.requested = false;
			this.state.idleContinuationDispatched = true;
			this.state.consecutiveIdleContinuations += 1;
			this.totalContinuationTurns += 1;
			return { dispatched: true, reason: "completed", goal };
		} catch {
			// Dispatch failed — keep flag false so next attempt can retry
			this.state.pendingContinuationDispatch = false;
			return { dispatched: false, reason: "no_pending_messages", goal };
		}
	}

	/** Hook: agent_result. Records the run's stopReason for the agent_end decision. */
	note_run_stop_reason(stopReason: string | undefined): void {
		this.lastRunStopReason = stopReason ?? null;
	}

	/** stopReason recorded from the most recent agent_result, if any. */
	get runStopReason(): string | null {
		return this.lastRunStopReason;
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
		if (!goal || !isActiveStatus(goal.status) || this.suspended) return false;
		const prompt = buildObjectiveUpdatedPrompt(goal);
		try {
			if (this.api.isIdle && !this.api.isIdle()) { this.requested = true; return false; }
			this.state.pendingContinuationDispatch = true;
			this.dispatch(prompt);
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
		if (this.suspended) return false;
		if (this.api.isIdle && !this.api.isIdle()) { this.requested = true; return false; }
		if (this.state.idleContinuationDispatched) return false;
		if (this.totalContinuationTurns >= MAX_TOTAL_CONTINUATION_TURNS) return false;
		const prompt = buildContinuationPrompt(goal);
		try {
			this.state.pendingContinuationDispatch = true;
			this.dispatch(prompt);
			this.requested = false;
			this.state.idleContinuationDispatched = true;
			this.state.consecutiveIdleContinuations += 1;
			this.totalContinuationTurns += 1;
			return true;
		} catch {
			this.state.pendingContinuationDispatch = false;
			return false;
		}
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
			}, { triggerTurn: false });
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
