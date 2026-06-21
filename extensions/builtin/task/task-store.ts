/**
 * [WHO]: Task store - CRUD operations with disk persistence
 * [FROM]: Inspired by Claude Code utils/tasks.ts
 * [TO]: Consumed by all task tools
 * [HERE]: extensions/builtin/task/task-store.ts - task state management with atomic file writes
 *
 * Task list isolation: per CC semantics, each session/terminal gets its own
 * task list. Priority: CATUI_TASK_LIST_ID env > team name > session ID.
 * Legacy fallback: DEFAULT_TASK_LIST_ID ("tasklist") for existing data.
 *
 * Cross-terminal updates: fs.watch monitors the tasks directory and notifies
 * in-process listeners. A 5s polling fallback handles edge cases.
 */

import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { Task, TaskStatus } from "./task-types.js";
import { sanitizePathComponent, DEFAULT_TASK_LIST_ID } from "./task-types.js";

// ============================================================================
// Task list ID resolution (CC: session isolation)
// ============================================================================

/**
 * Resolve the task list ID for the current context.
 *
 * Priority (per CC):
 * 1. CATUI_TASK_LIST_ID env var (explicit override)
 * 2. Team name (if in team context)
 * 3. Session ID (default — each terminal gets its own task list)
 *
 * Falls back to DEFAULT_TASK_LIST_ID ("tasklist") for legacy compatibility.
 */
export function getTaskListId(sessionId?: string, teamName?: string): string {
	if (process.env.CATUI_TASK_LIST_ID) {
		return process.env.CATUI_TASK_LIST_ID;
	}
	if (teamName) {
		return teamName;
	}
	if (sessionId) {
		return sessionId;
	}
	return DEFAULT_TASK_LIST_ID;
}

// ============================================================================
// Task update signal (in-process notification)
// ============================================================================

type TaskUpdateListener = () => void;
const taskUpdateListeners = new Set<TaskUpdateListener>();

/** Notify all listeners that tasks have changed. */
function notifyTasksUpdated(): void {
	for (const listener of taskUpdateListeners) {
		try { listener(); } catch { /* ignore */ }
	}
}

/** Subscribe to task update notifications. Returns unsubscribe function. */
export function onTasksUpdated(listener: TaskUpdateListener): () => void {
	taskUpdateListeners.add(listener);
	return () => { taskUpdateListeners.delete(listener); };
}

// ============================================================================
// fs.watch for cross-terminal live updates (CC: TasksV2Store)
// ============================================================================

const watchers = new Map<string, FSWatcher>();
const POLL_INTERVAL_MS = 5000;
const pollTimers = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Per-directory snapshot used by the polling fallback. The polling timer only
 * fires `notifyTasksUpdated()` when the current on-disk state actually differs
 * from this snapshot, so an idle session does not get a synthetic refresh tick
 * every 5s that would re-render (and re-flicker) a hidden task panel.
 */
const lastSeenSnapshots = new Map<string, string>();

async function snapshotTasksDir(dir: string): Promise<string> {
	try {
		const entries = await readdir(dir);
		// Only consider json files; deterministic order so the snapshot is stable
		// when the same tasks exist between polls.
		const jsonNames = entries.filter((name) => name.endsWith(".json")).sort();
		const parts: string[] = [];
		for (const name of jsonNames) {
			try {
				const raw = await readFile(join(dir, name), "utf-8");
				parts.push(`${name}:${raw}`);
			} catch {
				// File vanished between readdir and readFile — surface as a
				// presence marker so deletion is detected as a change.
				parts.push(`${name}:<missing>`);
			}
		}
		return parts.join("|");
	} catch {
		// Directory missing or unreadable — treat as "no tasks" snapshot.
		return "";
	}
}

/**
 * Start watching a task directory for changes (fs.watch + 5s polling fallback).
 * Multiple calls with the same dir are idempotent.
 */
export function startTaskFileWatcher(dir: string): void {
	if (watchers.has(dir) || pollTimers.has(dir)) return;

	// Seed the polling snapshot so the first 5s tick does not fire a spurious
	// change event when nothing has actually changed since startup.
	void snapshotTasksDir(dir).then((snap) => {
		lastSeenSnapshots.set(dir, snap);
	}).catch(() => {
		lastSeenSnapshots.set(dir, "");
	});

	// Primary: fs.watch
	try {
		const watcher = watch(dir, { recursive: false }, () => {
			notifyTasksUpdated();
		});
		watcher.unref?.();
		watchers.set(dir, watcher);
	} catch {
		// fs.watch may fail on some platforms — fall through to polling
	}

	// Fallback: 5s polling (handles edge cases like NFS, Docker mounts).
	// Only fire `notifyTasksUpdated()` when the on-disk state has actually
	// changed since the last poll. Without this guard the auto-hidden task
	// panel would re-render on every poll and visibly flicker.
	const timer = setInterval(() => {
		void snapshotTasksDir(dir).then((snap) => {
			const previous = lastSeenSnapshots.get(dir);
			if (previous === snap) return;
			lastSeenSnapshots.set(dir, snap);
			notifyTasksUpdated();
		}).catch(() => {
			// Snapshot failure is not actionable here; skip this tick.
		});
	}, POLL_INTERVAL_MS);
	timer.unref?.();
	pollTimers.set(dir, timer);
}

