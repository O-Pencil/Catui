/**
 * [WHO]: Candidate-specific adversarial effectiveness evaluator with strict evidence matching
 * [FROM]: Depends on ExtensionContext, bounded session evidence, evolution store, and domain types
 * [TO]: Consumed by guarded/shadow automation after deterministic safety verification
 * [HERE]: extensions/optional/evolution/evaluation.ts - comparative effectiveness gate
 */
import type { ExtensionContext } from "../../../core/extensions-host/types.js";
import { boundedSessionEvidence } from "./prompts.js";
import type { EvolutionStore } from "./store.js";
import type { EvolutionScope } from "./types.js";

interface CandidateEvaluationDraft {
	matchedScenarios: string[];
	baselineScore: number;
	candidateScore: number;
	regressions: string[];
	improvements: string[];
	rationale: string;
}

interface DeterministicComparison {
	passed: boolean;
	matchedScenarios: string[];
	improvements: string[];
	regressions: string[];
}

export const CANDIDATE_EVALUATION_SCHEMA: Record<string, unknown> = {
	type: "object",
	additionalProperties: false,
	required: ["matchedScenarios", "baselineScore", "candidateScore", "regressions", "improvements", "rationale"],
	properties: {
		matchedScenarios: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200 } },
		baselineScore: { type: "integer", minimum: 0, maximum: 100 },
		candidateScore: { type: "integer", minimum: 0, maximum: 100 },
		regressions: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 500 } },
		improvements: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 500 } },
		rationale: { type: "string", minLength: 1, maxLength: 2_000 },
	},
};

function stringArray(value: unknown, field: string, allowEmpty = false): string[] {
	if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || !value.every((item) => typeof item === "string" && item.length > 0)) {
		throw new Error(`Candidate evaluation ${field} must be ${allowEmpty ? "a" : "a non-empty"} string array`);
	}
	return value;
}

function score(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
		throw new Error(`Candidate evaluation ${field} must be an integer from 0 to 100`);
	}
	return value;
}

