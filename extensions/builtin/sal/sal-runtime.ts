/**
 * [WHO]: Provides BuildMeta, ToolCallRecord, TurnState, SalDiagnosticReporter, SalRuntime shared contracts for the SAL extension
 * [FROM]: Depends on eval sink types, SAL anchors/terrain/weights types for runtime state shape
 * [TO]: Consumed by extensions/builtin/sal/index.ts plus SAL config, trace, and context helpers
 * [HERE]: extensions/builtin/sal/sal-runtime.ts - runtime contract boundary for Structural Anchor Localization modules, including per-turn loop outcome state
 */

import type {
	CreateEvalSinkOptions,
	EvalAdapterId,
	EvalSink,
	EvalVariant,
} from "./eval/index.js";
import type { AgentRunResult } from "@pencil-agent/agent-core";
import type { AnchorResolution } from "./anchors.js";
import type { TerrainSnapshot } from "./terrain.js";
import type { SalWeights } from "./weights.js";

export interface BuildMeta {
	version: string;
	commitHash?: string;
	branch?: string;
}

export interface ToolCallRecord {
	toolCallId: string;
	tool: string;
	startMs: number;
	endMs?: number;
	isError?: boolean;
}

export interface TurnState {
	turnId: number;
	startedAtMs: number;
	taskResolution?: AnchorResolution;
	agentResult?: AgentRunResult;
	touchedFiles: Set<string>;
	toolCalls: ToolCallRecord[];
	prompt?: string;
}

export type SalDiagnosticReporter = NonNullable<CreateEvalSinkOptions["onDiagnostic"]>;

export interface SalRuntime {
	workspaceRoot: string;
	snapshot?: TerrainSnapshot;
	snapshotErrored?: boolean;
	/**
	 * In-flight terrain build. Deduplicates concurrent ensureSnapshot callers so
	 * we never kick off two scans at once (e.g. a prewarm and the first turn).
	 */
	snapshotPromise?: Promise<TerrainSnapshot | undefined>;
	weights: SalWeights;
	weightsSource: string;
	turn: TurnState;
	sidecarDir: string;
	evalSink: EvalSink;
	evalAdapter?: EvalAdapterId;
	evalEndpoint?: string;
	evalApiKey?: string;
	evalAnonKey?: string;
	evalApiKeyHeader?: string;
	evalHeaders: Record<string, string>;
	evalAllowSelfSigned: boolean;
	evalEnabled: boolean;
	evalRunId: string;
	evalVariantOverride?: EvalVariant;
	evalStartedAtMs: number;
	evalRunStarted: boolean;
	turnCounter: number;
	allowStaleCleanup: boolean;
	evalMetadata: {
		workspace_root: string;
		session_id: string;
		model?: string;
	};
	buildMeta: BuildMeta;
	staleCleanupDone: boolean;
	/** Set by before_agent_start when --sal-rebuild-terrain is active; consumed by agent_end. */
	pendingRebuild: boolean;
	reportDiagnostic: SalDiagnosticReporter;
}
