/**
 * [WHO]: Provides persistState, loadState, discoverActiveTasks, pruneStale, stateFilePathFor
 * [FROM]: Depends on node:fs, node:path, ./grub-feature-list, ./grub-types
 * [TO]: Consumed by ./grub-controller.ts and ./index.ts for cross-session persistence
 * [HERE]: extensions/builtin/grub/grub-persistence.ts - atomic JSON persistence for GrubTaskState under .grub/<id>/state.json
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isFeatureList } from "./grub-feature-list.js";
import {
	PERSISTED_GRUB_STATE_VERSION,
	type GrubDecision,
	type GrubTaskState,
	type PersistedGrubState,
} from "./grub-types.js";

const GRUB_ROOT_DIRNAME = ".grub";
const STATE_FILENAME = "state.json";
const DEFAULT_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const VALID_STATUSES = new Set(["running", "complete", "blocked", "stopped", "failed"]);
const VALID_PHASES = new Set(["initializer", "execution"]);
const VALID_LOCALES = new Set(["en", "zh"]);
const VALID_DECISIONS = new Set(["continue", "complete", "blocked"]);

export function grubRoot(cwd: string): string {
	return join(cwd, GRUB_ROOT_DIRNAME);
}

export function stateFilePathFor(harnessDirectory: string): string {
	return join(harnessDirectory, STATE_FILENAME);
}

function ensureDirectory(path: string): void {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true });
	}
}

function atomicWrite(path: string, payload: string): void {
	ensureDirectory(dirname(path));
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, payload, "utf-8");
	renameSync(tmp, path);
}

function isPersistedShape(value: unknown): value is PersistedGrubState {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (v.version !== PERSISTED_GRUB_STATE_VERSION) return false;
	if (!isFiniteNumber(v.createdAt) || !isFiniteNumber(v.lastPersistedAt)) return false;
	return isGrubTaskState(v.task);
}

function isGrubTaskState(value: unknown): value is GrubTaskState {
	if (!value || typeof value !== "object") return false;
	const task = value as Record<string, unknown>;
	if (!isNonEmptyString(task.id)) return false;
	if (!isNonEmptyString(task.goal)) return false;
	if (typeof task.locale !== "string" || !VALID_LOCALES.has(task.locale)) return false;
	if (typeof task.status !== "string" || !VALID_STATUSES.has(task.status)) return false;
	if (typeof task.phase !== "string" || !VALID_PHASES.has(task.phase)) return false;
	if (!isFiniteNumber(task.startedAt) || !isFiniteNumber(task.updatedAt)) return false;
	if (!isPositiveInteger(task.currentIteration)) return false;
	if (typeof task.awaitingTurn !== "boolean") return false;
	if (!isNonNegativeInteger(task.consecutiveFailures)) return false;
	if (!isPositiveInteger(task.maxIterations) || !isPositiveInteger(task.maxConsecutiveFailures)) return false;
	if (!isNonEmptyString(task.harnessDirectory)) return false;
	if (!isNonEmptyString(task.featureChecklistPath)) return false;
	if (!isNonEmptyString(task.featureListPath)) return false;
	if (!isNonEmptyString(task.stateFilePath)) return false;
	if (!isNonEmptyString(task.progressLogPath)) return false;
	if (!isNonEmptyString(task.initScriptPath)) return false;
	if (task.featureListBaseline !== undefined && !isFeatureList(task.featureListBaseline)) return false;
	if (task.lastDecision !== undefined && !isGrubDecision(task.lastDecision)) return false;
	if (task.lastError !== undefined && typeof task.lastError !== "string") return false;
	return true;
}

function isGrubDecision(value: unknown): value is GrubDecision {
	if (!value || typeof value !== "object") return false;
	const decision = value as Record<string, unknown>;
	if (typeof decision.status !== "string" || !VALID_DECISIONS.has(decision.status)) return false;
	if (typeof decision.summary !== "string") return false;
	if (decision.nextStep !== undefined && typeof decision.nextStep !== "string") return false;
	return true;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isInteger(value) && typeof value === "number" && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

export function persistState(task: GrubTaskState, createdAt?: number): void {
	const now = Date.now();
	const payload: PersistedGrubState = {
		version: PERSISTED_GRUB_STATE_VERSION,
		task,
		createdAt: createdAt ?? task.startedAt ?? now,
		lastPersistedAt: now,
	};
	atomicWrite(task.stateFilePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function loadState(stateFilePath: string): PersistedGrubState | null {
	if (!existsSync(stateFilePath)) return null;
	try {
		const raw = readFileSync(stateFilePath, "utf-8");
		const parsed: unknown = JSON.parse(raw);
		if (!isPersistedShape(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Scan every ".grub/<id>/state.json" under cwd and return each persisted
 * record whose task.status is "running". Invalid or unreadable files are
 * skipped silently.
 */
export function discoverActiveTasks(cwd: string): PersistedGrubState[] {
	const root = grubRoot(cwd);
	if (!existsSync(root)) return [];
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return [];
	}
	const results: PersistedGrubState[] = [];
	for (const entry of entries) {
		const harnessDir = join(root, entry);
		let isDir = false;
		try {
			isDir = statSync(harnessDir).isDirectory();
		} catch {
			isDir = false;
		}
		if (!isDir) continue;
		const statePath = stateFilePathFor(harnessDir);
		const persisted = loadState(statePath);
		if (!persisted) continue;
		if (persisted.task.status !== "running") continue;
		results.push(persisted);
	}
	results.sort((a, b) => b.lastPersistedAt - a.lastPersistedAt);
	return results;
}

/**
 * Remove ".grub/<id>/" directories whose state is terminal and older than
 * maxAgeMs. Returns the number of directories pruned. Missing or malformed
 * state files are treated as expired regardless of age to avoid orphans.
 */
export function pruneStale(cwd: string, maxAgeMs: number = DEFAULT_STALE_MS): number {
	const root = grubRoot(cwd);
	if (!existsSync(root)) return 0;
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return 0;
	}
	const now = Date.now();
	let removed = 0;
	for (const entry of entries) {
		const harnessDir = join(root, entry);
		let isDir = false;
		try {
			isDir = statSync(harnessDir).isDirectory();
		} catch {
			isDir = false;
		}
		if (!isDir) continue;
		const statePath = stateFilePathFor(harnessDir);
		const persisted = loadState(statePath);
		if (persisted && persisted.task.status === "running") continue;
		const referenceTime = persisted ? persisted.lastPersistedAt : safeMtimeMs(harnessDir);
		if (referenceTime === null) continue;
		if (now - referenceTime < maxAgeMs) continue;
		try {
			rmSync(harnessDir, { recursive: true, force: true });
			removed += 1;
		} catch {
			// best effort
		}
	}
	return removed;
}

function safeMtimeMs(path: string): number | null {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return null;
	}
}
