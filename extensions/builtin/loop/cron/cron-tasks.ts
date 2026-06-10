/**
 * Scheduled prompts, stored in <project>/.claude/scheduled_tasks.json.
 *
 * 1:1 port of Claude Code src/utils/cronTasks.ts
 *
 * Tasks come in two flavors:
 *   - One-shot (recurring: false/undefined) — fire once, then auto-delete.
 *   - Recurring (recurring: true) — fire on schedule, reschedule from now,
 *     persist until explicitly deleted via CronDelete or auto-expire after
 *     a configurable limit (DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs).
 *
 * File format:
 *   { "tasks": [{ id, cron, prompt, createdAt, recurring?, permanent? }] }
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeNextCronRun, parseCronExpression } from "./cron-parser.js";

// ============================================================================
// Session-only task store (in-memory)
// ============================================================================

const sessionTasks = new Map<string, CronTask>();

export function addSessionCronTask(task: CronTask): void {
	sessionTasks.set(task.id, task);
}

export function getSessionCronTasks(): CronTask[] {
	return [...sessionTasks.values()];
}

/**
 * Remove session-only tasks by ID. Returns count of actually removed tasks.
 */
export function removeSessionCronTasks(ids: string[]): number {
	let removed = 0;
	for (const id of ids) {
		if (sessionTasks.delete(id)) removed++;
	}
	return removed;
}

// ============================================================================
// CronTask type (matches CC exactly)
// ============================================================================

export type CronTask = {
	id: string;
	/** 5-field cron string (local time) — validated on write, re-validated on read. */
	cron: string;
	/** Prompt to enqueue when the task fires. */
	prompt: string;
	/** Epoch ms when the task was created. Anchor for missed-task detection. */
	createdAt: number;
	/**
	 * Epoch ms of the most recent fire. Written back by the scheduler after
	 * each recurring fire so next-fire computation survives process restarts.
	 * The scheduler anchors first-sight from `lastFiredAt ?? createdAt` — a
	 * never-fired task uses createdAt (correct for pinned crons like
	 * `30 14 27 2 *` whose next-from-now is next year); a fired-before task
	 * reconstructs the same `nextFireAt` the prior process had in memory.
	 * Never set for one-shots (they're deleted on fire).
	 */
	lastFiredAt?: number;
	/** When true, the task reschedules after firing instead of being deleted. */
	recurring?: boolean;
	/**
	 * When true, the task is exempt from recurringMaxAgeMs auto-expiry.
	 * System escape hatch for assistant mode's built-in tasks.
	 */
	permanent?: boolean;
	/**
	 * Runtime-only flag. false → session-scoped (never written to disk).
	 * File-backed tasks leave this undefined; writeCronTasks strips it so
	 * the on-disk shape stays { id, cron, prompt, createdAt, lastFiredAt?, recurring?, permanent? }.
	 */
	durable?: boolean;
	/**
	 * Runtime-only. When set, the task was created by an in-process teammate.
	 * The scheduler routes fires to that teammate's queue instead of the main
	 * REPL's. Never written to disk (teammate crons are always session-only).
	 */
	agentId?: string;
};

type CronFile = { tasks: CronTask[] };

const CRON_FILE_REL = join(".claude", "scheduled_tasks.json");

/**
 * Path to the cron file. `dir` must be provided explicitly.
 */
export function getCronFilePath(dir: string): string {
	return join(dir, CRON_FILE_REL);
}

/**
 * Read and parse .claude/scheduled_tasks.json. Returns an empty task list if the file
 * is missing, empty, or malformed. Tasks with invalid cron strings are
 * silently dropped (logged at debug level) so a single bad entry never
 * blocks the whole file.
 */
