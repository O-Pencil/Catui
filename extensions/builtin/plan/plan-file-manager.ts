/**
 * [WHO]: PlanFileManager class, getPlansDirectory(), getPlanFilePath(), getPlan(), getPlanSlug()
 * [FROM]: Depends on node:fs, node:path, node:os, node:crypto, proper-lockfile, core/extensions-host/types (EventBus)
 * [TO]: Consumed by plan extension tools, workflow prompts, permission gating
 * [HERE]: extensions/builtin/plan/plan-file-manager.ts - plan file path management and I/O
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
	PLAN_CUSTOM_TYPE,
	type PlanSessionState,
	type PlanStateEntryData,
	type PlanStateMap,
} from "./types.js";
import type { SessionEntry } from "../../../core/session/session-manager.js";

// ============================================================================
// Word lists for slug generation
// ============================================================================

const ADJECTIVES = [
	"gentle", "swift", "bright", "calm", "deep", "eager", "fair", "grand",
	"keen", "light", "bold", "warm", "wise", "free", "pure", "rich",
	"safe", "sure", "tall", "vast", "wild", "zany", "noble", "proud",
	"brave", "clever", "daring", "elegant", "fierce", "graceful", "humble",
	"nimble", "rapid", "sharp", "silent", "solid", "steady", "strong",
	"subtle", "super", "vivid", "witty", "active", "agile", "ample",
	"brisk", "cosmic", "curious", "digital", "distant", "divine", "epic",
	"famous", "fancy", "flying", "galactic", "golden", "happy", "holy",
	"huge", "jolly", "jumpy", "lively", "lucky", "magic", "major",
	"merry", "mighty", "modern", "mystic", "native", "orange", "peaceful",
	"perfect", "pink", "polar", "polite", "prime", "purple", "quick",
	"quiet", "random", "rare", "real", "red", "royal", "sacred",
	"shiny", "simple", "sleek", "smart", "smooth", "soft", "sparse",
	"speedy", "stellar", "sunny", "sweet", "tender", "tiny", "top",
	"ultra", "unique", "urban", "vital", "white", "wonder", "young",
];

const NOUNS = [
	"engelbart", "hopper", "lovelace", "turing", "knuth", "dijkstra",
	"pascal", "bayes", "fourier", "gauss", "hilbert", "neumann",
	"boole", "shannon", "pearl", "minsky", "mccarthy", "ritchie",
	"thompson", "torvalds", "berners-lee", "hamilton", "lampson",
	"kay", "gosling", "wall", "matz", "ikea", "nova",
	"echo", "flux", "prism", "orbit", "pulse", "spark",
	"drift", "crest", "peak", "tide", "wave", "breeze",
	"stone", "forge", "bridge", "canyon", "delta", "ember",
	"falcon", "grove", "harbor", "ivory", "jewel", "knot",
	"lunar", "maple", "nexus", "oasis", "phoenix", "quest",
	"raven", "summit", "trail", "unity", "vertex", "willow",
	"atlas", "beacon", "comet", "dusk", "eagle", "flame",
	"globe", "horizon", "iris", "jade", "kite", "lotus",
	"meteor", "nebula", "oak", "panda", "quartz", "reef",
	"star", "tiger", "umbra", "vortex", "wolf", "zenith",
];

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PLANS_DIR = join(homedir(), ".nanopencil", "plans");
const MAX_SLUG_RETRIES = 10;

// ============================================================================
// State management
// ============================================================================

const stateByBus: PlanStateMap = new WeakMap();
const allSessionStates = new Set<PlanSessionState>();

export function getPlanSessionState(bus: unknown, sessionId?: string, entries?: SessionEntry[]): PlanSessionState {
	const eventBus = bus as any;
	let state = stateByBus.get(eventBus);
	if (!state) {
		state = {
			state: {
				mode: "default",
				prePlanMode: "default",
				needsPlanModeExitAttachment: false,
				hasExitedPlanModeInSession: false,
				planAttachmentCount: 0,
				sessionId,
			},
			planSlugCache: undefined,
		};
		stateByBus.set(eventBus, state);
		allSessionStates.add(state);
	}
	if (sessionId && state.state.hydratedSessionId !== sessionId) {
		hydratePlanSessionState(state, sessionId, entries ?? []);
	}
	return state;
}

export function hydratePlanSessionState(
	sessionState: PlanSessionState,
	sessionId: string,
	entries: SessionEntry[],
): void {
	sessionState.state.hydratedSessionId = sessionId;
	sessionState.state.sessionId = sessionId;

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== PLAN_CUSTOM_TYPE) continue;
		const data = entry.data as Partial<PlanStateEntryData> | undefined;
		if (!data || data.version !== 1) continue;
		if (data.sessionId && data.sessionId !== sessionId) continue;

		sessionState.state.mode = data.mode ?? "default";
		sessionState.state.prePlanMode = data.prePlanMode ?? "default";
		sessionState.state.needsPlanModeExitAttachment = data.needsPlanModeExitAttachment ?? false;
		sessionState.state.hasExitedPlanModeInSession = data.hasExitedPlanModeInSession ?? false;
		sessionState.state.planAttachmentCount = data.planAttachmentCount ?? 0;
		sessionState.state.lastPlanAttachmentHumanTurn = data.lastPlanAttachmentHumanTurn;
		sessionState.state.planSlug = data.planSlug;
		sessionState.state.planSnapshot = data.planSnapshot;
		sessionState.state.lastAllowedPrompts = data.lastAllowedPrompts;
		sessionState.planSlugCache = data.planSlug;
		return;
	}

	sessionState.state.mode = "default";
	sessionState.state.prePlanMode = "default";
	sessionState.state.needsPlanModeExitAttachment = false;
	sessionState.state.hasExitedPlanModeInSession = false;
	sessionState.state.planAttachmentCount = 0;
	sessionState.state.lastPlanAttachmentHumanTurn = undefined;
	sessionState.state.planSlug = undefined;
	sessionState.state.planSnapshot = undefined;
	sessionState.state.lastAllowedPrompts = undefined;
	sessionState.planSlugCache = undefined;
}

export function serializePlanSessionState(sessionState: PlanSessionState): PlanStateEntryData {
	return {
		version: 1,
		sessionId: sessionState.state.sessionId,
		mode: sessionState.state.mode,
		prePlanMode: sessionState.state.prePlanMode,
		needsPlanModeExitAttachment: sessionState.state.needsPlanModeExitAttachment,
		hasExitedPlanModeInSession: sessionState.state.hasExitedPlanModeInSession,
		planAttachmentCount: sessionState.state.planAttachmentCount,
		lastPlanAttachmentHumanTurn: sessionState.state.lastPlanAttachmentHumanTurn,
		planSlug: sessionState.planSlugCache ?? sessionState.state.planSlug,
		planSnapshot: sessionState.state.planSnapshot,
		lastAllowedPrompts: sessionState.state.lastAllowedPrompts,
	};
}

// ============================================================================
// Slug generation
// ============================================================================

export function generatePlanSlug(): string {
	const adj1 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
	const adj2 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
	const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
	return `${adj1}-${adj2}-${noun}`;
}

// ============================================================================
// Plans directory
// ============================================================================

let cachedPlansDir: string | undefined;
let cachedPlansDirKey: string | undefined;

export function getPlansDirectory(settingsPlansDir?: string, cwd?: string): string {
	const key = `${cwd ?? ""}\0${settingsPlansDir ?? ""}`;
	if (cachedPlansDir && !settingsPlansDir && !cwd) return cachedPlansDir;
	if (cachedPlansDir && cachedPlansDirKey === key) return cachedPlansDir;

	if (settingsPlansDir && cwd) {
		const resolved = resolve(cwd, settingsPlansDir);
		if (!resolved.startsWith(cwd + sep) && resolved !== cwd) {
			// Out of project root, fall back to default
			mkdirSync(DEFAULT_PLANS_DIR, { recursive: true });
			cachedPlansDir = DEFAULT_PLANS_DIR;
		} else {
			mkdirSync(resolved, { recursive: true });
			cachedPlansDir = resolved;
		}
	} else {
		mkdirSync(DEFAULT_PLANS_DIR, { recursive: true });
		cachedPlansDir = DEFAULT_PLANS_DIR;
	}

	cachedPlansDirKey = key;
	return cachedPlansDir;
}

export function resetPlansDirectoryCache(): void {
	cachedPlansDir = undefined;
	cachedPlansDirKey = undefined;
}

// ============================================================================
// Plan slug caching (per session)
// ============================================================================

export function getPlanSlug(bus: unknown): string {
	const sessionState = getPlanSessionState(bus);
	if (sessionState.planSlugCache) return sessionState.planSlugCache;

	const plansDir = getPlansDirectory();
	let slug: string;

	for (let i = 0; i < MAX_SLUG_RETRIES; i++) {
		slug = generatePlanSlug();
		const filePath = join(plansDir, `${slug}.md`);
		if (!existsSync(filePath)) break;
	}

	slug = slug!;
	sessionState.planSlugCache = slug;
	sessionState.state.planSlug = slug;
	return slug;
}

export function setPlanSlug(bus: unknown, slug: string): void {
	const sessionState = getPlanSessionState(bus);
	sessionState.planSlugCache = slug;
	sessionState.state.planSlug = slug;
}

export function clearPlanSlug(bus: unknown): void {
	const sessionState = getPlanSessionState(bus);
	sessionState.planSlugCache = undefined;
	sessionState.state.planSlug = undefined;
}

export function clearAllPlanSlugs(): void {
	for (const sessionState of allSessionStates) {
		sessionState.planSlugCache = undefined;
		sessionState.state.planSlug = undefined;
	}
}

// ============================================================================
// Plan file path
// ============================================================================

export function getPlanFilePath(bus: unknown, agentId?: string): string {
	const slug = getPlanSlug(bus);
	const plansDir = getPlansDirectory();

	if (!agentId) {
		return join(plansDir, `${slug}.md`);
	}

	return join(plansDir, `${slug}-agent-${agentId}.md`);
}

// ============================================================================
// Plan file I/O
// ============================================================================

export function getPlan(bus: unknown, agentId?: string): string | null {
	const filePath = getPlanFilePath(bus, agentId);
	try {
		return readFileSync(filePath, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		console.error(`Error reading plan file: ${error}`);
		return null;
	}
}

export async function writePlan(bus: unknown, content: string, agentId?: string): Promise<boolean> {
	const filePath = getPlanFilePath(bus, agentId);
	try {
		const dir = dirname(filePath);
		mkdirSync(dir, { recursive: true });
		// Atomic write: write to temp file then rename.
		// Rename is atomic on POSIX and mostly atomic on Windows (for same filesystem).
		// This avoids locking while preventing partial writes.
		const tmpPath = filePath + ".tmp." + process.pid;
		writeFileSync(tmpPath, content, "utf-8");
		renameSync(tmpPath, filePath);
		return true;
	} catch (error) {
		console.error(`Error writing plan file: ${error}`);
		return false;
	}
}

export function planExists(bus: unknown, agentId?: string): boolean {
	return getPlan(bus, agentId) !== null;
}

// ============================================================================
// Plan copy for resume/fork
// ============================================================================

export async function copyPlanForResume(
	sourceBus: unknown,
	targetBus: unknown,
): Promise<boolean> {
	const sourceSlug = getPlanSlug(sourceBus);
	setPlanSlug(targetBus, sourceSlug);

	const content = getPlan(sourceBus);
	if (content !== null) {
		await writePlan(targetBus, content);
		return true;
	}

	return false;
}

export async function copyPlanForFork(
	sourceBus: unknown,
	targetBus: unknown,
): Promise<boolean> {
	const content = getPlan(sourceBus);
	if (content === null) return false;

	// Generate a new slug for the forked session to avoid conflicts
	clearPlanSlug(targetBus);
	await writePlan(targetBus, content);
	return true;
}

export async function copyPlanFileToNewSlug(bus: unknown): Promise<boolean> {
	const content = getPlan(bus);
	if (content === null) return false;
	clearPlanSlug(bus);
	return writePlan(bus, content);
}

export function copyPlanFile(sourcePath: string, targetPath: string): boolean {
	try {
		mkdirSync(dirname(targetPath), { recursive: true });
		copyFileSync(sourcePath, targetPath);
		return true;
	} catch {
		return false;
	}
}
