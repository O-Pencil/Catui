/**
 * [WHO]: Task store - CRUD operations with disk persistence
 * [FROM]: Inspired by Claude Code utils/tasks.ts
 * [TO]: Consumed by all task tools
 * [HERE]: extensions/builtin/task/task-store.ts - task state management with atomic file writes
 */

import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Task, TaskStatus } from "./task-types.js";
import { sanitizePathComponent, DEFAULT_TASK_LIST_ID } from "./task-types.js";

// ============================================================================
// Path helpers
// ============================================================================

const HIGH_WATER_MARK_FILE = ".highwatermark";

export function getTasksDir(agentDir: string, taskListId: string = DEFAULT_TASK_LIST_ID): string {
	return join(agentDir, "tasks", sanitizePathComponent(taskListId));
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
	const highestId = await findHighestTaskId(agentDir, taskListId);
	const id = String(highestId + 1);
	const task: Task = { id, ...taskData };
	const path = getTaskPath(agentDir, taskListId, id);
	await atomicWriteJson(path, task);
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
}
