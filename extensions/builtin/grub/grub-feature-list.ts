/**
 * [WHO]: Provides readFeatureList, writeFeatureList, isFeatureList, validateFeatureListDiff, sanitizeInitializerFeatureList, InitializerSanitizeResult, countPassing, allPassing, firstPending, createInitialFeatureList, migrateChecklistToFeatureList, FeatureListDiffError
 * [FROM]: Depends on node:fs, node:path, ./grub-types
 * [TO]: Consumed by ./grub-controller.ts, ./index.ts for structured feature tracking
 * [HERE]: extensions/builtin/grub/grub-feature-list.ts - JSON feature list IO with diff validation that limits agent mutations to passes/evidence fields
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	FEATURE_LIST_VERSION,
	type FeatureCategory,
	type FeatureItem,
	type FeatureList,
} from "./grub-types.js";

const VALID_CATEGORIES: ReadonlySet<FeatureCategory> = new Set(["functional", "verification", "polish"]);

export class FeatureListDiffError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FeatureListDiffError";
	}
}

function isFeatureItem(value: unknown): value is FeatureItem {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (typeof v.id !== "string" || !v.id) return false;
	if (typeof v.description !== "string" || !v.description) return false;
	if (typeof v.category !== "string" || !VALID_CATEGORIES.has(v.category as FeatureCategory)) return false;
	if (!Array.isArray(v.steps) || !v.steps.every((s) => typeof s === "string")) return false;
	if (typeof v.passes !== "boolean") return false;
	if (v.evidence !== undefined && typeof v.evidence !== "string") return false;
	return true;
}

export function isFeatureList(value: unknown): value is FeatureList {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (v.version !== FEATURE_LIST_VERSION) return false;
	if (typeof v.goal !== "string") return false;
	if (!Array.isArray(v.features)) return false;
	return v.features.every(isFeatureItem);
}

export function readFeatureList(path: string): FeatureList | null {
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed: unknown = JSON.parse(raw);
		if (!isFeatureList(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function writeFeatureList(path: string, list: FeatureList): void {
	if (!isFeatureList(list)) {
		throw new FeatureListDiffError("Refusing to write invalid feature list shape.");
	}
	const serialized = `${JSON.stringify(list, null, 2)}\n`;
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, serialized, "utf-8");
	renameSync(tmp, path);
}

/**
 * Validates that a mutated feature list only differs from the baseline in
 * per-item `passes` and `evidence` fields. Returns the validated list (or
 * throws FeatureListDiffError). If the agent reordered, added, or removed
 * entries, that counts as a violation.
 */
export function validateFeatureListDiff(before: FeatureList, after: FeatureList): FeatureList {
	if (after.version !== before.version) {
		throw new FeatureListDiffError(`version changed from ${before.version} to ${after.version}`);
	}
	if (after.goal !== before.goal) {
		throw new FeatureListDiffError("goal field is immutable");
	}
	if (after.features.length !== before.features.length) {
		throw new FeatureListDiffError(
			`feature count changed (${before.features.length} -> ${after.features.length}); agent may not add or remove features`,
		);
	}
	const byId = new Map(before.features.map((f) => [f.id, f]));
	const seen = new Set<string>();
	for (let index = 0; index < after.features.length; index += 1) {
		const afterItem = after.features[index];
		const beforeAtIndex = before.features[index];
		if (seen.has(afterItem.id)) {
			throw new FeatureListDiffError(`duplicate feature id ${afterItem.id}`);
		}
		seen.add(afterItem.id);
		if (beforeAtIndex?.id !== afterItem.id) {
			throw new FeatureListDiffError(`feature order changed at index ${index}`);
		}
		const beforeItem = byId.get(afterItem.id);
		if (!beforeItem) {
			throw new FeatureListDiffError(`unknown feature id ${afterItem.id}`);
		}
		if (afterItem.description !== beforeItem.description) {
			throw new FeatureListDiffError(`description for ${afterItem.id} is immutable`);
		}
		if (afterItem.category !== beforeItem.category) {
			throw new FeatureListDiffError(`category for ${afterItem.id} is immutable`);
		}
		if (afterItem.steps.length !== beforeItem.steps.length) {
			throw new FeatureListDiffError(`steps for ${afterItem.id} must not change length`);
		}
		for (let i = 0; i < afterItem.steps.length; i += 1) {
			if (afterItem.steps[i] !== beforeItem.steps[i]) {
				throw new FeatureListDiffError(`steps[${i}] for ${afterItem.id} is immutable`);
			}
		}
	}
	return after;
}