/**
 * Stop watching a task directory.
 */
export function stopTaskFileWatcher(dir: string): void {
	const watcher = watchers.get(dir);
	if (watcher) {
		watcher.close();
		watchers.delete(dir);
	}
	const timer = pollTimers.get(dir);
	if (timer) {
		clearInterval(timer);
		pollTimers.delete(dir);
	}
	lastSeenSnapshots.delete(dir);
}

/**
 * Stop all task file watchers. Called on session shutdown.
 */
export function stopAllTaskFileWatchers(): void {
	for (const [dir] of watchers) {
		stopTaskFileWatcher(dir);
	}
	for (const [dir] of pollTimers) {
		stopTaskFileWatcher(dir);
	}
}

// ============================================================================
// Path helpers
// ============================================================================

const HIGH_WATER_MARK_FILE = ".highwatermark";

export function getTasksDir(agentDir: string, taskListId: string = DEFAULT_TASK_LIST_ID): string {
	return join(agentDir, "tasks", sanitizePathComponent(taskListId));
}

function watchTaskList(agentDir: string, taskListId: string): void {
	startTaskFileWatcher(getTasksDir(agentDir, taskListId));
}

function getTaskPath(agentDir: string, taskListId: string, taskId: string): string {
	return join(getTasksDir(agentDir, taskListId), `${sanitizePathComponent(taskId)}.json`);
}

function getHighWaterMarkPath(agentDir: string, taskListId: string): string {
	return join(getTasksDir(agentDir, taskListId), HIGH_WATER_MARK_FILE);
}

// ============================================================================
// Atomic write helper (tmp + rename)
// ============================================================================

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
	const tmpPath = `${filePath}.tmp`;
	await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
	await rename(tmpPath, filePath);
}

// ============================================================================
// High water mark (prevents ID reuse after deletion/reset)
// ============================================================================

async function readHighWaterMark(agentDir: string, taskListId: string): Promise<number> {
	try {
		const content = await readFile(getHighWaterMarkPath(agentDir, taskListId), "utf-8");
		const value = parseInt(content.trim(), 10);
		return isNaN(value) ? 0 : value;
	} catch {
		return 0;
	}
}

async function writeHighWaterMark(agentDir: string, taskListId: string, value: number): Promise<void> {
	await writeFile(getHighWaterMarkPath(agentDir, taskListId), String(value), "utf-8");
}

// ============================================================================
// Directory management
// ============================================================================

async function ensureTasksDir(agentDir: string, taskListId: string): Promise<string> {
	const dir = getTasksDir(agentDir, taskListId);
	await mkdir(dir, { recursive: true });
	return dir;
}

// ============================================================================
// ID generation
// ============================================================================

async function findHighestTaskIdFromFiles(agentDir: string, taskListId: string): Promise<number> {
	const dir = getTasksDir(agentDir, taskListId);
	let files: string[];
	try {
		files = await readdir(dir);
	} catch {
		return 0;
	}
	let highest = 0;
	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		const taskId = parseInt(file.replace(".json", ""), 10);
		if (!isNaN(taskId) && taskId > highest) {
			highest = taskId;
		}
	}
	return highest;
}

