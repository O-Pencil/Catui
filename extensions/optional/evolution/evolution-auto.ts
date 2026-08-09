/**
 * [WHO]: EvolutionAutoObserver turns explicit reusable-lesson and structured turn output into evolution candidates
 * [FROM]: Depends on extension turn_end context, evolution gate, and evolution store validation/persistence
 * [TO]: Consumed by optional evolution extension entry
 * [HERE]: extensions/optional/evolution/evolution-auto.ts - deterministic loop-level self-evolution observer with scope gates
 */

import type { ExtensionContext, TurnEndEvent } from "../../../core/extensions-host/types.js";
import { relative, resolve } from "node:path";
import { evalFixtureContent } from "./evolution-fixture.js";
import { runCandidateEvalFixtureGate, runEvolutionGate, type EvolutionGateRunner } from "./evolution-gate.js";
import {
	canAutoPromoteGlobalEvolution,
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	promoteEvolutionCandidate,
	recordEvolutionGateFailure,
} from "./evolution-store.js";
import type { EvolutionArtifactKind, EvolutionScope } from "./evolution-types.js";

const COOLDOWN_TURNS = 3;
const LESSON_PATTERN = /(?:Reusable lesson|Evolution lesson)\s*:\s*([^\n]+)/i;

function extractText(message: unknown): string {
	if (typeof message !== "object" || message === null) return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part !== "object" || part === null) return "";
			const text = (part as { text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.filter(Boolean)
		.join("\n");
}

function slug(raw: string): string {
	return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "lesson";
}

function artifactKind(value: unknown): EvolutionArtifactKind | undefined {
	return value === "prompt_note" || value === "memory" || value === "skill_manifest" || value === "subagent_spec" || value === "tool_spec" || value === "eval_fixture"
		? value
		: undefined;
}

function scopeOf(value: unknown): EvolutionScope {
	return value === "workspace" || value === "global" ? value : "session";
}

function parseJsonCandidates(text: string): unknown[] {
	const candidates: unknown[] = [];
	const fenced = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g);
	for (const match of fenced) {
		try {
			candidates.push(JSON.parse(match[1].trim()));
		} catch {
			// ignore malformed fenced JSON
		}
	}
	const trimmed = text.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		try {
			candidates.push(JSON.parse(trimmed));
		} catch {
			// ignore malformed bare JSON
		}
	}
	return candidates;
}

function structuredProposal(text: string):
	| {
			scope: EvolutionScope;
			kind: EvolutionArtifactKind;
			title: string;
			content: string;
			applicability?: string;
			nonApplicability?: string;
			tracePath?: string;
			scenarioId?: string;
			observedOutputFingerprint?: string;
			autoPromote: boolean;
	  }
	| undefined {
	for (const candidate of parseJsonCandidates(text)) {
		if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
		const proposal = (candidate as Record<string, unknown>).catui_evolution;
		if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal)) continue;
		const record = proposal as Record<string, unknown>;
		const kind = artifactKind(record.kind);
		if (!kind || typeof record.title !== "string") continue;
		if (kind !== "eval_fixture" && typeof record.content !== "string") continue;
		return {
			scope: scopeOf(record.scope),
			kind,
			title: record.title,
			content: typeof record.content === "string" ? record.content : "",
			...(typeof record.applicability === "string" ? { applicability: record.applicability } : {}),
			...(typeof record.nonApplicability === "string" ? { nonApplicability: record.nonApplicability } : {}),
			...(typeof record.tracePath === "string" ? { tracePath: record.tracePath } : {}),
			...(typeof record.scenarioId === "string" ? { scenarioId: record.scenarioId } : {}),
			...(typeof record.observedOutputFingerprint === "string" ? { observedOutputFingerprint: record.observedOutputFingerprint } : {}),
			autoPromote: record.autoPromote === true,
		};
	}
	return undefined;
}

export class EvolutionAutoObserver {
	#lastCandidateTurnBySession = new Map<string, number>();
	#runGate: EvolutionGateRunner;

	constructor(options: { runGate?: EvolutionGateRunner } = {}) {
		this.#runGate = options.runGate ?? runEvolutionGate;
	}

