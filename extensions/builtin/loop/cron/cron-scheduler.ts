/**
 * Non-React scheduler core for .claude/scheduled_tasks.json.
 *
 * 1:1 port of Claude Code src/utils/cronScheduler.ts
 *
 * Lifecycle: poll scheduledTasksEnabled until true (flag flips when
 * CronCreate runs) → load tasks + watch the file + start a 1s check
 * timer → on fire, call onFire(prompt). stop() tears everything down.
 */

import type { FSWatcher } from "chokidar";
import { cronToHuman } from "./cron-parser.js";
import {
	type CronJitterConfig,
	type CronTask,
	DEFAULT_CRON_JITTER_CONFIG,
	findMissedTasks,
	getCronFilePath,
	hasCronTasksSync,
	jitteredNextCronRunMs,
	markCronTasksFired,
	oneShotJitteredNextCronRunMs,
	readCronTasks,
	removeCronTasks,
	getSessionCronTasks,
	removeSessionCronTasks,
} from "./cron-tasks.js";
import {
	releaseSchedulerLock,
	tryAcquireSchedulerLock,
} from "./cron-tasks-lock.js";

const CHECK_INTERVAL_MS = 1000;
const FILE_STABILITY_MS = 300;
// How often a non-owning session re-probes the scheduler lock. Coarse
// because takeover only matters when the owning session has crashed.
const LOCK_PROBE_INTERVAL_MS = 5000;

/**
 * True when a recurring task was created more than `maxAgeMs` ago and should
 * be deleted on its next fire. Permanent tasks never age. `maxAgeMs === 0`
 * means unlimited (never ages out).
 */
export function isRecurringTaskAged(
	t: CronTask,
	nowMs: number,
	maxAgeMs: number,
): boolean {
	if (maxAgeMs === 0) return false;
	return Boolean(t.recurring && !t.permanent && nowMs - t.createdAt >= maxAgeMs);
}

type CronSchedulerOptions = {
	/** Called when a task fires (regular or missed-on-startup). */
	onFire: (prompt: string) => void;
	/** While true, firing is deferred to the next tick. */
	isLoading: () => boolean;
	/**
	 * When true, bypasses the isLoading gate in check() and auto-enables the
	 * scheduler without waiting for setScheduledTasksEnabled().
	 */
	assistantMode?: boolean;
	/**
	 * When provided, receives the full CronTask on normal fires (and onFire is
	 * NOT called for that fire). Lets callers see the task id/cron/etc
	 * instead of just the prompt string.
	 */
	onFireTask?: (task: CronTask) => void;
	/**
	 * When provided, receives the missed one-shot tasks on initial load (and
	 * onFire is NOT called with the pre-formatted notification).
	 */
	onMissed?: (tasks: CronTask[]) => void;
	/**
	 * Directory containing .claude/scheduled_tasks.json. Required for durable tasks.
	 */
	dir?: string;
	/**
	 * Owner key written into the lock file. Defaults to a generated UUID.
	 * PID remains the liveness probe regardless.
	 */
	lockIdentity?: string;
	/**
	 * Returns the cron jitter config to use for this tick. Called once per
	 * check() cycle.
	 */
	getJitterConfig?: () => CronJitterConfig;
	/**
	 * Killswitch: polled once per check() tick. When true, check() bails
	 * before firing anything.
	 */
	isKilled?: () => boolean;
	/**
	 * Per-task gate applied before any side effect. Tasks returning false are
	 * invisible to this scheduler.
	 */
	filter?: (t: CronTask) => boolean;
};

export type CronScheduler = {
	start: () => void;
	stop: () => void;
	/**
	 * Epoch ms of the soonest scheduled fire across all loaded tasks, or null
	 * if nothing is scheduled.
	 */
	getNextFireTime: () => number | null;
};

/**
 * Build the missed-task notification text. Guidance precedes the task list
 * and the list is wrapped in a code fence so a multi-line imperative prompt
 * is not interpreted as immediate instructions to avoid self-inflicted
 * prompt injection.
 */
