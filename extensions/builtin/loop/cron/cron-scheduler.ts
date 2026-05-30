/**
 * [WHO]: createCronScheduler - independent cron task scheduler
 * [FROM]: Depends on proper-lockfile, ./cron-types, ./cron-parser, ./cron-tasks
 * [TO]: Consumed by loop extension index.ts, REPL integration
 * [HERE]: extensions/builtin/loop/cron/cron-scheduler.ts - non-React scheduler core matching the refactoring plan
 */

import lockfile from "proper-lockfile";
import { jitteredNextCronRunMs, oneShotJitteredNextCronRunMs, nextCronRunMs } from "./cron-parser.js";
import { readCronTasks, writeCronTasks, getSessionCronTasks, updateSessionCronTask, markCronTasksFired } from "./cron-tasks.js";
import type { CronTask } from "./cron-types.js";
import { DEFAULT_RECURRING_MAX_AGE_MS } from "./cron-types.js";

/**
 * Options for creating a cron scheduler.
 */
export interface CronSchedulerOptions {
	/** Called when a task fires with its prompt. Should enqueue the prompt for execution. */
	onFire: (prompt: string, task: CronTask) => void;
	/** Called when a task is settled (completed/error) */
	onSettle?: (taskId: string, error?: string, outputSnippet?: string) => void;
	/** Returns true if the app is currently loading (scheduler should wait). */
	isLoading?: () => boolean;
	/** If true, skip isLoading gate. */
	assistantMode?: boolean;
	/** Project root directory. If provided, enables durable task watching. */
	dir?: string;
		/** Legacy cwd for migrating tasks from old {cwd}/.nanopencil/ location. */
		legacyCwd?: string;
	/** If true, scheduler stops checking. */
	isKilled?: () => boolean;
	/** Jitter config: max jitter in milliseconds. Default: 60000 (1 minute). */
	jitterMs?: number;
}

/**
 * Cron scheduler instance.
 */
export interface CronScheduler {
	/** Start the scheduler. Begins polling for enabled state. */
	start(): void;
	/** Stop the scheduler immediately. */
	stop(): void;
	/** Get the next fire time across all tasks, or null if none. */
	getNextFireTime(): number | null;
	/** Mark a task as settled (after agent_end). */
	markSettled(id: string, error?: string, outputSnippet?: string): void;
	/** Force a task to be due immediately. */
	forceDue(id: string): boolean;
	/** Get task by ID from scheduler's loaded state. */
	getTask(id: string): CronTask | undefined;
}

const TICK_MS = 1000;
const LOCK_FILE = ".nanopencil/cron-scheduler.lock";
const WATCH_INTERVAL_MS = 3000;

/**
 * Create a cron scheduler instance.
 * Follows the lifecycle from the refactoring plan:
 *
 * poll enabled until true
 *   -> load tasks
 *   -> watch cron file
 *   -> start 1s check timer
 *   -> on fire, call onFire(prompt, task)
 */