export async function readCronTasks(dir: string): Promise<CronTask[]> {
	let raw: string;
	try {
		raw = await import("node:fs/promises").then((fs) =>
			fs.readFile(getCronFilePath(dir), { encoding: "utf-8" }),
		);
	} catch {
		return [];
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return [];
		const file = parsed as Partial<CronFile>;
		if (!Array.isArray(file.tasks)) return [];

		const out: CronTask[] = [];
		for (const t of file.tasks) {
			if (
				!t ||
				typeof t.id !== "string" ||
				typeof t.cron !== "string" ||
				typeof t.prompt !== "string" ||
				typeof t.createdAt !== "number"
			) {
				continue;
			}
			if (!parseCronExpression(t.cron)) {
				continue;
			}
			out.push({
				id: t.id,
				cron: t.cron,
				prompt: t.prompt,
				createdAt: t.createdAt,
				...(typeof t.lastFiredAt === "number" ? { lastFiredAt: t.lastFiredAt } : {}),
				...(t.recurring ? { recurring: true } : {}),
				...(t.permanent ? { permanent: true } : {}),
			});
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * Sync check for whether the cron file has any valid tasks. Used by
 * cronScheduler.start() to decide whether to auto-enable. One file read.
 */
export function hasCronTasksSync(dir: string): boolean {
	let raw: string;
	try {
		raw = readFileSync(getCronFilePath(dir), "utf-8");
	} catch {
		return false;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return false;
		const tasks = (parsed as Partial<CronFile>).tasks;
		return Array.isArray(tasks) && tasks.length > 0;
	} catch {
		return false;
	}
}

/**
 * Overwrite .claude/scheduled_tasks.json with the given tasks. Creates .claude/ if
 * missing. Empty task list writes an empty file (rather than deleting) so
 * the file watcher sees a change event on last-task-removed.
 */
export async function writeCronTasks(tasks: CronTask[], dir: string): Promise<void> {
	await mkdir(join(dir, ".claude"), { recursive: true });
	// Strip the runtime-only `durable` flag — everything on disk is durable
	// by definition, and keeping the flag out means readCronTasks() naturally
	// yields durable: undefined without having to set it explicitly.
	const body: CronFile = {
		tasks: tasks.map(({ durable: _durable, ...rest }) => rest),
	};
	await writeFile(
		getCronFilePath(dir),
		JSON.stringify(body, null, 2) + "\n",
		"utf-8",
	);
}

/**
 * Append a task. Returns the generated id. Caller is responsible for having
 * already validated the cron string (the tool does this via validateInput).
 *
 * When `durable` is false the task is held in process memory only
 * (sessionTasks Map) — it fires on schedule this session but is never
 * written to .claude/scheduled_tasks.json and dies with the process. The
 * scheduler merges session tasks into its tick loop directly, so no file
 * change event is needed.
 */
export async function addCronTask(
	cron: string,
	prompt: string,
	recurring: boolean,
	durable: boolean,
	dir?: string,
	agentId?: string,
): Promise<string> {
	// Short ID — 8 hex chars is plenty for MAX_JOBS=50, avoids slice/prefix
	// juggling between the tool layer (shows short IDs) and disk.
	const id = randomUUID().slice(0, 8);
	const task: CronTask = {
		id,
		cron,
		prompt,
		createdAt: Date.now(),
		...(recurring ? { recurring: true } : {}),
	};
	if (!durable) {
		addSessionCronTask({ ...task, ...(agentId ? { agentId } : {}) });
		return id;
	}
	if (!dir) throw new Error("dir required for durable tasks");
	const tasks = await readCronTasks(dir);
	tasks.push(task);
	await writeCronTasks(tasks, dir);
	return id;
}

/**
 * Remove tasks by id. No-op if none match (e.g. another session raced us).
 * Used for both fire-once cleanup and explicit CronDelete.
 *
 * When called with `dir` undefined (REPL path), also sweeps the in-memory
 * session store — the caller doesn't know which store an id lives in.
 * Daemon callers pass `dir` explicitly; they have no session, and the
 * `dir !== undefined` guard keeps this function from touching the session
 * store on that path.
 */
export async function removeCronTasks(ids: string[], dir?: string): Promise<void> {
	if (ids.length === 0) return;
	// Sweep session store first. In nanoPencil, always sweep since the
	// extension API always provides dir (no daemon/REPL distinction like CC).
	const removedFromSession = removeSessionCronTasks(ids);
	if (removedFromSession === ids.length) return;
	if (!dir) return;
	const idSet = new Set(ids);
	const tasks = await readCronTasks(dir);
	const remaining = tasks.filter((t) => !idSet.has(t.id));
	if (remaining.length === tasks.length) return;
	await writeCronTasks(remaining, dir);
}

/**
 * Stamp `lastFiredAt` on the given recurring tasks and write back. Batched
 * so N fires in one scheduler tick = one read-modify-write, not N. Only
 * touches file-backed tasks — session tasks die with the process, no point
 * persisting their fire time.
 */
export async function markCronTasksFired(
	ids: string[],
	firedAt: number,
	dir?: string,
): Promise<void> {
	if (ids.length === 0 || !dir) return;
	const idSet = new Set(ids);
	const tasks = await readCronTasks(dir);
	let changed = false;
	for (const t of tasks) {
		if (idSet.has(t.id)) {
			t.lastFiredAt = firedAt;
			changed = true;
		}
	}
	if (!changed) return;
	await writeCronTasks(tasks, dir);
}

/**
 * File-backed tasks + session-only tasks, merged. Session tasks get
 * `durable: false` so callers can distinguish them. File tasks are
 * returned as-is (durable undefined → truthy).
 *
 * In nanoPencil, always merges session tasks since the extension API
 * always provides `dir` (no daemon/REPL distinction like CC).
 */
export async function listAllCronTasks(dir?: string): Promise<CronTask[]> {
	const fileTasks = dir ? await readCronTasks(dir) : [];
	const sessionTasksList = getSessionCronTasks().map((t) => ({
		...t,
		durable: false as const,
	}));
	return [...fileTasks, ...sessionTasksList];
}

/**
 * Next fire time in epoch ms for a cron string, strictly after `fromMs`.
 * Returns null if invalid or no match in the next 366 days.
 */
export function nextCronRunMs(cron: string, fromMs: number): number | null {
	const fields = parseCronExpression(cron);
	if (!fields) return null;
	const next = computeNextCronRun(fields, new Date(fromMs));
	return next ? next.getTime() : null;
}

/**
 * Cron scheduler tuning knobs. Sourced at runtime from config so ops can
 * adjust behavior fleet-wide without shipping a client build.
 * Defaults here preserve the pre-config behavior exactly.
 */
export type CronJitterConfig = {
	/** Recurring-task forward delay as a fraction of the interval between fires. */
	recurringFrac: number;
	/** Upper bound on recurring forward delay regardless of interval length. */
	recurringCapMs: number;
	/** One-shot backward lead: maximum ms a task may fire early. */
	oneShotMaxMs: number;
	/**
	 * One-shot backward lead: minimum ms a task fires early when the minute-mod
	 * gate matches. 0 = taskIds hashing near zero fire on the exact mark. Raise
	 * this to guarantee nobody lands on the wall-clock boundary.
	 */
	oneShotFloorMs: number;
	/**
	 * Jitter fires landing on minutes where `minute % N === 0`. 30 → :00/:30
	 * (the human-rounding hotspots). 15 → :00/:15/:30/:45. 1 → every minute.
	 */
	oneShotMinuteMod: number;
	/**
	 * Recurring tasks auto-expire this many ms after creation (unless marked
	 * `permanent`). The default (7 days) covers "check my PRs every hour this
	 * week" workflows while capping worst-case session lifetime.
	 *
	 * `0` = unlimited (tasks never auto-expire).
	 */
	recurringMaxAgeMs: number;
};

export const DEFAULT_CRON_JITTER_CONFIG: CronJitterConfig = {
	recurringFrac: 0.1,
	recurringCapMs: 15 * 60 * 1000,
	oneShotMaxMs: 90 * 1000,
	oneShotFloorMs: 0,
	oneShotMinuteMod: 30,
	recurringMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
};

/**
 * taskId is an 8-hex-char UUID slice (see {@link addCronTask}) → parse as
 * u32 → [0, 1). Stable across restarts, uniformly distributed across the
 * fleet. Non-hex ids (hand-edited JSON) fall back to 0 = no jitter.
 */
function jitterFrac(taskId: string): number {
	const frac = parseInt(taskId.slice(0, 8), 16) / 0x1_0000_0000;
	return Number.isFinite(frac) ? frac : 0;
}

/**
 * Same as {@link nextCronRunMs}, plus a deterministic per-task delay to
 * avoid a thundering herd when many sessions schedule the same cron string
 * (e.g. `0 * * * *` → everyone hits inference at :00).
 *
 * The delay is proportional to the current gap between fires
 * ({@link CronJitterConfig.recurringFrac}, capped at
 * {@link CronJitterConfig.recurringCapMs}) so at defaults an hourly task
 * spreads across [:00, :06) but a per-minute task only spreads by a few
 * seconds.
 *
 * Only used for recurring tasks. One-shot tasks use
 * {@link oneShotJitteredNextCronRunMs} (backward jitter, minute-gated).
 */
export function jitteredNextCronRunMs(
	cron: string,
	fromMs: number,
	taskId: string,
	cfg: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG,
): number | null {
	const t1 = nextCronRunMs(cron, fromMs);
	if (t1 === null) return null;
	const t2 = nextCronRunMs(cron, t1);
	// No second match in the next year (e.g. pinned date) → nothing to
	// proportion against, and near-certainly not a herd risk. Fire on t1.
	if (t2 === null) return t1;
	const jitter = Math.min(
		jitterFrac(taskId) * cfg.recurringFrac * (t2 - t1),
		cfg.recurringCapMs,
	);
	return t1 + jitter;
}

/**
 * Same as {@link nextCronRunMs}, minus a deterministic per-task lead time
 * when the fire time lands on a minute boundary matching
 * {@link CronJitterConfig.oneShotMinuteMod}.
 *
 * One-shot tasks are user-pinned ("remind me at 3pm") so delaying them
 * breaks the contract — but firing slightly early is invisible and spreads
 * the inference spike from everyone picking the same round wall-clock time.
 * At defaults (mod 30, max 90 s, floor 0) only :00 and :30 get jitter,
 * because humans round to the half-hour.
 *
 * Checks the computed fire time rather than the cron string so
 * `0 15 * * *`, step expressions, and `0,30 9 * * *` all get jitter
 * when they land on a matching minute. Clamped to `fromMs` so a task created
 * inside its own jitter window doesn't fire before it was created.
 */
export function oneShotJitteredNextCronRunMs(
	cron: string,
	fromMs: number,
	taskId: string,
	cfg: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG,
): number | null {
	const t1 = nextCronRunMs(cron, fromMs);
	if (t1 === null) return null;
	// Cron resolution is 1 minute → computed times always have :00 seconds,
	// so a minute-field check is sufficient to identify the hot marks.
	// getMinutes() (local), not getUTCMinutes(): cron is evaluated in local
	// time, and "user picked a round time" means round in *their* TZ. In
	// half-hour-offset zones (India UTC+5:30) local :00 is UTC :30 — the
	// UTC check would jitter the wrong marks.
	if (new Date(t1).getMinutes() % cfg.oneShotMinuteMod !== 0) return t1;
	// floor + frac * (max - floor) → uniform over [floor, max). With floor=0
	// this reduces to the original frac * max. With floor>0, even a taskId
	// hashing to 0 gets `floor` ms of lead — nobody fires on the exact mark.
	const lead =
		cfg.oneShotFloorMs +
		jitterFrac(taskId) * (cfg.oneShotMaxMs - cfg.oneShotFloorMs);
	// t1 > fromMs is guaranteed by nextCronRunMs (strictly after), so the
	// max() only bites when the task was created inside its own lead window.
	return Math.max(t1 - lead, fromMs);
}

/**
 * A task is "missed" when its next scheduled run (computed from createdAt)
 * is in the past. Surfaced to the user at startup. Works for both one-shot
 * and recurring tasks — a recurring task whose window passed while Claude
 * was down is still "missed".
 */
export function findMissedTasks(tasks: CronTask[], nowMs: number): CronTask[] {
	return tasks.filter((t) => {
		const next = nextCronRunMs(t.cron, t.createdAt);
		return next !== null && next < nowMs;
	});
}
