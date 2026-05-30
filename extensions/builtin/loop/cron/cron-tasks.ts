/**
 * [WHO]: Unified cron task storage: session-only and durable file-backed tasks
 * [FROM]: Depends on node:crypto, node:fs, node:path, ./cron-parser, ./cron-types
 * [TO]: Consumed by cron-scheduler.ts, cron tools, loop extension
 * [HERE]: extensions/builtin/loop/cron/cron-tasks.ts - single source of truth for all cron tasks
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { parseCronExpression, nextCronRunMs } from "./cron-parser.js";
import type { CronTask, CronTaskCreateParams, CronTaskCreateResult } from "./cron-types.js";
import { MAX_CRON_TASKS } from "./cron-types.js";

// ============================================================================
// Session-only task store (in-memory)
// ============================================================================

const sessionTasks = new Map<string, CronTask>();

/**
 * Add a task to session-only store.
 * Task is lost when process exits.
 */
export function addSessionCronTask(task: CronTask): void {
	sessionTasks.set(task.id, task);
}

/**
 * Get all session-only tasks.
 * Returns a copy to prevent mutation.
 */
export function getSessionCronTasks(): CronTask[] {
	return [...sessionTasks.values()];
}

/**
 * Get a single session task by ID.
 */
export function getSessionCronTask(id: string): CronTask | undefined {
	return sessionTasks.get(id);
}

/**
 * Update a session task in place.
 */
export function updateSessionCronTask(task: CronTask): void {
	sessionTasks.set(task.id, task);
}

/**
 * Remove session-only tasks by ID.
 */
export function removeSessionCronTasks(ids: string[]): void {
	for (const id of ids) sessionTasks.delete(id);
}

/**
 * Clear all session-only tasks.
 * Returns count of removed tasks.
 */
export function clearSessionCronTasks(): number {
	const count = sessionTasks.size;
	sessionTasks.clear();
	return count;
}

// ============================================================================
// Durable task storage (file-backed)
// ============================================================================

const CRON_FILE_REL = ".nanopencil/cron-tasks.json";

/**
 * Get the path to the durable cron tasks file.
 */
export function getCronFilePath(root: string): string {
	return join(root, CRON_FILE_REL);
}

/**
 * Read durable cron tasks from the agent directory.
 * Returns empty array on any error (file not found, JSON malformed, etc.).
 * Validates each task and skips invalid ones.
 *
 * When `legacyCwd` is provided and no tasks are found in `projectRoot`,
 * attempts to migrate tasks from the legacy `{legacyCwd}/.nanopencil/` location.
 */
export async function readCronTasks(projectRoot: string, legacyCwd?: string): Promise<CronTask[]> {
	try {
		const filePath = join(projectRoot, CRON_FILE_REL);
		const content = await fs.readFile(filePath, "utf-8");

		if (!content.trim()) return [];

		const parsed = JSON.parse(content) as unknown;

		// Must be { tasks: [...] } or [...]
		let rawTasks: unknown[];
		if (Array.isArray(parsed)) {
			rawTasks = parsed;
		} else if (typeof parsed === "object" && parsed !== null && "tasks" in parsed) {
			rawTasks = (parsed as { tasks: unknown[] }).tasks;
			if (!Array.isArray(rawTasks)) return [];
		} else {
			return [];
		}

		const validTasks: CronTask[] = [];
		for (const item of rawTasks) {
			const task = validateCronTask(item);
			if (task) validTasks.push(task);
		}

		return validTasks;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			console.error("[Cron-Tasks] Error reading tasks file:", error);
		}

		// Migration: check legacy cwd path for existing tasks
		if (legacyCwd && (error as NodeJS.ErrnoException).code === "ENOENT") {
			return tryMigrateLegacyTasks(projectRoot, legacyCwd);
		}

		return [];
	}
}

/**
 * Attempt to migrate tasks from legacy {cwd}/.nanopencil/ to {agentDir}/.nanopencil/.
 * Returns migrated tasks on success, empty array otherwise.
 */
async function tryMigrateLegacyTasks(agentDir: string, legacyCwd: string): Promise<CronTask[]> {
	const legacyPath = join(legacyCwd, CRON_FILE_REL);
	try {
		const content = await fs.readFile(legacyPath, "utf-8");
		if (!content.trim()) return [];

		const parsed = JSON.parse(content) as unknown;
		let rawTasks: unknown[];
		if (Array.isArray(parsed)) {
			rawTasks = parsed;
		} else if (typeof parsed === "object" && parsed !== null && "tasks" in parsed) {
			rawTasks = (parsed as { tasks: unknown[] }).tasks;
			if (!Array.isArray(rawTasks)) return [];
		} else {
			return [];
		}

		const validTasks: CronTask[] = [];
		for (const item of rawTasks) {
			const task = validateCronTask(item);
			if (task) validTasks.push(task);
		}

		if (validTasks.length > 0) {
			await writeCronTasks(agentDir, validTasks);
			console.log(`[Cron-Tasks] Migrated ${validTasks.length} task(s) from legacy path to ${agentDir}`);
		}

		return validTasks;
	} catch {
		return [];
	}
}

