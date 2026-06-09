/**
 * [WHO]: GrubStatus, GrubDecisionStatus, GrubDecision, GrubPhase, GrubTaskState, GrubTaskSnapshot, GrubControllerState, ParsedGrubCommand, FeatureItem, FeatureList, PersistedGrubState
 * [FROM]: No external dependencies
 * [TO]: Consumed by ./grub-controller.ts, ./grub-parser.ts, ./grub-feature-list.ts, ./grub-persistence.ts, ./index.ts
 * [HERE]: extensions/builtin/grub/grub-types.ts - grub task type definitions including feature-list JSON schema and persistence envelope
 */
export type GrubStatus = "running" | "complete" | "blocked" | "stopped" | "failed";

export type GrubDecisionStatus = "continue" | "complete" | "blocked";
export type GrubPhase = "initializer" | "execution";
export type GrubLocale = "en" | "zh";

export interface GrubDecision {
	status: GrubDecisionStatus;
	summary: string;
	nextStep?: string;
}

export interface GrubTaskState {
	id: string;
	goal: string;
	locale: GrubLocale;
	status: GrubStatus;
	phase: GrubPhase;
	startedAt: number;
	updatedAt: number;
	currentIteration: number;
	awaitingTurn: boolean;
	consecutiveFailures: number;
	maxIterations: number;
	maxConsecutiveFailures: number;
	/** Failure budget during the initializer phase; falls back to a default when absent (older saved tasks). */
	maxInitializerFailures?: number;
	harnessDirectory: string;
	featureChecklistPath: string;
	featureListPath: string;
	stateFilePath: string;
	progressLogPath: string;
	initScriptPath: string;
	featureListBaseline?: FeatureList;
	lastDecision?: GrubDecision;
	lastError?: string;
}

export interface GrubTaskSnapshot {
	id: string;
	goal: string;
	locale?: GrubLocale;
	status: GrubStatus;
	phase: GrubPhase;
	startedAt: number;
	updatedAt: number;
	completedIterations: number;
	consecutiveFailures: number;
	harnessDirectory: string;
	featureChecklistPath: string;
	featureListPath: string;
	stateFilePath: string;
	progressLogPath: string;
	initScriptPath: string;
	lastDecision?: GrubDecision;
	lastError?: string;
}

export interface GrubControllerState {
	active?: GrubTaskState;
	lastTerminal?: GrubTaskSnapshot;
}

export type ParsedGrubCommand =
	| { type: "start"; goal: string; maxIterations?: number; maxConsecutiveFailures?: number }
	| { type: "status"; json?: boolean }
	| { type: "stop" }
	| { type: "resume" }
	| { type: "help"; reason?: string };

/**
 * Feature list item. Models the Anthropic long-running harness contract:
 * agents may ONLY flip `passes` and append to `evidence`; all other fields
 * are set by the initializer and treated as immutable.
 */
export type FeatureCategory = "functional" | "verification" | "polish";

export interface FeatureItem {
	id: string;
	category: FeatureCategory;
	description: string;
	steps: string[];
	passes: boolean;
	evidence?: string;
}

export const FEATURE_LIST_VERSION = 1 as const;

export interface FeatureList {
	version: typeof FEATURE_LIST_VERSION;
	goal: string;
	features: FeatureItem[];
}

export const PERSISTED_GRUB_STATE_VERSION = 1 as const;

export interface PersistedGrubState {
	version: typeof PERSISTED_GRUB_STATE_VERSION;
	task: GrubTaskState;
	createdAt: number;
	lastPersistedAt: number;
}