export interface InitializerSanitizeResult {
	list: FeatureList;
	/** Human-readable tags describing what was auto-corrected, e.g. ["goal", "passes×6"]. */
	fixes: string[];
}

/**
 * Bring an initializer-produced feature list into a clean, executable baseline.
 *
 * The initializer's sole job is to stand up a harness; the `goal`, `passes`,
 * and `evidence` fields are either authoritative-from-elsewhere or
 * not-yet-earned. Rather than failing the whole turn over these recoverable
 * hygiene issues (which would also block the initializer→execution phase
 * transition), we auto-correct them: overwrite `goal` with the authoritative
 * task goal, force every `passes` to false, and drop stray `evidence`. Returns
 * the sanitized list plus a list of what was corrected so callers can surface
 * a friendly note instead of a hard error.
 */
export function sanitizeInitializerFeatureList(list: FeatureList, authoritativeGoal: string): InitializerSanitizeResult {
	const fixes: string[] = [];
	if (list.goal !== authoritativeGoal) {
		fixes.push("goal");
	}
	let prelistedPasses = 0;
	let strayEvidence = 0;
	const features = list.features.map((feature) => {
		const next: FeatureItem = { ...feature, steps: [...feature.steps] };
		if (next.passes) {
			next.passes = false;
			prelistedPasses += 1;
		}
		if (next.evidence !== undefined) {
			delete next.evidence;
			strayEvidence += 1;
		}
		return next;
	});
	if (prelistedPasses > 0) fixes.push(`passes×${prelistedPasses}`);
	if (strayEvidence > 0) fixes.push(`evidence×${strayEvidence}`);
	return {
		list: { version: list.version, goal: authoritativeGoal, features },
		fixes,
	};
}

export function countPassing(list: FeatureList): number {
	return list.features.reduce((acc, f) => acc + (f.passes ? 1 : 0), 0);
}

export function allPassing(list: FeatureList): boolean {
	return list.features.length > 0 && list.features.every((f) => f.passes);
}

export function firstPending(list: FeatureList): FeatureItem | undefined {
	return list.features.find((f) => !f.passes);
}

/**
 * Produce an initial feature list skeleton for a new grub task. The
 * initializer agent is expected to replace this placeholder with 15-40
 * concrete feature entries in its first turn, preserving the schema.
 */
export function createInitialFeatureList(goal: string): FeatureList {
	return {
		version: FEATURE_LIST_VERSION,
		goal,
		features: [
			{
				id: "placeholder-expand-features",
				category: "functional",
				description:
					"Initializer must replace this placeholder with 15-40 concrete, end-to-end testable features.",
				steps: [
					"Read the goal carefully",
					"Enumerate atomic user-observable behaviors",
					"Rewrite this file with proper features[] entries",
				],
				passes: false,
			},
		],
	};
}

/**
 * Migrate a legacy feature-checklist.md (one checkbox per line) into the new
 * feature-list.json format. Extremely lossy by design: we only copy line
 * descriptions; category defaults to functional and steps is left empty so
 * the initializer can refine later.
 */
export function migrateChecklistToFeatureList(checklistPath: string, goal: string): FeatureList | null {
	if (!existsSync(checklistPath)) return null;
	let raw: string;
	try {
		raw = readFileSync(checklistPath, "utf-8");
	} catch {
		return null;
	}
	const features: FeatureItem[] = [];
	const checkboxRegex = /^\s*-\s*\[( |x|X)\]\s*(.+?)\s*$/;
	const lines = raw.split(/\r?\n/);
	let index = 0;
	for (const line of lines) {
		const match = checkboxRegex.exec(line);
		if (!match) continue;
		const [, mark, description] = match;
		if (!description) continue;
		index += 1;
		features.push({
			id: `migrated-${index}`,
			category: "functional",
			description,
			steps: [],
			passes: mark === "x" || mark === "X",
		});
	}
	if (features.length === 0) return null;
	return {
		version: FEATURE_LIST_VERSION,
		goal,
		features,
	};
}

/**
 * Convenience: return the feature list path that sits alongside a checklist
 * markdown file. Pure path logic so callers don't have to repeat it.
 */
export function defaultFeatureListPath(harnessDirectory: string): string {
	return join(harnessDirectory, "feature-list.json");
}

export function ensureParentDirectory(path: string): void {
	const parent = dirname(path);
	if (!existsSync(parent)) {
		// Lazy import to keep this module lightweight when dir already exists.
		// Callers in grub/index.ts already mkdir the harness directory; this is
		// a defensive fallback for standalone usage.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fs = require("node:fs") as typeof import("node:fs");
		fs.mkdirSync(parent, { recursive: true });
	}
}
