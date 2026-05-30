/**
 * [WHO]: CronTask, CronTaskCreateParams - cron task type definitions
 * [FROM]: No external dependencies
 * [TO]: Consumed by cron-tasks.ts, cron-scheduler.ts, cron tools, loop extension
 * [HERE]: extensions/builtin/loop/cron/cron-types.ts - unified cron task data structures matching the refactoring plan
 */

/**
 * Cron task stored in memory or on disk.
 * Extended from the plan to support enhanced features (--name, --max, --quiet, pause/resume).
 */
export interface CronTask {
	/** 8-char short ID from randomUUID().slice(0, 8) */
	id: string;
	/** 5-field cron expression (e.g., minute-every-5 format) */
	cron: string;
	/** Prompt to re-enqueue when task fires */
	prompt: string;
	/** Creation timestamp, used for first fire and expiry calculation */
	createdAt: number;
	/** Last fire timestamp for durable recurring tasks */
	lastFiredAt?: number;
	/** Whether the task repeats after each fire */
	recurring?: boolean;
	/** System built-in tasks can be permanent (never expire) */
	permanent?: boolean;
	/** Runtime-only: false means session-only, true means durable on disk */
	durable?: boolean;
	/** For teammate routing: deliver to specific teammate when fired */
	agentId?: string;

	// === Enhanced fields (beyond plan) ===
	/** Friendly name for the task (parsed from --name flag) */
	name?: string;
	/** Auto-cancel after N runs */
	maxRuns?: number;
	/** Suppress per-tick UI messages */
	quiet?: boolean;
	/** Whether the task is paused */
	paused?: boolean;
	/** Whether the task is pending dispatch (runtime-only) */
	pending?: boolean;
	/** Last error message from execution */
	lastError?: string;
	/** Snippet of last assistant output */
	lastOutputSnippet?: string;
	/** Number of times the task has been executed */
	runCount?: number;
}

/**
 * Parameters for creating a new cron task.
 */
export interface CronTaskCreateParams {
	cron: string;
	prompt: string;
	recurring?: boolean;
	durable?: boolean;
	agentId?: string;
	name?: string;
	maxRuns?: number;
	quiet?: boolean;
}

/**
 * Parsed cron expression fields.
 */
export interface ParsedCron {
	minute: Set<number>;
	hour: Set<number>;
	dayOfMonth: Set<number>;
	month: Set<number>;
	dayOfWeek: Set<number>;
}

/**
 * Result of creating a cron task.
 */
export interface CronTaskCreateResult {
	id: string;
	recurring: boolean;
	durable: boolean;
	/** Human-readable schedule description */
	humanSchedule: string;
}

/**
 * Maximum number of cron tasks allowed.
 */
export const MAX_CRON_TASKS = 50;

/**
 * Default max age for recurring tasks (7 days).
 */
export const DEFAULT_RECURRING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