async function findHighestTaskId(agentDir: string, taskListId: string): Promise<number> {
	const [fromFiles, fromMark] = await Promise.all([
		findHighestTaskIdFromFiles(agentDir, taskListId),
		readHighWaterMark(agentDir, taskListId),
	]);
	return Math.max(fromFiles, fromMark);
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new task. Returns the created task with assigned ID.
 */
export async function createTask(
	agentDir: string,
	taskListId: string,
	taskData: Omit<Task, "id">,
): Promise<Task> {
	await ensureTasksDir(agentDir, taskListId);
	watchTaskList(agentDir, taskListId);
	const highestId = await findHighestTaskId(agentDir, taskListId);
	const id = String(highestId + 1);
	const task: Task = { id, ...taskData };
	const path = getTaskPath(agentDir, taskListId, id);
	await atomicWriteJson(path, task);
	notifyTasksUpdated();
	return task;
}

/**
 * Get a task by ID. Returns null if not found.
 */
export async function getTask(
	agentDir: string,
	taskListId: string,
	taskId: string,
): Promise<Task | null> {
	watchTaskList(agentDir, taskListId);
	const path = getTaskPath(agentDir, taskListId, taskId);
	try {
		const content = await readFile(path, "utf-8");
		const data = JSON.parse(content) as Task;
		// Basic validation
		if (!data.id || !data.subject || !data.status) return null;
		return data;
	} catch {
		return null;
	}
}

/**
 * Update a task. Merges partial updates into existing task.
 * Returns the updated task, or null if not found.
 */
export async function updateTask(
	agentDir: string,
	taskListId: string,
	taskId: string,
	updates: Partial<Omit<Task, "id">>,
): Promise<Task | null> {
	const existing = await getTask(agentDir, taskListId, taskId);
	if (!existing) return null;
	const updated: Task = { ...existing, ...updates, id: taskId };
	const path = getTaskPath(agentDir, taskListId, taskId);
	await atomicWriteJson(path, updated);
	notifyTasksUpdated();
	return updated;
}

/**
 * Delete a task. Updates high water mark to prevent ID reuse.
 * Also cleans up blocks/blockedBy references from other tasks.
 */
export async function deleteTask(
	agentDir: string,
	taskListId: string,
	taskId: string,
): Promise<boolean> {
	const path = getTaskPath(agentDir, taskListId, taskId);
	try {
		// Update high water mark before deleting
		const numericId = parseInt(taskId, 10);
		if (!isNaN(numericId)) {
			const currentMark = await readHighWaterMark(agentDir, taskListId);
			if (numericId > currentMark) {
				await writeHighWaterMark(agentDir, taskListId, numericId);
			}
		}

		await unlink(path);
		notifyTasksUpdated();

		// Clean up references from other tasks
		const allTasks = await listTasks(agentDir, taskListId);
		for (const task of allTasks) {
			const newBlocks = task.blocks.filter(id => id !== taskId);
			const newBlockedBy = task.blockedBy.filter(id => id !== taskId);
			if (newBlocks.length !== task.blocks.length || newBlockedBy.length !== task.blockedBy.length) {
				await updateTask(agentDir, taskListId, task.id, {
					blocks: newBlocks,
					blockedBy: newBlockedBy,
				});
			}
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * List all tasks in a task list.
 */
export async function listTasks(
	agentDir: string,
	taskListId: string,
): Promise<Task[]> {
	watchTaskList(agentDir, taskListId);
	const dir = getTasksDir(agentDir, taskListId);
	let files: string[];
	try {
		files = await readdir(dir);
	} catch {
		return [];
	}
	const taskIds = files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
	const results = await Promise.all(taskIds.map(id => getTask(agentDir, taskListId, id)));
	return results.filter((t): t is Task => t !== null);
}

/**
 * Add a block relationship: fromTask blocks toTask.
 */
export async function blockTask(
	agentDir: string,
	taskListId: string,
	fromTaskId: string,
	toTaskId: string,
): Promise<boolean> {
	const [fromTask, toTask] = await Promise.all([
		getTask(agentDir, taskListId, fromTaskId),
		getTask(agentDir, taskListId, toTaskId),
	]);
	if (!fromTask || !toTask) return false;

	if (!fromTask.blocks.includes(toTaskId)) {
		await updateTask(agentDir, taskListId, fromTaskId, {
			blocks: [...fromTask.blocks, toTaskId],
		});
	}
	if (!toTask.blockedBy.includes(fromTaskId)) {
		await updateTask(agentDir, taskListId, toTaskId, {
			blockedBy: [...toTask.blockedBy, fromTaskId],
		});
	}
	return true;
}

/**
 * Reset a task list - clears all tasks but preserves high water mark.
 */
export async function resetTaskList(
	agentDir: string,
	taskListId: string,
): Promise<void> {
	const dir = getTasksDir(agentDir, taskListId);
	// Save high water mark before clearing
	const currentHighest = await findHighestTaskIdFromFiles(agentDir, taskListId);
	if (currentHighest > 0) {
		const existingMark = await readHighWaterMark(agentDir, taskListId);
		if (currentHighest > existingMark) {
			await writeHighWaterMark(agentDir, taskListId, currentHighest);
		}
	}
	// Delete all task files
	let files: string[];
	try {
		files = await readdir(dir);
	} catch {
		return;
	}
	for (const file of files) {
		if (file.endsWith(".json") && !file.startsWith(".")) {
			await unlink(join(dir, file)).catch(() => {});
		}
	}
	notifyTasksUpdated();
}
