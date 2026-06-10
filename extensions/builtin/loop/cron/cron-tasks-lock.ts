/**
 * Scheduler lease lock for .claude/scheduled_tasks.json.
 *
 * 1:1 port of Claude Code src/utils/cronTasksLock.ts
 *
 * When multiple Claude sessions run in the same project directory, only one
 * should drive the cron scheduler. The first session to acquire this lock
 * becomes the scheduler; others stay passive and periodically probe the lock.
 * If the owner dies (PID no longer running), a passive session takes over.
 *
 * Pattern mirrors computerUseLock.ts: O_EXCL atomic create, PID liveness
 * probe, stale-lock recovery, cleanup-on-exit.
 */

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const LOCK_FILE_REL = join(".claude", "scheduled_tasks.lock");

interface SchedulerLock {
	sessionId: string;
	pid: number;
	acquiredAt: number;
}

/**
 * Options for callers that don't have bootstrap state.
 * lockIdentity should be stable for the lifetime of one process.
 */
export type SchedulerLockOptions = {
	dir?: string;
	lockIdentity?: string;
};

let lastBlockedBy: string | undefined;

function getLockPath(dir: string): string {
	return join(dir, LOCK_FILE_REL);
}

async function readLock(dir: string): Promise<SchedulerLock | undefined> {
	let raw: string;
	try {
		raw = await readFile(getLockPath(dir), "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			parsed &&
			typeof parsed === "object" &&
			typeof (parsed as SchedulerLock).sessionId === "string" &&
			typeof (parsed as SchedulerLock).pid === "number" &&
			typeof (parsed as SchedulerLock).acquiredAt === "number"
		) {
			return parsed as SchedulerLock;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

async function tryCreateExclusive(
	lock: SchedulerLock,
	dir: string,
): Promise<boolean> {
	const path = getLockPath(dir);
	const body = JSON.stringify(lock);
	try {
		await writeFile(path, body, { flag: "wx" });
		return true;
	} catch (e: unknown) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code === "EEXIST") return false;
		if (code === "ENOENT") {
			// .claude/ doesn't exist yet — create it and retry once.
			await mkdir(dirname(path), { recursive: true });
			try {
				await writeFile(path, body, { flag: "wx" });
				return true;
			} catch (retryErr: unknown) {
				if ((retryErr as NodeJS.ErrnoException).code === "EEXIST") return false;
				throw retryErr;
			}
		}
		throw e;
	}
}

/**
 * Check if a process is running by PID.
 * Uses process.kill(pid, 0) which doesn't actually send a signal.
 */
function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Try to acquire the scheduler lock for the current session.
 * Returns true on success, false if another live session holds it.
 *
 * Uses O_EXCL ('wx') for atomic test-and-set. If the file exists:
 *   - Already ours → true (idempotent re-acquire)
 *   - Another live PID → false
 *   - Stale (PID dead / corrupt) → unlink and retry exclusive create once
 *
 * If two sessions race to recover a stale lock, only one create succeeds.
 */
export async function tryAcquireSchedulerLock(
	opts: SchedulerLockOptions,
	sessionId: string,
): Promise<boolean> {
	const dir = opts.dir;
	if (!dir) return false;

	const lock: SchedulerLock = {
		sessionId,
		pid: process.pid,
		acquiredAt: Date.now(),
	};

	if (await tryCreateExclusive(lock, dir)) {
		lastBlockedBy = undefined;
		return true;
	}

	const existing = await readLock(dir);

	// Already ours (idempotent). After --resume the session ID is restored
	// but the process has a new PID — update the lock file so other sessions
	// see a live PID and don't steal it.
	if (existing?.sessionId === sessionId) {
		if (existing.pid !== process.pid) {
			await writeFile(getLockPath(dir), JSON.stringify(lock));
		}
		return true;
	}

	// Another live session — blocked.
	if (existing && isProcessRunning(existing.pid)) {
		if (lastBlockedBy !== existing.sessionId) {
			lastBlockedBy = existing.sessionId;
		}
		return false;
	}

	// Stale — unlink and retry the exclusive create once.
	await unlink(getLockPath(dir)).catch(() => {});
	if (await tryCreateExclusive(lock, dir)) {
		lastBlockedBy = undefined;
		return true;
	}
	// Another session won the recovery race.
	return false;
}

/**
 * Release the scheduler lock if the current session owns it.
 */
export async function releaseSchedulerLock(
	opts: SchedulerLockOptions,
	sessionId: string,
): Promise<void> {
	lastBlockedBy = undefined;

	const dir = opts.dir;
	if (!dir) return;
	const existing = await readLock(dir);
	if (!existing || existing.sessionId !== sessionId) return;
	try {
		await unlink(getLockPath(dir));
	} catch {
		// Already gone.
	}
}