export function buildMissedTaskNotification(missed: CronTask[]): string {
	const plural = missed.length > 1;
	const header =
		`The following one-shot scheduled task${plural ? "s were" : " was"} missed while Claude was not running. ` +
		`${plural ? "They have" : "It has"} already been removed from .claude/scheduled_tasks.json.\n\n` +
		`Do NOT execute ${plural ? "these prompts" : "this prompt"} yet. ` +
		`First use the AskUserQuestion tool to ask whether to run ${plural ? "each one" : "it"} now. ` +
		`Only execute if the user confirms.`;

	const blocks = missed.map((t) => {
		const meta = `[${cronToHuman(t.cron)}, created ${new Date(t.createdAt).toLocaleString()}]`;
		// Use a fence one longer than any backtick run in the prompt so a
		// prompt containing ``` cannot close the fence early and un-wrap the
		// trailing text (CommonMark fence-matching rule).
		const longestRun = (t.prompt.match(/`+/g) ?? []).reduce(
			(max, run) => Math.max(max, run.length),
			0,
		);
		const fence = "`".repeat(Math.max(3, longestRun + 1));
		return `${meta}\n${fence}\n${t.prompt}\n${fence}`;
	});

	return `${header}\n\n${blocks.join("\n\n")}`;
}

export function createCronScheduler(
	options: CronSchedulerOptions,
): CronScheduler {
	const {
		onFire,
		isLoading,
		assistantMode = false,
		onFireTask,
		onMissed,
		dir,
		lockIdentity,
		getJitterConfig,
		isKilled,
		filter,
	} = options;
	const lockOpts = dir || lockIdentity ? { dir, lockIdentity } : undefined;

	// File-backed tasks only. Session tasks (durable: false) are NOT loaded
	// here — they can be added/removed mid-session with no file event, so
	// check() reads them fresh on every tick instead.
	let tasks: CronTask[] = [];
	// Per-task next-fire times (epoch ms).
	const nextFireAt = new Map<string, number>();
	// Ids we've already enqueued a "missed task" prompt for — prevents
	// re-asking on every file change before the user answers.
	const missedAsked = new Set<string>();
	// Tasks currently enqueued but not yet removed from the file. Prevents
	// double-fire if the interval ticks again before removeCronTasks lands.
	const inFlight = new Set<string>();

	let enablePoll: ReturnType<typeof setInterval> | null = null;
	let checkTimer: ReturnType<typeof setInterval> | null = null;
	let lockProbeTimer: ReturnType<typeof setInterval> | null = null;
	let watcher: FSWatcher | null = null;
	let stopped = false;
	let isOwner = false;
	let scheduledTasksEnabled = false;

	// Generate a stable session identity for the lock
	const sessionId = lockIdentity ?? `session-${process.pid}-${Date.now()}`;

	async function load(initial: boolean) {
		if (!dir) return;
		const next = await readCronTasks(dir);
		if (stopped) return;
		tasks = next;

		// Only surface missed tasks on initial load. Chokidar-triggered
		// reloads leave overdue tasks to check() (which anchors from createdAt
		// and fires immediately). This avoids a misleading "missed while Claude
		// was not running" prompt for tasks that became overdue mid-session.
		if (!initial) return;

		const now = Date.now();
		const missed = findMissedTasks(next, now).filter(
			(t) => !t.recurring && !missedAsked.has(t.id) && (!filter || filter(t)),
		);
		if (missed.length > 0) {
			for (const t of missed) {
				missedAsked.add(t.id);
				// Prevent check() from re-firing the raw prompt while the async
				// removeCronTasks + chokidar reload chain is in progress.
				nextFireAt.set(t.id, Infinity);
			}
			if (onMissed) {
				onMissed(missed);
			} else {
				onFire(buildMissedTaskNotification(missed));
			}
			void removeCronTasks(
				missed.map((t) => t.id),
				dir,
			).catch(() => {});
		}
	}

	function check() {
		if (isKilled?.()) return;
		if (isLoading() && !assistantMode) return;
		const now = Date.now();
		const seen = new Set<string>();
		// File-backed recurring tasks that fired this tick. Batched into one
		// markCronTasksFired call after the loop so N fires = one write. Session
		// tasks excluded — they die with the process, no point persisting.
		const firedFileRecurring: string[] = [];
		// Read once per tick.
		const jitterCfg = getJitterConfig?.() ?? DEFAULT_CRON_JITTER_CONFIG;

		// Shared loop body. `isSession` routes the one-shot cleanup path:
		// session tasks are removed synchronously from memory, file tasks go
		// through the async removeCronTasks + chokidar reload.
		function process(t: CronTask, isSession: boolean) {
			if (filter && !filter(t)) return;
			seen.add(t.id);
			if (inFlight.has(t.id)) return;

			let next = nextFireAt.get(t.id);
			if (next === undefined) {
				// First sight — anchor from lastFiredAt (recurring) or createdAt.
				next = t.recurring
					? (jitteredNextCronRunMs(
							t.cron,
							t.lastFiredAt ?? t.createdAt,
							t.id,
							jitterCfg,
						) ?? Infinity)
					: (oneShotJitteredNextCronRunMs(
							t.cron,
							t.createdAt,
							t.id,
							jitterCfg,
						) ?? Infinity);
				nextFireAt.set(t.id, next);
			}

			if (now < next) return;

			if (onFireTask) {
				onFireTask(t);
			} else {
				onFire(t.prompt);
			}

			// Aged-out recurring tasks fall through to the one-shot delete paths
			// below. Fires one last time, then is removed.
			const aged = isRecurringTaskAged(t, now, jitterCfg.recurringMaxAgeMs);

			if (t.recurring && !aged) {
				// Recurring: reschedule from now (not from next) to avoid rapid
				// catch-up if the session was blocked.
				const newNext =
					jitteredNextCronRunMs(t.cron, now, t.id, jitterCfg) ?? Infinity;
				nextFireAt.set(t.id, newNext);
				// Persist lastFiredAt=now so next process spawn reconstructs this
				// same newNext on first-sight. Session tasks skip — process-local.
				if (!isSession) firedFileRecurring.push(t.id);
			} else if (isSession) {
				// One-shot (or aged-out recurring) session task: synchronous memory
				// removal.
				removeSessionCronTasks([t.id]);
				nextFireAt.delete(t.id);
			} else {
				// One-shot (or aged-out recurring) file task: delete from disk.
				// inFlight guards against double-fire during the async
				// removeCronTasks + chokidar reload.
				inFlight.add(t.id);
				void removeCronTasks([t.id], dir)
					.catch(() => {})
					.finally(() => inFlight.delete(t.id));
				nextFireAt.delete(t.id);
			}
		}

		// File-backed tasks: only when we own the scheduler lock. The lock
		// exists to stop two Claude sessions in the same cwd from double-firing
		// the same on-disk task.
		if (isOwner) {
			for (const t of tasks) process(t, false);
			// Batched lastFiredAt write.
			if (firedFileRecurring.length > 0) {
				for (const id of firedFileRecurring) inFlight.add(id);
				void markCronTasksFired(firedFileRecurring, now, dir)
					.catch(() => {})
					.finally(() => {
						for (const id of firedFileRecurring) inFlight.delete(id);
					});
			}
		}
		// Session-only tasks: process-private, the lock does not apply — the
		// other session cannot see them and there is no double-fire risk.
		for (const t of getSessionCronTasks()) process(t, true);

		if (seen.size === 0) {
			// No live tasks this tick — clear the whole schedule so
			// getNextFireTime() returns null.
			nextFireAt.clear();
			return;
		}
		// Evict schedule entries for tasks no longer present.
		for (const id of nextFireAt.keys()) {
			if (!seen.has(id)) nextFireAt.delete(id);
		}
	}

	async function enable() {
		if (stopped) return;
		if (enablePoll) {
			clearInterval(enablePoll);
			enablePoll = null;
		}

		const { default: chokidar } = await import("chokidar");
		if (stopped) return;

		// Acquire the per-project scheduler lock. Only the owning session runs
		// check(). Other sessions probe periodically to take over if the owner
		// dies.
		if (lockOpts) {
			isOwner = await tryAcquireSchedulerLock(lockOpts, sessionId).catch(
				() => false,
			);
		}
		if (stopped) {
			if (isOwner && lockOpts) {
				isOwner = false;
				void releaseSchedulerLock(lockOpts, sessionId);
			}
			return;
		}
		if (!isOwner && lockOpts) {
			lockProbeTimer = setInterval(() => {
				void tryAcquireSchedulerLock(lockOpts, sessionId)
					.then((owned) => {
						if (stopped) {
							if (owned) void releaseSchedulerLock(lockOpts!, sessionId);
							return;
						}
						if (owned) {
							isOwner = true;
							if (lockProbeTimer) {
								clearInterval(lockProbeTimer);
								lockProbeTimer = null;
							}
						}
					})
					.catch(() => {});
			}, LOCK_PROBE_INTERVAL_MS);
			lockProbeTimer?.unref?.();
		}

		void load(true);

		if (dir) {
			const path = getCronFilePath(dir);
			watcher = chokidar.watch(path, {
				persistent: false,
				ignoreInitial: true,
				awaitWriteFinish: { stabilityThreshold: FILE_STABILITY_MS },
				ignorePermissionErrors: true,
			});
			watcher.on("add", () => void load(false));
			watcher.on("change", () => void load(false));
			watcher.on("unlink", () => {
				if (!stopped) {
					tasks = [];
					nextFireAt.clear();
				}
			});
		}

		checkTimer = setInterval(check, CHECK_INTERVAL_MS);
		// Don't keep the process alive for the scheduler alone.
		checkTimer?.unref?.();
	}

	return {
		start() {
			stopped = false;
			// If dir is provided, don't poll — enable immediately.
			if (dir !== undefined) {
				void enable();
				return;
			}
			// Auto-enable when scheduled_tasks.json has entries.
			if (dir && !scheduledTasksEnabled && (assistantMode || hasCronTasksSync(dir))) {
				scheduledTasksEnabled = true;
			}
			if (scheduledTasksEnabled) {
				void enable();
				return;
			}
			enablePoll = setInterval(
				(en) => {
					if (scheduledTasksEnabled) void en();
				},
				CHECK_INTERVAL_MS,
				enable,
			);
			enablePoll?.unref?.();
		},
		stop() {
			stopped = true;
			if (enablePoll) {
				clearInterval(enablePoll);
				enablePoll = null;
			}
			if (checkTimer) {
				clearInterval(checkTimer);
				checkTimer = null;
			}
			if (lockProbeTimer) {
				clearInterval(lockProbeTimer);
				lockProbeTimer = null;
			}
			void watcher?.close();
			watcher = null;
			if (isOwner && lockOpts) {
				isOwner = false;
				void releaseSchedulerLock(lockOpts, sessionId);
			}
		},
		getNextFireTime() {
			// nextFireAt uses Infinity for "never" (in-flight one-shots, bad cron
			// strings). Filter those out so callers can distinguish "soon" from
			// "nothing pending".
			let min = Infinity;
			for (const t of nextFireAt.values()) {
				if (t < min) min = t;
			}
			return min === Infinity ? null : min;
		},
	};
}
