/**
 * [WHO]: Deterministic shadow/guarded review policy, conservative budgets, and atomic automation state
 * [FROM]: Depends on Node fs/path and evolution path confinement
 * [TO]: Consumed by the optional evolution extension lifecycle hooks and mode/status commands
 * [HERE]: extensions/optional/evolution/automation.ts - automatic review policy authority
 */
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { assertNoSymlinkComponents } from "./paths.js";

export const EVOLUTION_MODES = ["off", "manual", "shadow", "guarded"] as const;
export type EvolutionMode = (typeof EVOLUTION_MODES)[number];

export interface AutomationPolicy {
	turnInterval: number;
	cooldownMs: number;
	dailyTokenBudget: number;
	dailyCostBudgetUsd: number;
	estimatedTokensPerReview: number;
	estimatedCostPerReviewUsd: number;
	maxTriggerFingerprints: number;
}

export interface AutomationState {
	schemaVersion: 1;
	mode: EvolutionMode;
	promotionScope: "session" | "workspace";
	usageDay: string;
	tokensUsed: number;
	costUsedUsd: number;
	lastReviewAt?: number;
	triggerFingerprints: string[];
}

export type AutomationTrigger =
	| { type: "turn"; turnIndex: number; fingerprint: string }
	| { type: "compaction"; fingerprint: string };

export type ReviewDecision =
	| { review: true }
	| { review: false; reason: "mode" | "interval" | "duplicate" | "cooldown" | "budget" };

export const DEFAULT_AUTOMATION_POLICY: Readonly<AutomationPolicy> = {
	turnInterval: 25,
	cooldownMs: 20 * 60 * 1_000,
	dailyTokenBudget: 40_000,
	dailyCostBudgetUsd: 2,
	estimatedTokensPerReview: 8_000,
	estimatedCostPerReviewUsd: 0.4,
	maxTriggerFingerprints: 128,
};

function utcDay(now: number): string {
	return new Date(now).toISOString().slice(0, 10);
}

export function defaultAutomationState(now = Date.now()): AutomationState {
	return {
		schemaVersion: 1,
		mode: "manual",
		promotionScope: "session",
		usageDay: utcDay(now),
		tokensUsed: 0,
		costUsedUsd: 0,
		triggerFingerprints: [],
	};
}

function usageForDay(state: AutomationState, now: number): { tokens: number; cost: number } {
	return state.usageDay === utcDay(now)
		? { tokens: state.tokensUsed, cost: state.costUsedUsd }
		: { tokens: 0, cost: 0 };
}

export function shouldReview(
	trigger: AutomationTrigger,
	state: AutomationState,
	policy: AutomationPolicy,
	now = Date.now(),
): ReviewDecision {
	if (state.mode === "off" || state.mode === "manual") return { review: false, reason: "mode" };
	if (trigger.type === "turn" && (trigger.turnIndex < 1 || trigger.turnIndex % policy.turnInterval !== 0)) {
		return { review: false, reason: "interval" };
	}
	if (state.triggerFingerprints.includes(trigger.fingerprint)) return { review: false, reason: "duplicate" };
	if (state.lastReviewAt !== undefined && now - state.lastReviewAt < policy.cooldownMs) return { review: false, reason: "cooldown" };
	const usage = usageForDay(state, now);
	if (
		usage.tokens + policy.estimatedTokensPerReview > policy.dailyTokenBudget
		|| usage.cost + policy.estimatedCostPerReviewUsd > policy.dailyCostBudgetUsd
	) {
		return { review: false, reason: "budget" };
	}
	return { review: true };
}

export function recordAutomationReview(
	state: AutomationState,
	trigger: Pick<AutomationTrigger, "fingerprint">,
	policy: AutomationPolicy,
	now = Date.now(),
): AutomationState {
	const currentDay = utcDay(now);
	const usage = usageForDay(state, now);
	return {
		...state,
		usageDay: currentDay,
		tokensUsed: usage.tokens + policy.estimatedTokensPerReview,
		costUsedUsd: usage.cost + policy.estimatedCostPerReviewUsd,
		lastReviewAt: now,
		triggerFingerprints: [...state.triggerFingerprints, trigger.fingerprint].slice(-policy.maxTriggerFingerprints),
	};
}

