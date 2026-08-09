/**
 * [WHO]: Evolution artifact, prediction/attribution, stream-aware gate report, revision, current pointer, active fixture pointer, quarantine, and command result contracts
 * [FROM]: Depends only on local extension trust-boundary decisions
 * [TO]: Consumed by evolution-store, evolution-format, evolution-refiner, and extension entry
 * [HERE]: extensions/optional/evolution/evolution-types.ts - narrow optional evolution type surface
 */

export type EvolutionScope = "session" | "workspace" | "global";

export type EvolutionArtifactKind =
	| "prompt_note"
	| "memory"
	| "skill_manifest"
	| "subagent_spec"
	| "tool_spec"
	| "eval_fixture";

export type EvolutionCandidateStatus = "proposed" | "rejected" | "promoted" | "quarantined";

export interface EvolutionArtifact {
	id: string;
	kind: EvolutionArtifactKind;
	title: string;
	content: string;
	applicability?: string;
	nonApplicability?: string;
	tokenBudget?: number;
	metadata?: Record<string, unknown>;
}

export type EvolutionPredictionDirection = "increase" | "decrease" | "stay_at_or_above" | "stay_at_or_below" | "no_regression";

export interface EvolutionPrediction {
	id: string;
	metric: string;
	direction: EvolutionPredictionDirection;
	target: string;
	rationale: string;
}

export type EvolutionAttributionStatus = "kept" | "falsified" | "inconclusive";

export interface EvolutionPredictionAttribution {
	predictionId: string;
	metric: string;
	status: EvolutionAttributionStatus;
	observedValue?: number;
	target: string;
	reason: string;
}

export interface EvolutionAttribution {
	schemaVersion: 1;
	id: string;
	revisionId: string;
	gateReport: EvolutionGateReport;
	results: EvolutionPredictionAttribution[];
	attributedAt: string;
	attributedBy: string;
}

export interface EvolutionCandidateInput {
	scope: EvolutionScope;
	summary: string;
	rationale: string;
	expectedOutcome: string;
	artifacts: EvolutionArtifact[];
	predictions?: EvolutionPrediction[];
	evidence?: Record<string, unknown>;
}

export interface EvolutionValidationReport {
	passed: boolean;
	errors: string[];
	warnings: string[];
	validatedAt: string;
}

export interface EvolutionGateReport {
	name: string;
	passed: boolean;
	checkedAt: string;
	metrics: {
		passRate: number;
		replayDivergences: number;
		policyViolations: number;
		unpairedToolCalls: number;
	};
	streams?: {
		id: string;
		mode: "isolated" | "sequential" | "interleaved";
		passed: boolean;
		metrics: EvolutionGateReport["metrics"];
	}[];
	failure?: string;
}

export interface EvolutionCandidate extends EvolutionCandidateInput {
	schemaVersion: 1;
	id: string;
	status: EvolutionCandidateStatus;
	createdAt: string;
	updatedAt: string;
	validation: EvolutionValidationReport;
	rejectedAt?: string;
	rejectedBy?: string;
	rejectionReason?: string;
	promotedRevisionId?: string;
}

export interface EvolutionRevision {
	schemaVersion: 1;
	id: string;
	candidateId: string;
	scope: EvolutionScope;
	summary: string;
	rationale: string;
	expectedOutcome: string;
	artifacts: EvolutionArtifact[];
	predictions?: EvolutionPrediction[];
	contentHash: string;
	gateReport?: EvolutionGateReport;
	createdAt: string;
	approvedBy: string;
	predecessorRevisionId?: string;
	attribution?: EvolutionAttribution;
}

export interface EvolutionCurrent {
	schemaVersion: 1;
	revisionId: string;
	activatedAt: string;
	activatedBy: string;
	rollbackOf?: string;
}

export interface EvolutionActiveFixtures {
	schemaVersion: 1;
	activeArtifactIds: string[];
	archivedArtifactIds: string[];
	updatedAt: string;
	updatedBy: string;
}

export interface EvolutionQuarantine {
	schemaVersion: 1;
	id: string;
	revisionId?: string;
	reason: string;
	quarantinedAt: string;
	source: "active_revision";
}

export interface EvolutionScopeSelector {
	scope: EvolutionScope;
	sessionId?: string;
	cwd?: string;
}

export interface EvolutionInspection {
	current?: EvolutionCurrent;
	activeFixtures?: EvolutionActiveFixtures;
	candidates: EvolutionCandidate[];
	revisions: EvolutionRevision[];
	attributions: EvolutionAttribution[];
	quarantines: EvolutionQuarantine[];
}