/**
 * Validate a single task object.
 * Returns the task if valid, null if invalid.
 */
function validateCronTask(item: unknown): CronTask | null {
	if (typeof item !== "object" || item === null) return null;

	const task = item as Partial<CronTask>;

	// Required fields
	if (
		typeof task.id !== "string" ||
		typeof task.cron !== "string" ||
		typeof task.prompt !== "string" ||
		typeof task.createdAt !== "number"
	) {
		return null;
	}

	// Validate cron expression
	if (!parseCronExpression(task.cron)) {
		return null;
	}

	return {
		id: task.id,
		cron: task.cron,
		prompt: task.prompt,
		createdAt: task.createdAt,
		lastFiredAt: typeof task.lastFiredAt === "number" ? task.lastFiredAt : undefined,
		recurring: task.recurring ?? true,
		permanent: task.permanent ?? false,
		durable: true,
		agentId: typeof task.agentId === "string" ? task.agentId : undefined,
		name: typeof task.name === "string" ? task.name : undefined,
		maxRuns: typeof task.maxRuns === "number" ? task.maxRuns : undefined,
		quiet: task.quiet === true,
		paused: task.paused === true,
		lastError: typeof task.lastError === "string" ? task.lastError : undefined,
		lastOutputSnippet: typeof task.lastOutputSnippet === "string" ? task.lastOutputSnippet : undefined,
	};
}

/**
 * Write durable cron tasks to the project directory.
 * Creates the .nanopencil directory if it doesn't exist.
 * Removes runtime-only fields (pending) before writing.
 */
export async function writeCronTasks(projectRoot: string, tasks: CronTask[]): Promise<void> {
	try {
		const dirPath = join(projectRoot, ".nanopencil");
		const filePath = join(projectRoot, CRON_FILE_REL);

		await fs.mkdir(dirPath, { recursive: true });

		// Remove runtime-only fields
		const toWrite = tasks.map(({ id, cron, prompt, createdAt, lastFiredAt, recurring, permanent, agentId, name, maxRuns, quiet, paused, lastError, lastOutputSnippet }) => ({
			id,
			cron,
			prompt,
			createdAt,
			lastFiredAt,
			recurring,
			permanent,
			agentId,
			name,
			maxRuns,
			quiet,
			paused,
			lastError,
			lastOutputSnippet,
		}));

		const content = JSON.stringify({ tasks: toWrite }, null, 2) + "\n";
		await fs.writeFile(filePath, content, "utf-8");
	} catch (error) {
		console.error("[Cron-Tasks] Error writing tasks file:", error);
		throw error;
	}
}

// ============================================================================
// Unified task operations (session + durable)
// ============================================================================

/**
 * Create a new cron task.
 * Adds to session store if durable=false, or to file if durable=true.
 *
 * Validates:
 * 1. cron expression is valid
 * 2. next fire time exists within 1 year
 * 3. total task count < MAX_CRON_TASKS
 */
export async function addCronTask(
	projectRoot: string | undefined,
	params: CronTaskCreateParams,
): Promise<CronTaskCreateResult> {
	// Validate cron
	if (!parseCronExpression(params.cron)) {
		throw new Error("Invalid cron expression.");
	}

	// Validate next fire time exists
	const nextFire = nextCronRunMs(params.cron, Date.now());
	if (nextFire === null) {
		throw new Error("No future run time found within 1 year for this cron expression.");
	}

	// Count total tasks
	const sessionCount = sessionTasks.size;
	let fileCount = 0;
	if (params.durable && projectRoot) {
		const fileTasks = await readCronTasks(projectRoot);
		fileCount = fileTasks.length;
	}

	if (sessionCount + fileCount >= MAX_CRON_TASKS) {
		throw new Error(`Maximum ${MAX_CRON_TASKS} cron tasks reached.`);
	}

	const id = randomUUID().slice(0, 8);
	const task: CronTask = {
		id,
		cron: params.cron,
		prompt: params.prompt,
		createdAt: Date.now(),
		recurring: params.recurring ?? true,
		durable: params.durable ?? false,
		agentId: params.agentId,
		name: params.name,
		maxRuns: params.maxRuns,
		quiet: params.quiet ?? false,
		pending: false,
		paused: false,
		runCount: 0,
	};

	if (!task.durable) {
		addSessionCronTask(task);
	} else {
		if (!projectRoot) {
			throw new Error("Project root required for durable tasks.");
		}
		const existing = await readCronTasks(projectRoot);
		existing.push(task);
		await writeCronTasks(projectRoot, existing);
	}

	const humanSchedule = describeSchedule(task.cron);

	return {
		id,
		recurring: task.recurring ?? true,
		durable: task.durable ?? false,
		humanSchedule,
	};
}

