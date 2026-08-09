/**
 * [WHO]: Pure candidate transition reducer and validation evidence gates
 * [FROM]: Depends only on extension-local evolution types
 * [TO]: Consumed by manual and automatic refinement orchestration
 * [HERE]: extensions/optional/evolution/workflow.ts - promotion policy authority
 */
import type { CandidateRecord, EvolutionArtifact, EvolutionScope, GateEvidence } from "./types.js";

export type CandidateEvent =
	| { type: "static_checked"; evidence: GateEvidence }
	| { type: "replay_checked"; evidence: GateEvidence }
	| { type: "eval_checked"; evidence: GateEvidence }
	| { type: "request_approval"; reason?: string }
	| { type: "approve"; actor: string; overrideMissingEffectiveness?: boolean }
	| { type: "promote" }
	| { type: "supersede"; reason: string }
	| { type: "rollback"; reason: string }
	| { type: "fail"; gate: string; reason: string };

function transitionError(record: CandidateRecord, event: CandidateEvent, detail?: string): never {
	throw new Error(`Candidate cannot transition from ${record.state} with ${event.type}${detail ? `: ${detail}` : ""}`);
}

function withEvidence(record: CandidateRecord, evidence: GateEvidence): CandidateRecord {
	return { ...record, evidence: { ...record.evidence, [evidence.gate]: evidence }, pendingReason: undefined };
}

function quarantine(record: CandidateRecord, evidence: GateEvidence, reason: string): CandidateRecord {
	return { ...withEvidence(record, evidence), state: "quarantined", pendingReason: reason };
}

function detailIsTrue(evidence: GateEvidence, key: string): boolean {
	return evidence.details[key] === true;
}

export function advanceCandidate(record: CandidateRecord, event: CandidateEvent): CandidateRecord {
	if (event.type === "fail") {
		if (["promoted", "rolled_back", "superseded"].includes(record.state)) transitionError(record, event);
		return { ...record, state: "quarantined", pendingReason: `${event.gate}: ${event.reason}` };
	}
	if (event.type === "supersede") {
		if (["promoted", "rolled_back", "quarantined"].includes(record.state)) transitionError(record, event);
		return { ...record, state: "superseded", pendingReason: event.reason };
	}
	if (event.type === "rollback") {
		if (record.state !== "promoted") transitionError(record, event);
		return { ...record, state: "rolled_back", pendingReason: event.reason };
	}

	switch (event.type) {
		case "static_checked": {
			if (record.state !== "proposed" || event.evidence.gate !== "static") transitionError(record, event);
			if (!event.evidence.passed) return quarantine(record, event.evidence, `static: ${event.evidence.summary}`);
			return { ...withEvidence(record, event.evidence), state: "statically_validated" };
		}
		case "replay_checked": {
			if (record.state !== "statically_validated" || event.evidence.gate !== "replay") transitionError(record, event);
			const safe = event.evidence.passed
				&& detailIsTrue(event.evidence, "lifecyclePreserved")
				&& detailIsTrue(event.evidence, "toolPairsPreserved")
				&& detailIsTrue(event.evidence, "policyPreserved");
			if (!safe) return quarantine(record, event.evidence, `replay safety: ${event.evidence.summary}`);
			return { ...withEvidence(record, event.evidence), state: "replay_validated" };
		}
		case "eval_checked": {
			if (record.state !== "replay_validated" || event.evidence.gate !== "eval") transitionError(record, event);
			const scenarios = event.evidence.details.matchedScenarios;
			if (!Array.isArray(scenarios) || scenarios.length === 0) {
				return { ...record, pendingReason: "No candidate-specific scenario measures the declared outcome" };
			}
			if (!event.evidence.passed || !detailIsTrue(event.evidence, "nonInferior") || !detailIsTrue(event.evidence, "improvement")) {
				return quarantine(record, event.evidence, `eval quality: ${event.evidence.summary}`);
			}
			return { ...withEvidence(record, event.evidence), state: "eval_validated" };
		}
		case "request_approval": {
			if (record.state !== "replay_validated" && record.state !== "eval_validated") transitionError(record, event);
			return { ...record, state: "awaiting_approval", pendingReason: event.reason ?? "Explicit approval required" };
		}
		case "approve": {
			if (record.state !== "awaiting_approval") transitionError(record, event);
			if (event.actor !== "human") transitionError(record, event, "approval actor must be human");
			const hasEval = record.evidence.eval?.passed === true;
			if (!hasEval && !event.overrideMissingEffectiveness) transitionError(record, event, "missing effectiveness evidence requires an explicit override");
			return {
				...record,
				state: "eval_validated",
				pendingReason: undefined,
				approval: {
					actor: event.actor,
					approvedAt: new Date().toISOString(),
					overrideMissingEffectiveness: event.overrideMissingEffectiveness === true,
				},
			};
		}
		case "promote": {
			if (record.state !== "eval_validated") transitionError(record, event);
			if (record.proposal.scope === "global" && record.approval?.actor !== "human") transitionError(record, event, "global promotion requires human approval");
			return { ...record, state: "promoted", pendingReason: undefined };
		}
	}
}

export function mergeScopedArtifacts(
	scoped: ReadonlyArray<{ scope: EvolutionScope; artifacts: readonly EvolutionArtifact[] }>,
	keyFor: (artifact: EvolutionArtifact) => string = (artifact) => artifact.id,
): EvolutionArtifact[] {
	const selected = new Map<string, EvolutionArtifact>();
	for (const group of scoped) {
		for (const artifact of group.artifacts) {
			const key = keyFor(artifact);
			const current = selected.get(key);
			if (!current || artifact.overrides === current.id) selected.set(key, artifact);
		}
	}
	return [...selected.values()];
}
