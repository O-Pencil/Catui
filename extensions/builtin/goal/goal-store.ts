/**
 * [WHO]: GoalStore class - atomic JSON-file persistence layer for per-thread goals; CRUD primitives (get/replace/insert/update/delete) and account_usage; no concurrency control beyond filesystem atomic rename
 * [FROM]: Depends on node:fs, node:path, node:crypto, ./goal-types
 * [TO]: Consumed by ./goal-controller and any code that needs to mutate or observe persisted goal state
 * [HERE]: extensions/builtin/goal/goal-store.ts - durable per-thread storage under <agentDir>/goals/<threadId>.json
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
	GOAL_STORE_VERSION,
	type GoalAccountingMode,
	type GoalAccountingOutcome,
	type PersistedThreadGoal,
	type ThreadGoal,
	type ThreadGoalStatus,
} from "./goal-types.js";

const GOAL_ROOT_DIRNAME = "goals";

function statusFilterForMode(mode: GoalAccountingMode): readonly ThreadGoalStatus[] {
	switch (mode) {
		case "ActiveStatusOnly":
			return ["active"];
		case "ActiveOnly":
			return ["active", "budget_limited"];
		case "ActiveOrComplete":
			return ["active", "budget_limited", "complete"];
		case "ActiveOrStopped":
			return ["active", "paused", "blocked", "usage_limited", "budget_limited"];
	}
}

function statusAfterBudgetLimit(
	status: ThreadGoalStatus,
	tokensUsed: number,
	tokenBudget: number | null,
): ThreadGoalStatus {
	if (status === "active" && tokenBudget !== null && tokensUsed >= tokenBudget) {
		return "budget_limited";
	}
	return status;
}

function atomicWriteJson(path: string, value: unknown): void {
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
	renameSync(tmp, path);
}

function readJson(path: string): unknown {
	const raw = readFileSync(path, "utf-8");
	return JSON.parse(raw);
}

function isThreadGoal(value: unknown): value is ThreadGoal {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.thread_id === "string" &&
		typeof v.goal_id === "string" &&
		typeof v.objective === "string" &&
		typeof v.status === "string" &&
		typeof v.tokens_used === "number" &&
		typeof v.time_used_seconds === "number" &&
		typeof v.created_at === "number" &&
		typeof v.updated_at === "number" &&
		(v.token_budget === null || typeof v.token_budget === "number")
	);
}

function isPersisted(value: unknown): value is PersistedThreadGoal {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (v.version !== GOAL_STORE_VERSION) return false;
	return isThreadGoal(v);
}

export class GoalStore {
	readonly filePath: string;

	constructor(private readonly agentDir: string, private readonly threadId: string) {
		const root = join(agentDir, GOAL_ROOT_DIRNAME);
		this.filePath = join(root, `${threadId}.json`);
	}

	get_goal(): ThreadGoal | null {
		if (!existsSync(this.filePath)) return null;
		try {
			const parsed = readJson(this.filePath);
			if (!isPersisted(parsed)) return null;
			const { version: _version, ...rest } = parsed;
			void _version;
			return rest;
		} catch {
			return null;
		}
	}

	replace_goal(
		objective: string,
		status: ThreadGoalStatus,
		tokenBudget: number | null,
	): ThreadGoal {
		const now = Date.now();
		const goalId = randomUUID();
		const nextStatus = statusAfterBudgetLimit(status, 0, tokenBudget);
		const record: PersistedThreadGoal = {
			version: GOAL_STORE_VERSION,
			thread_id: this.threadId,
			goal_id: goalId,
			objective,
			status: nextStatus,
			token_budget: tokenBudget,
			tokens_used: 0,
			time_used_seconds: 0,
			created_at: now,
			updated_at: now,
		};
		atomicWriteJson(this.filePath, record);
		return toThreadGoal(record);
	}

	insert_goal(
		objective: string,
		status: ThreadGoalStatus,
		tokenBudget: number | null,
	): ThreadGoal | null {
		const existing = this.get_goal();
		if (existing && existing.status !== "complete") {
			return null;
		}
		return this.replace_goal(objective, status, tokenBudget);
	}

	update_goal(update: {
		objective?: string;
		status?: ThreadGoalStatus;
		tokenBudget?: number | null | undefined;
		expectedGoalId?: string | null;
	}): ThreadGoal | null {
		const current = this.get_goal();
		if (!current) return null;
		if (update.expectedGoalId && current.goal_id !== update.expectedGoalId) {
			return current;
		}

		const nextObjective = update.objective ?? current.objective;
		const nextBudget =
			update.tokenBudget === undefined ? current.token_budget : update.tokenBudget;

		let nextStatus = update.status ?? current.status;
		if (
			current.status === "budget_limited" &&
			(nextStatus === "paused" || nextStatus === "blocked")
		) {
			nextStatus = current.status;
		}
		nextStatus = statusAfterBudgetLimit(nextStatus, current.tokens_used, nextBudget);

		const now = Date.now();
		const record: PersistedThreadGoal = {
			version: GOAL_STORE_VERSION,
			thread_id: current.thread_id,
			goal_id: current.goal_id,
			objective: nextObjective,
			status: nextStatus,
			token_budget: nextBudget,
			tokens_used: current.tokens_used,
			time_used_seconds: current.time_used_seconds,
			created_at: current.created_at,
			updated_at: now,
		};
		atomicWriteJson(this.filePath, record);
		return toThreadGoal(record);
	}

	delete_goal(): boolean {
		if (!existsSync(this.filePath)) return false;
		try {
			unlinkSync(this.filePath);
			return true;
		} catch {
			return false;
		}
	}

	account_usage(
		timeDeltaSeconds: number,
		tokenDelta: number,
		mode: GoalAccountingMode,
		expectedGoalId?: string,
	): GoalAccountingOutcome {
		if (timeDeltaSeconds === 0 && tokenDelta === 0) {
			return { kind: "Unchanged", goal: this.get_goal() };
		}
		const current = this.get_goal();
		if (!current) return { kind: "Unchanged", goal: null };
		if (expectedGoalId && current.goal_id !== expectedGoalId) {
			return { kind: "Unchanged", goal: current };
		}
		const allowed = statusFilterForMode(mode);
		if (!allowed.includes(current.status)) {
			return { kind: "Unchanged", goal: current };
		}
		const tokensUsed = Math.max(0, current.tokens_used + Math.max(0, tokenDelta));
		const timeUsed = Math.max(0, current.time_used_seconds + Math.max(0, timeDeltaSeconds));
		const nextStatus = statusAfterBudgetLimit(current.status, tokensUsed, current.token_budget);
		const record: PersistedThreadGoal = {
			version: GOAL_STORE_VERSION,
			thread_id: current.thread_id,
			goal_id: current.goal_id,
			objective: current.objective,
			status: nextStatus,
			token_budget: current.token_budget,
			tokens_used: tokensUsed,
			time_used_seconds: timeUsed,
			created_at: current.created_at,
			updated_at: Date.now(),
		};
		atomicWriteJson(this.filePath, record);
		return { kind: "Updated", goal: toThreadGoal(record) };
	}

	set_status(status: ThreadGoalStatus, expectedGoalId?: string): ThreadGoal | null {
		return this.update_goal({ status, expectedGoalId: expectedGoalId ?? null });
	}

	stop_active_as_blocked(): ThreadGoal | null {
		const current = this.get_goal();
		if (!current) return null;
		// Only an active goal can be stopped as blocked (mirrors Codex's
		// stop_active_thread_goal); paused/complete/budget_limited stay as-is.
		if (current.status !== "active") return current;
		return this.update_goal({ status: "blocked" });
	}
}

function toThreadGoal(record: PersistedThreadGoal): ThreadGoal {
	const { version: _v, ...rest } = record;
	void _v;
	return rest;
}

export function createGoalStore(agentDir: string, threadId: string): GoalStore {
	return new GoalStore(agentDir, threadId);
}
