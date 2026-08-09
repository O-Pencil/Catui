/**
 * [WHO]: Extension-local self-evolution artifact, candidate, evidence, revision, and pointer contracts
 * [FROM]: No runtime dependencies
 * [TO]: Consumed by evolution schema, workflow, store, prompts, and extension entry
 * [HERE]: extensions/optional/evolution/types.ts - declarative evolution domain model
 */

export const EVOLUTION_SCOPES = ["global", "workspace", "session"] as const;
export type EvolutionScope = (typeof EVOLUTION_SCOPES)[number];

export const ARTIFACT_KINDS = ["prompt_note", "memory", "skill_manifest", "subagent_spec", "tool_spec"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const CANDIDATE_STATES = [
	"observed",
	"proposed",
	"statically_validated",
	"replay_validated",
	"eval_validated",
	"awaiting_approval",
	"promoted",
	"superseded",
	"rolled_back",
	"quarantined",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export interface EvolutionProvenance {
	sourceCandidateId: string;
	trigger: string;
	traceRefs: string[];
}

export interface EvolutionArtifact {
	schemaVersion: 1;
	id: string;
	kind: ArtifactKind;
	title: string;
	content: string;
	scope: EvolutionScope;
	version: number;
	createdAt: string;
	applicability: string[];
	nonApplicability: string[];
	promptTokenBudget: number;
	dependencies: string[];
	expectedOutcome: string;
	provenance: EvolutionProvenance;
	predecessorRevisionId?: string;
	rollbackRevisionId?: string;
}

export interface ProposalProvenance {
	trigger: string;
	sessionId: string;
	traceRefs: string[];
}

export interface EvolutionProposal {
	schemaVersion: 1;
	id: string;
	scope: EvolutionScope;
	baselineRevisionId: string | null;
	summary: string;
	expectedOutcome: string;
	createdAt: string;
	provenance: ProposalProvenance;
	artifacts: EvolutionArtifact[];
}

export interface GateEvidence {
	schemaVersion: 1;
	gate: "static" | "replay" | "eval" | "reviewer";
	passed: boolean;
	createdAt: string;
	summary: string;
	details: Record<string, unknown>;
}

export interface CandidateRecord {
	schemaVersion: 1;
	id: string;
	state: CandidateState;
	proposal: EvolutionProposal;
	evidence: Partial<Record<GateEvidence["gate"], GateEvidence>>;
	pendingReason?: string;
	approval?: {
		actor: string;
		approvedAt: string;
		overrideMissingEffectiveness: boolean;
	};
}

export interface RevisionManifest {
	schemaVersion: 1;
	revisionId: string;
	candidateId: string;
	scope: EvolutionScope;
	createdAt: string;
	previousRevisionId: string | null;
	contentHash: string;
	artifacts: EvolutionArtifact[];
}

export interface CurrentPointer {
	schemaVersion: 1;
	revisionId: string;
	previousRevisionId: string | null;
	updatedAt: string;
}

export type ProposalValidation =
	| { ok: true; proposal: EvolutionProposal }
	| { ok: false; issues: string[] };