/**
 * Delete a cron task by ID.
 * Removes from both session store and durable file.
 * Returns true if found and deleted.
 */
export async function deleteCronTask(projectRoot: string | undefined, id: string): Promise<boolean> {
	let found = false;

	// Remove from session store
	if (sessionTasks.has(id)) {
		sessionTasks.delete(id);
		found = true;
	}

	// Remove from durable file
	if (projectRoot) {
		const tasks = await readCronTasks(projectRoot);
		const filtered = tasks.filter((t) => t.id !== id);
		if (filtered.length < tasks.length) {
			found = true;
			await writeCronTasks(projectRoot, filtered);
		}
	}

	return found;
}

/**
 * List all cron tasks (session + durable).
 */
export async function listCronTasks(projectRoot: string | undefined): Promise<CronTask[]> {
	const session = getSessionCronTasks();
	if (!projectRoot) return session;

	const durable = await readCronTasks(projectRoot);
	// Merge: session tasks take precedence on ID collision
	const byId = new Map<string, CronTask>();
	for (const t of durable) byId.set(t.id, t);
	for (const t of session) byId.set(t.id, t);
	return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get a task by ID from any store.
 */
export async function getCronTask(projectRoot: string | undefined, id: string): Promise<CronTask | undefined> {
	// Check session first
	const session = getSessionCronTask(id);
	if (session) return session;

	// Check durable
	if (projectRoot) {
		const durable = await readCronTasks(projectRoot);
		return durable.find((t) => t.id === id);
	}

	return undefined;
}

/**
 * Update a task (e.g., mark lastFiredAt, update paused state).
 * Handles both session and durable stores.
 */
export async function updateCronTask(
	projectRoot: string | undefined,
	updatedTask: CronTask,
): Promise<boolean> {
	if (!updatedTask.durable) {
		// Session-only
		if (sessionTasks.has(updatedTask.id)) {
			updateSessionCronTask(updatedTask);
			return true;
		}
		return false;
	}

	// Durable
	if (!projectRoot) return false;
	const tasks = await readCronTasks(projectRoot);
	const index = tasks.findIndex((t) => t.id === updatedTask.id);
	if (index === -1) return false;

	tasks[index] = updatedTask;
	await writeCronTasks(projectRoot, tasks);

	// Also update session mirror
	updateSessionCronTask(updatedTask);
	return true;
}

/**
 * Mark durable recurring tasks as fired.
 * Updates lastFiredAt for each task ID and persists to disk.
 */
export async function markCronTasksFired(projectRoot: string, ids: string[], firedAt: number): Promise<void> {
	const tasks = await readCronTasks(projectRoot);
	for (const task of tasks) {
		if (ids.includes(task.id)) {
			task.lastFiredAt = firedAt;
		}
	}
	await writeCronTasks(projectRoot, tasks);

	// Update session mirror
	for (const task of tasks) {
		if (ids.includes(task.id)) {
			updateSessionCronTask(task);
		}
	}
}

/**
 * Generate a human-readable description of a cron schedule.
 */
function describeSchedule(cron: string): string {
	const parsed = parseCronExpression(cron);
	if (!parsed) return cron;

	const cronStr = cron.trim();

	const everyMinMatch = cronStr.match(/^\*\/(\d+) \* \* \* \*$/);
	if (everyMinMatch) {
		const n = Number.parseInt(everyMinMatch[1]!, 10);
		return n === 1 ? "every minute" : `every ${n} minutes`;
	}

	const everyHourMatch = cronStr.match(/^0 \*\/(\d+) \* \* \*$/);
	if (everyHourMatch) {
		const n = Number.parseInt(everyHourMatch[1]!, 10);
		return n === 1 ? "every hour" : `every ${n} hours`;
	}

	if (cronStr === "0 0 * * *") return "daily at midnight";

	const everyDayMatch = cronStr.match(/^0 0 \*\/(\d+) \* \*$/);
	if (everyDayMatch) {
		const n = Number.parseInt(everyDayMatch[1]!, 10);
		return n === 1 ? "daily at midnight" : `every ${n} days at midnight`;
	}

	const specificTimeMatch = cronStr.match(/^0 (\d+) \* \* \*$/);
	if (specificTimeMatch) {
		const h = Number.parseInt(specificTimeMatch[1]!, 10);
		const ampm = h >= 12 ? "PM" : "AM";
		const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
		return `daily at ${hour12}:00 ${ampm}`;
	}

	return cron;
}
