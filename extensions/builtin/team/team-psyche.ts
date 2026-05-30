/**
 * [WHO]: Provides computePsycheWeights(), buildPsychePrompt(), formatPsycheWeights()
 * [FROM]: Depends on ./team-types for teammate roles, phases, weights, persisted teammate state
 * [TO]: Consumed by team-runtime.ts, team-dashboard.ts, index.ts for phase-aware teammate prompts and status rendering
 * [HERE]: extensions/builtin/team/team-psyche.ts - Freud-inspired internal prompt layer for AgentTeam harness work
 */

import type { HarnessPhase, PersistedTeammate, PsycheWeights, TeammateRole } from "./team-types.js";

export type SoulTraits = Partial<Record<string, number>>;

const PHASE_WEIGHTS: Record<HarnessPhase, PsycheWeights> = {
	init: { id: 2, ego: 7, superego: 1 },
	coding: { id: 5, ego: 3, superego: 2 },
	verify: { id: 1, ego: 2, superego: 7 },
	fix: { id: 4, ego: 4, superego: 2 },
	complete: { id: 1, ego: 3, superego: 6 },
};

const ROLE_MODIFIERS: Record<TeammateRole, Partial<PsycheWeights>> = {
	pm: { ego: 1.4, superego: 1.1 },
	architect: { ego: 1.4, id: 0.8 },
	developer: { id: 1.1 },
	designer: { id: 1.2, ego: 1.1 },
	"data-analyst": { superego: 1.4, ego: 1.1 },
	implementer: {},
	verifier: { superego: 1.5, id: 0.5 },
	planner: { ego: 1.3, id: 0.7 },
	researcher: { ego: 1.2 },
	reviewer: { superego: 1.3 },
	generic: {},
};

const SOUL_MAPPINGS: Array<{ trait: string; target: keyof PsycheWeights; scale: number }> = [
	{ trait: "conscientiousness", target: "superego", scale: 0.3 },
	{ trait: "openness", target: "id", scale: 0.3 },
	{ trait: "neuroticism", target: "ego", scale: 0.2 },
	{ trait: "explorationDrive", target: "id", scale: 0.2 },
	{ trait: "safetyMargin", target: "superego", scale: 0.2 },
];

export function computePsycheWeights(
	phase: HarnessPhase,
	role: TeammateRole,
	soulTraits?: SoulTraits,
	overrides?: Partial<PsycheWeights>,
): PsycheWeights {
	const base = { ...PHASE_WEIGHTS[phase] };
	const roleModifier = ROLE_MODIFIERS[role] ?? {};

	for (const key of Object.keys(roleModifier) as Array<keyof PsycheWeights>) {
		base[key] = base[key] * (roleModifier[key] ?? 1);
	}

	if (soulTraits) {
		for (const mapping of SOUL_MAPPINGS) {
			const value = normalizeTrait(soulTraits[mapping.trait]);
			if (value !== undefined) {
				base[mapping.target] = base[mapping.target] * (1 + value * mapping.scale);
			}
		}
	}

	if (overrides) {
		for (const key of Object.keys(overrides) as Array<keyof PsycheWeights>) {
			base[key] = overrides[key] ?? base[key];
		}
	}

	return clampWeights(base);
}

export function buildPsychePrompt(
	weights: PsycheWeights,
	phase: HarnessPhase,
	teammate: PersistedTeammate,
): string {
	const dominant = getDominantLayer(weights);
	return [
		"## Internal Psyche Structure",
		"",
		"You have three simultaneous internal forces. They are not separate agents; they jointly influence every decision.",
		`Current phase: ${phase} | Weights: Id=${weights.id} Ego=${weights.ego} Superego=${weights.superego}`,
		`Dominant layer: ${dominant}`,
		"",
		buildIdLayer(weights.id, phase),
		"",
		buildEgoLayer(weights.ego, phase),
		"",
		buildSuperegoLayer(weights.superego, phase),
		"",
		`Apply these forces as ${teammate.identity.name} (${teammate.identity.role}) in ${teammate.mode} mode.`,
	].join("\n");
}

export function buildIdLayer(weight: number, phase: HarnessPhase): string {
	const posture = weight >= 5 ? "dominant" : weight <= 2 ? "restrained" : "active";
	const phaseLine =
		phase === "verify"
			? "Suppress implementation impulses. Record defects instead of fixing them in this phase."
			: phase === "init"
				? "Channel creative drive into decomposing the work into concrete, testable features."
				: "Implement one valuable feature at a time and keep momentum visible.";
	return [`### Id - Creative Drive [${posture}]`, phaseLine].join("\n");
}

export function buildEgoLayer(weight: number, phase: HarnessPhase): string {
	const posture = weight >= 5 ? "dominant" : weight <= 2 ? "supporting" : "active";
	const phaseLine =
		phase === "init"
			? "First understand the task, create the harness files, then stop after the initialization checkpoint."
			: "Read the injected harness files, choose the next bounded step, and preserve context by updating progress.";
	return [
		`### Ego - Reality Coordination [${posture}]`,
		phaseLine,
		"- Work incrementally; avoid one-shotting a large task.",
		"- Prefer observable progress over broad unfinished changes.",
	].join("\n");
}

export function buildSuperegoLayer(weight: number, phase: HarnessPhase): string {
	const posture = weight >= 5 ? "dominant" : weight <= 2 ? "watching" : "active";
	const phaseLine =
		phase === "verify"
			? "Strictly verify every claimed passing feature and downgrade any unverified claim."
			: "Do not claim completion without concrete verification evidence.";
	return [
		`### Superego - Quality Constraint [${posture}]`,
		phaseLine,
		"- Do not remove or rewrite feature definitions in feature_list.json.",
		"- Only set passes=true after executing the listed verification steps.",
		"- Keep progress.txt accurate enough for the next session to resume.",
	].join("\n");
}

export function formatPsycheWeights(weights: PsycheWeights | undefined): string {
	if (!weights) return "psyche: unavailable";
	return `psyche: Id=${weights.id} Ego=${weights.ego} Superego=${weights.superego}`;
}

function normalizeTrait(value: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	if (value > 1) return Math.max(-1, Math.min(1, value / 100));
	return Math.max(-1, Math.min(1, value));
}

function clampWeights(weights: PsycheWeights): PsycheWeights {
	return {
		id: clampWeight(weights.id),
		ego: clampWeight(weights.ego),
		superego: clampWeight(weights.superego),
	};
}

function clampWeight(value: number): number {
	return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}

function getDominantLayer(weights: PsycheWeights): "Id" | "Ego" | "Superego" {
	if (weights.superego >= weights.id && weights.superego >= weights.ego) return "Superego";
	if (weights.ego >= weights.id && weights.ego >= weights.superego) return "Ego";
	return "Id";
}