function automationPath(agentDir: string): string {
	return resolve(agentDir, "evolution", "v1", "automation.json");
}

function isMode(value: unknown): value is EvolutionMode {
	return typeof value === "string" && EVOLUTION_MODES.includes(value as EvolutionMode);
}

function parseAutomationState(value: unknown): AutomationState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Automation state must be an object");
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 1 || !isMode(record.mode)) throw new Error("Automation state version or mode is invalid");
	if (record.promotionScope !== "session" && record.promotionScope !== "workspace") throw new Error("Automation promotion scope is invalid");
	if (typeof record.usageDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.usageDay)) throw new Error("Automation usage day is invalid");
	if (typeof record.tokensUsed !== "number" || !Number.isInteger(record.tokensUsed) || record.tokensUsed < 0) throw new Error("Automation token usage is invalid");
	if (typeof record.costUsedUsd !== "number" || !Number.isFinite(record.costUsedUsd) || record.costUsedUsd < 0) throw new Error("Automation cost usage is invalid");
	if (record.lastReviewAt !== undefined && (typeof record.lastReviewAt !== "number" || !Number.isFinite(record.lastReviewAt))) throw new Error("Automation last review time is invalid");
	if (!Array.isArray(record.triggerFingerprints) || !record.triggerFingerprints.every((item) => typeof item === "string" && item.length <= 200)) {
		throw new Error("Automation trigger history is invalid");
	}
	return value as AutomationState;
}

export async function loadAutomationState(agentDir: string, now = Date.now()): Promise<AutomationState> {
	const path = automationPath(agentDir);
	await assertNoSymlinkComponents(agentDir, path);
	try {
		if ((await stat(path)).size > 64 * 1_024) throw new Error("Automation state exceeds the file-size limit");
		return parseAutomationState(JSON.parse(await readFile(path, "utf8")) as unknown);
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultAutomationState(now);
		throw error;
	}
}

export async function saveAutomationState(agentDir: string, state: AutomationState): Promise<void> {
	parseAutomationState(state);
	const path = automationPath(agentDir);
	const directory = dirname(path);
	await assertNoSymlinkComponents(agentDir, directory);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await assertNoSymlinkComponents(agentDir, path);
	const temporary = join(directory, `.automation.${process.pid}.${randomUUID()}.tmp`);
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
	} finally {
		await handle.close();
	}
	try {
		await rename(temporary, path);
	} catch (error: unknown) {
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
}

async function withAutomationLock<T>(agentDir: string, task: () => Promise<T>): Promise<T> {
	const path = automationPath(agentDir);
	const directory = dirname(path);
	await assertNoSymlinkComponents(agentDir, directory);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const lockPath = join(directory, ".automation.lock");
	await assertNoSymlinkComponents(agentDir, lockPath);
	const handle = await open(lockPath, "wx", 0o600).catch((error: unknown) => {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Automation state is busy; review skipped");
		throw error;
	});
	await handle.close();
	try {
		return await task();
	} finally {
		await unlink(lockPath).catch(() => undefined);
	}
}

export async function updateAutomationState(
	agentDir: string,
	update: (state: AutomationState) => AutomationState,
	now = Date.now(),
): Promise<AutomationState> {
	return withAutomationLock(agentDir, async () => {
		const next = update(await loadAutomationState(agentDir, now));
		await saveAutomationState(agentDir, next);
		return next;
	});
}

export async function reserveAutomationReview(
	agentDir: string,
	trigger: AutomationTrigger,
	policy: AutomationPolicy,
	now = Date.now(),
): Promise<{ reserved: boolean; state: AutomationState }> {
	return withAutomationLock(agentDir, async () => {
		const state = await loadAutomationState(agentDir, now);
		if (!shouldReview(trigger, state, policy, now).review) return { reserved: false, state };
		const next = recordAutomationReview(state, trigger, policy, now);
		await saveAutomationState(agentDir, next);
		return { reserved: true, state: next };
	});
}

export async function runWithGuardedAuthorization<T>(
	agentDir: string,
	scope: AutomationState["promotionScope"],
	task: () => Promise<T>,
): Promise<T | undefined> {
	return withAutomationLock(agentDir, async () => {
		const state = await loadAutomationState(agentDir);
		if (state.mode !== "guarded" || state.promotionScope !== scope) return undefined;
		return task();
	});
}