	async observeTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<{ candidateId?: string; skipped?: string }> {
		const sessionId = ctx.sessionManager.getSessionId();
		const text = extractText(event.message);
		const structured = structuredProposal(text);
		if (structured) {
			const root = getEvolutionScopeRoot(
				ctx.agentDir,
				structured.scope === "global"
					? { scope: "global" }
					: structured.scope === "workspace"
						? { scope: "workspace", cwd: ctx.cwd }
						: { scope: "session", sessionId },
			);
			if (structured.kind === "eval_fixture") {
				if (structured.scope !== "workspace") return { skipped: "eval_fixture_scope" };
				if (!structured.tracePath) return { skipped: "eval_fixture_trace_path" };
				const scenarioId = structured.scenarioId?.trim() || slug(structured.title);
				const fixture = await evalFixtureContent(ctx.cwd, structured.tracePath, structured.observedOutputFingerprint);
				const candidate = createEvolutionCandidate(root, {
					scope: "workspace",
					summary: `Structured turn-end eval_fixture: ${structured.title}`,
					rationale: "The assistant emitted a structured catui_evolution eval_fixture proposal at turn end.",
					expectedOutcome: "Future automatic promotion gates replay this fixture before activating new evolved artifacts.",
					artifacts: [
						{
							id: `evolved:eval_fixture:auto-${slug(structured.title)}`,
							kind: "eval_fixture",
							title: structured.title,
							content: fixture.content,
							applicability: structured.applicability ?? "Future self-evolution auto-promotion in this workspace.",
							metadata: { scenarioId, tracePath: relative(resolve(ctx.cwd), fixture.resolvedTracePath) },
						},
					],
					evidence: { source: "turn_end_structured", turnIndex: event.turnIndex, tracePath: structured.tracePath },
				});
				if (structured.autoPromote) {
					const currentGateReport = await this.#runGate(candidate, { agentDir: ctx.agentDir, cwd: ctx.cwd, sessionId });
					if (!currentGateReport.passed) {
						recordEvolutionGateFailure(root, candidate.id, { gateReport: currentGateReport });
					} else {
						const fixtureGateReport = await runCandidateEvalFixtureGate(fixture.content, scenarioId);
						if (fixtureGateReport.passed) {
							promoteEvolutionCandidate(root, candidate.id, { approvedBy: "structured-turn-end", gateReport: fixtureGateReport });
						} else {
							recordEvolutionGateFailure(root, candidate.id, { gateReport: fixtureGateReport });
						}
					}
				}
				this.#lastCandidateTurnBySession.set(sessionId, event.turnIndex);
				return { candidateId: candidate.id };
			}
			const input = {
				scope: structured.scope,
				summary: `Structured turn-end ${structured.kind}: ${structured.title}`,
				rationale: "The assistant emitted a structured catui_evolution proposal at turn end.",
				expectedOutcome:
					structured.kind === "tool_spec"
						? "Future turns can invoke the promoted tool spec through evolved_tool."
						: "Future turns can consume the promoted artifact when applicable.",
				artifacts: [
					{
						id: `evolved:${structured.kind}:auto-${slug(structured.title)}`,
						kind: structured.kind,
						title: structured.title,
						content: structured.content,
						...(structured.applicability ? { applicability: structured.applicability } : {}),
						...(structured.nonApplicability ? { nonApplicability: structured.nonApplicability } : {}),
					},
				],
				evidence: { source: "turn_end_structured", turnIndex: event.turnIndex },
			};
			const candidate = createEvolutionCandidate(root, input);
			const globalPolicy = structured.scope === "global" ? canAutoPromoteGlobalEvolution(input) : { allowed: true };
			if (structured.autoPromote && globalPolicy.allowed) {
				const gateReport = await this.#runGate(candidate, { agentDir: ctx.agentDir, cwd: ctx.cwd, sessionId });
				if (gateReport.passed) {
					promoteEvolutionCandidate(root, candidate.id, { approvedBy: "structured-turn-end", gateReport });
				} else {
					recordEvolutionGateFailure(root, candidate.id, { gateReport });
				}
			}
			this.#lastCandidateTurnBySession.set(sessionId, event.turnIndex);
			return { candidateId: candidate.id };
		}
		const lastTurn = this.#lastCandidateTurnBySession.get(sessionId);
		if (lastTurn !== undefined && event.turnIndex - lastTurn < COOLDOWN_TURNS) return { skipped: "cooldown" };
		const lesson = text.match(LESSON_PATTERN)?.[1]?.trim();
		if (!lesson) return { skipped: "no_lesson" };
		const root = getEvolutionScopeRoot(ctx.agentDir, { scope: "session", sessionId });
		const candidate = createEvolutionCandidate(root, {
			scope: "session",
			summary: "Auto-observed reusable lesson",
			rationale: "The assistant explicitly marked a reusable lesson at turn end.",
			expectedOutcome: "Future turns can inspect and promote the lesson when it proves reusable.",
			artifacts: [
				{
					id: `evolved:memory:auto-${slug(lesson)}`,
					kind: "memory",
					title: "Auto-observed reusable lesson",
					content: lesson,
					applicability: "Future tasks matching the lesson conditions.",
				},
			],
			evidence: {
				source: "turn_end",
				turnIndex: event.turnIndex,
			},
		});
		this.#lastCandidateTurnBySession.set(sessionId, event.turnIndex);
		return { candidateId: candidate.id };
	}
}