export function createCronScheduler(options: CronSchedulerOptions): CronScheduler {
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let watchIntervalId: ReturnType<typeof setInterval> | null = null;
	let lockRelease: (() => Promise<void>) | null = null;
	let isLockOwner = false;
	let enabled = false;
	const nextFireAt = new Map<string, number>();
	const inFlight = new Set<string>();
	const settledTasks = new Map<string, { error?: string; outputSnippet?: string }>();
	let killed = false;

	const {
		onFire,
		onSettle,
		isLoading: isLoadingFn = () => false,
		assistantMode = false,
		dir,
		isKilled = () => killed,
		legacyCwd,
		jitterMs = 60_000,
	} = options;

	// Durable tasks loaded from disk
	let fileTasks = new Map<string, CronTask>();

	/**
	 * Core check function called every second.
	 * Processes both file-backed and session-only tasks.
	 */
	function check(): void {
		if (isKilled()) return;
		if (isLoadingFn() && !assistantMode) return;

		const now = Date.now();

		// Process file-backed tasks (only if we own the lock)
		if (isLockOwner) {
			for (const task of fileTasks.values()) {
				processTask(task, false, now);
			}
		}

		// Process session-only tasks
		const sessionTasks = getSessionCronTasks();
		for (const task of sessionTasks) {
			processTask(task, true, now);
		}
	}

	/**
	 * Process a single task: check expiry, calculate next fire, fire if due.
	 */
	function processTask(task: CronTask, isSession: boolean, now: number): void {
		// Skip if in flight
		if (inFlight.has(task.id)) return;

		// Skip if paused
		if (task.paused) return;

		// Must have createdAt
		if (task.createdAt === undefined) return;

		// Check if recurring task has expired (7 days)
		if (task.recurring && !task.permanent && now - task.createdAt >= DEFAULT_RECURRING_MAX_AGE_MS) {
			console.log(`[Cron-Scheduler] Task ${task.id} expired after 7 days, removing`);
			// Fire one last time then remove
			fireTask(task);
			removeTask(task.id, isSession);
			nextFireAt.delete(task.id);
			return;
		}

		let next = nextFireAt.get(task.id);

		if (next === undefined) {
			// Calculate first fire time
			const baseTime = task.lastFiredAt ?? task.createdAt;
			let calculated: number | null;
			if (task.recurring) {
				calculated = jitteredNextCronRunMs(task.cron, baseTime, task.id, jitterMs);
			} else {
				calculated = oneShotJitteredNextCronRunMs(task.cron, task.createdAt, task.id, jitterMs);
			}
			if (calculated !== null) {
				nextFireAt.set(task.id, calculated);
			}
			return;
		}

		// Not yet time
		if (now < next) return;

		// Fire!
		inFlight.add(task.id);
		task.runCount = (task.runCount ?? 0) + 1;
		fireTask(task);

		// Schedule next or remove
		if (task.recurring && !isExpired(task, now)) {
			// Use NOW as base time to prevent catch-up after sleep/pause
			const nextNext = jitteredNextCronRunMs(task.cron, now, task.id, jitterMs);
			if (nextNext !== null) {
				nextFireAt.set(task.id, nextNext);
			}
			// Update lastFiredAt for durable tasks
			if (!isSession && dir) {
				void markFired(task.id, now);
			}
			// Update session mirror
			if (!isSession) {
				task.lastFiredAt = now;
				updateSessionCronTask(task);
			}
		} else {
			// One-shot or expired: remove after fire
			nextFireAt.delete(task.id);
			// Remove one-shot task after firing
			setTimeout(() => removeTask(task.id, isSession), 200);
		}

		setTimeout(() => inFlight.delete(task.id), 100);
	}

	function isExpired(task: CronTask, now: number): boolean {
		if (task.permanent) return false;
		return now - task.createdAt >= DEFAULT_RECURRING_MAX_AGE_MS;
	}

	function fireTask(task: CronTask): void {
		// Check for missed one-shot tasks: ask user before executing
		if (!task.recurring && task.createdAt) {
			const expectedFire = nextCronRunMs(task.cron, task.createdAt);
			if (expectedFire && Date.now() - expectedFire > 5 * 60 * 1000) {
				// Missed by more than 5 minutes, should ask user
				// For now, we fire but could be enhanced to prompt
				console.log(`[Cron-Scheduler] One-shot task ${task.id} was missed, executing now`);
			}
		}

		onFire(task.prompt, task);
	}

	async function removeTask(id: string, isSession: boolean): Promise<void> {
		if (isSession) {
			const { removeSessionCronTasks } = await import("./cron-tasks.js");
			removeSessionCronTasks([id]);
		} else {
			fileTasks.delete(id);
			// Persist deletion to disk for durable tasks
			if (dir) {
				await writeCronTasks(dir, [...fileTasks.values()]);
			}
		}
	}

	async function markFired(id: string, firedAt: number): Promise<void> {
		if (!dir) return;
		try {
			await markCronTasksFired(dir, [id], firedAt);
		} catch (error) {
			console.error("[Cron-Scheduler] Error marking task fired:", error);
		}
	}

	async function loadTasks(): Promise<void> {
		if (!dir) {
			fileTasks = new Map();
			return;
		}

		try {
			const tasks = await readCronTasks(dir, legacyCwd);
			fileTasks = new Map();
			for (const task of tasks) {
				fileTasks.set(task.id, task);
			}
		} catch (error) {
			console.error("[Cron-Scheduler] Error loading tasks:", error);
			fileTasks = new Map();
		}
	}

	async function acquireLock(): Promise<boolean> {
		if (!dir) return false;

		try {
			const lockPath = `${dir}/${LOCK_FILE}`;
			lockRelease = await lockfile.lock(lockPath, {
				retries: { retries: 3, minTimeout: 100, maxTimeout: 500 },
			});
			isLockOwner = true;
			console.log("[Cron-Scheduler] Acquired scheduler lock");
			return true;
		} catch {
			console.log("[Cron-Scheduler] Could not acquire lock (another instance running)");
			isLockOwner = false;
			return false;
		}
	}

	async function releaseLock(): Promise<void> {
		if (lockRelease) {
			try {
				await lockRelease();
				console.log("[Cron-Scheduler] Released scheduler lock");
			} catch (error) {
				console.error("[Cron-Scheduler] Error releasing lock:", error);
			}
			lockRelease = null;
			isLockOwner = false;
		}
	}

	function startWatching(): void {
		if (!dir) return;

		// Periodic reload as a practical alternative to chokidar
		watchIntervalId = setInterval(async () => {
			if (isLockOwner) {
				const oldFileTasks = fileTasks;
				await loadTasks();

				// Merge nextFireAt for tasks that still exist
				for (const [id, next] of nextFireAt) {
					if (!fileTasks.has(id)) {
						// Task was deleted from file, remove from scheduler
						nextFireAt.delete(id);
					}
				}
			}
		}, WATCH_INTERVAL_MS);
	}

	async function enable(): Promise<void> {
		if (isKilled()) return;
		enabled = true;

		if (dir) {
			await acquireLock();
			if (isKilled()) {
				await releaseLock();
				return;
			}
			await loadTasks();
			if (isKilled()) {
				await releaseLock();
				return;
			}
			startWatching();
		}

		if (isKilled()) {
			if (watchIntervalId) {
				clearInterval(watchIntervalId);
				watchIntervalId = null;
			}
			await releaseLock();
			return;
		}
		intervalId = setInterval(check, TICK_MS);
		console.log("[Cron-Scheduler] Scheduler enabled and ticking");
	}

	async function pollForEnabled(): Promise<void> {
		if (dir !== undefined) {
			await enable();
			return;
		}

		const poll = setInterval(async () => {
			if (enabled) {
				clearInterval(poll);
				await enable();
			}
		}, 1000);

		setTimeout(async () => {
			if (!enabled) {
				clearInterval(poll);
				await enable();
			}
		}, 5000);
	}

	return {
		start(): void {
			void pollForEnabled();
		},

		stop(): void {
			killed = true;
			enabled = false;
			if (intervalId) {
				clearInterval(intervalId);
				intervalId = null;
			}
			if (watchIntervalId) {
				clearInterval(watchIntervalId);
				watchIntervalId = null;
			}
			void releaseLock();
			nextFireAt.clear();
			inFlight.clear();
			settledTasks.clear();
			console.log("[Cron-Scheduler] Stopped");
		},

		getNextFireTime(): number | null {
			let earliest: number | null = null;
			for (const time of nextFireAt.values()) {
				if (earliest === null || time < earliest) earliest = time;
			}
			return earliest;
		},

		markSettled(id: string, error?: string, outputSnippet?: string): void {
			inFlight.delete(id);
			settledTasks.set(id, { error, outputSnippet });
			if (onSettle) onSettle(id, error, outputSnippet);
		},

		forceDue(id: string): boolean {
			// Find task in either store
			const task = fileTasks.get(id) || getSessionCronTasks().find((t) => t.id === id);
			if (!task) return false;

			nextFireAt.set(id, 0);
			task.paused = false;
			return true;
		},

		getTask(id: string): CronTask | undefined {
			return fileTasks.get(id) || getSessionCronTasks().find((t) => t.id === id);
		},
	};
}