function parseEvaluation(raw: string, scenarioIds: ReadonlySet<string>): CandidateEvaluationDraft {
	const value = JSON.parse(raw) as unknown;
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Candidate evaluation must be an object");
	const record = value as Record<string, unknown>;
	const matchedScenarios = stringArray(record.matchedScenarios, "matchedScenarios");
	if (matchedScenarios.some((id) => !scenarioIds.has(id))) throw new Error("Candidate evaluation cited an unknown session scenario");
	if (typeof record.rationale !== "string" || record.rationale.length === 0) throw new Error("Candidate evaluation rationale is required");
	return {
		matchedScenarios,
		baselineScore: score(record.baselineScore, "baselineScore"),
		candidateScore: score(record.candidateScore, "candidateScore"),
		regressions: stringArray(record.regressions, "regressions", true),
		improvements: stringArray(record.improvements, "improvements", true),
		rationale: record.rationale,
	};
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exclusionDirectives(scenarios: ReturnType<typeof boundedSessionEvidence>): Map<string, Array<{ scenarioId: string; condition: string }>> {
	const directives = new Map<string, Array<{ scenarioId: string; condition: string }>>();
	for (const scenario of scenarios) {
		if (scenario.role !== "user") continue;
		const match = scenario.content.trim().match(/^\[evolution-exclude\s+(evolved:[a-z_]+:[a-z0-9._-]+)\]\s+(.{8,500})$/i);
		if (!match?.[1] || !match[2]) continue;
		const entries = directives.get(match[1]) ?? [];
		entries.push({ scenarioId: scenario.id, condition: match[2].trim() });
		directives.set(match[1], entries);
	}
	return directives;
}

function deterministicComparison(
	proposal: Awaited<ReturnType<EvolutionStore["readProposal"]>>,
	baseline: Awaited<ReturnType<EvolutionStore["readActiveManifest"]>>,
	scenarios: ReturnType<typeof boundedSessionEvidence>,
): DeterministicComparison {
	if (!baseline) return { passed: false, matchedScenarios: [], improvements: [], regressions: ["No active baseline is available"] };
	const baselineById = new Map(baseline.artifacts.map((artifact) => [artifact.id, artifact]));
	const matchedScenarios = new Set<string>();
	const improvements: string[] = [];
	const regressions: string[] = [];
	const directives = exclusionDirectives(scenarios);
	for (const candidate of proposal.artifacts) {
		const champion = candidate.overrides ? baselineById.get(candidate.overrides) : undefined;
		if (!champion) {
			regressions.push(`${candidate.id} is not a constrained override of an active artifact`);
			continue;
		}
		const unchanged = candidate.kind === champion.kind
			&& candidate.title === champion.title
			&& candidate.content === champion.content
			&& candidate.promptTokenBudget === champion.promptTokenBudget
			&& candidate.expectedOutcome === champion.expectedOutcome
			&& equalStrings(candidate.applicability, champion.applicability)
			&& equalStrings(candidate.dependencies, champion.dependencies)
			&& champion.nonApplicability.every((condition) => candidate.nonApplicability.includes(condition));
		if (!unchanged) {
			regressions.push(`${candidate.id} changes behavior beyond negative-applicability refinement`);
			continue;
		}
		const additions = candidate.nonApplicability.filter((condition) => !champion.nonApplicability.includes(condition));
		for (const condition of additions) {
			const normalized = condition.toLocaleLowerCase();
			if (candidate.applicability.some((value) => {
				const applicable = value.toLocaleLowerCase();
				return applicable.includes(normalized) || normalized.includes(applicable);
			})) {
				regressions.push(`${candidate.id} adds an exclusion that overlaps its applicability contract`);
				continue;
			}
			const directive = directives.get(champion.id)?.find((entry) => entry.condition.toLocaleLowerCase() === normalized);
			if (!directive) {
				regressions.push(`${candidate.id} lacks an exact user-authored exclusion directive`);
				continue;
			}
			matchedScenarios.add(directive.scenarioId);
			improvements.push(`${candidate.id} implements the explicit exclusion "${condition}"`);
		}
	}
	return {
		passed: regressions.length === 0 && improvements.length > 0,
		matchedScenarios: [...matchedScenarios],
		improvements,
		regressions,
	};
}

export async function evaluateCandidateEffectiveness(
	scope: EvolutionScope,
	candidateId: string,
	store: EvolutionStore,
	ctx: ExtensionContext,
): Promise<boolean> {
	if (!ctx.completeJson) throw new Error("The current model does not support structured candidate evaluation");
	const proposal = await store.readProposal(scope, candidateId);
	const baseline = await store.readActiveManifest(scope);
	const scenarios = boundedSessionEvidence(ctx.sessionManager.getEntries(), [ctx.cwd, ctx.agentDir]);
	if (scenarios.length === 0) throw new Error("No bounded session scenarios are available for candidate evaluation");
	const raw = await ctx.completeJson(
		"You are an adversarial harness evaluator. Compare the inactive candidate with the active baseline using only the supplied redacted scenarios. Report regressions conservatively. Never claim an improvement without direct scenario evidence. Return only the requested JSON object.",
		JSON.stringify({ baseline: baseline ? { revisionId: baseline.revisionId, artifacts: baseline.artifacts } : null, candidate: proposal, scenarios }),
		CANDIDATE_EVALUATION_SCHEMA,
		{ toolName: "evaluate_harness_candidate", resultKey: "evaluation" },
	);
	if (!raw) throw new Error("The model returned no candidate evaluation");
	const advisory = parseEvaluation(raw, new Set(scenarios.map((scenario) => scenario.id)));
	const comparison = deterministicComparison(proposal, baseline, scenarios);
	const nonInferior = comparison.regressions.length === 0 && advisory.regressions.length === 0;
	const improvement = comparison.improvements.length > 0;
	const passed = comparison.passed && nonInferior;
	await store.writeEvidence(scope, candidateId, {
		schemaVersion: 1,
		gate: "eval",
		passed,
		createdAt: new Date().toISOString(),
		summary: passed ? "Candidate-specific comparison found a non-inferior measurable improvement" : "Candidate-specific comparison did not prove a safe improvement",
		details: {
			matchedScenarios: comparison.matchedScenarios,
			regressions: comparison.regressions,
			improvements: comparison.improvements,
			nonInferior,
			improvement,
			deterministicAuthority: "negative-applicability-refinement-v1",
			advisoryModelEvaluation: advisory,
		},
	});
	return passed;
}
