/**
 * [WHO]: createEvolutionRefineTool lets the model create/promote scoped artifacts and sweep trace-derived eval fixtures
 * [FROM]: Depends on @catui/agent-core result shape, TypeBox schema, extension context, evolution gate, and evolution store validation
 * [TO]: Consumed by optional evolution extension entry
 * [HERE]: extensions/optional/evolution/evolution-refine-tool.ts - autonomous non-executable refinement boundary
 */

import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentToolResult } from "@catui/agent-core";
import type { ExtensionContext, ToolDefinition } from "../../../core/extensions-host/types.js";
import { evalFixtureContent, workspaceTracePaths } from "./evolution-fixture.js";
import { runEvolutionGate, type EvolutionGateRunner } from "./evolution-gate.js";
import {
	canAutoPromoteGlobalEvolution,
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	promoteEvolutionCandidate,
	recordEvolutionGateFailure,
} from "./evolution-store.js";
import type { EvolutionArtifactKind, EvolutionScope } from "./evolution-types.js";

const EvolutionRefineInput = Type.Object({
	action: Type.Union([
		Type.Literal("create_tool_spec"),
		Type.Literal("create_artifact"),
		Type.Literal("propose_eval_fixture_from_trace"),
		Type.Literal("sweep_workspace_traces"),
	], {
		description: "Create a scoped declarative artifact. create_tool_spec is a compatibility alias for create_artifact kind=tool_spec. propose_eval_fixture_from_trace creates one inactive eval_fixture candidate from a local trace JSONL file. sweep_workspace_traces creates inactive eval_fixture candidates from recent workspace traces.",
	}),
	kind: Type.Optional(Type.Union([
		Type.Literal("prompt_note"),
		Type.Literal("memory"),
		Type.Literal("skill_manifest"),
		Type.Literal("subagent_spec"),
		Type.Literal("tool_spec"),
		Type.Literal("eval_fixture"),
	], { description: "Artifact kind for create_artifact. Defaults to tool_spec for create_tool_spec." })),
	scope: Type.Optional(Type.Union([Type.Literal("session"), Type.Literal("workspace"), Type.Literal("global")], {
		description: "Persistence scope. session is default; workspace can auto-promote non-executable project lessons; global auto-promotion is allowed only for low-risk prompt_note/memory and bounded tool_spec artifacts.",
	})),
	title: Type.String({ minLength: 1, description: "Short reusable tool name." }),
	content: Type.String({
		minLength: 1,
		description: "Declarative reusable content. No commands, installs, endpoints, credentials, or generated code.",
	}),
	applicability: Type.Optional(Type.String({ description: "When this tool spec should be used." })),
	nonApplicability: Type.Optional(Type.String({ description: "When this tool spec should not be used." })),
	autoPromote: Type.Optional(Type.Boolean({ description: "When true, immediately promote the validated session-scoped tool_spec." })),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Non-secret input contract or routing metadata." })),
	predictions: Type.Optional(Type.Array(Type.Object({
		id: Type.String({ minLength: 1 }),
		metric: Type.String({ minLength: 1 }),
		direction: Type.Union([
			Type.Literal("increase"),
			Type.Literal("decrease"),
			Type.Literal("stay_at_or_above"),
			Type.Literal("stay_at_or_below"),
			Type.Literal("no_regression"),
		]),
		target: Type.String({ minLength: 1 }),
		rationale: Type.String({ minLength: 1 }),
	}), { description: "Falsifiable predictions for post-hoc attribution." })),
	tracePath: Type.Optional(Type.String({ description: "Local workspace trace JSONL path for propose_eval_fixture_from_trace." })),
	maxTraces: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Maximum recent workspace traces to sweep." })),
	scenarioId: Type.Optional(Type.String({ description: "Scenario id for a generated eval_fixture." })),
	observedOutputFingerprint: Type.Optional(Type.String({ description: "Optional changed observed output fingerprint for regression fixture calibration." })),
});

function textResult(text: string, details: unknown): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details };
}

function slug(raw: string): string {
	const base = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
	if (base) return base;
	return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function resolveKind(action: string, kind: string | undefined): EvolutionArtifactKind {
	if (action === "create_tool_spec") return "tool_spec";
	if (action === "sweep_workspace_traces") return "eval_fixture";
	if (
		kind === "prompt_note" ||
		kind === "memory" ||
		kind === "skill_manifest" ||
		kind === "subagent_spec" ||
		kind === "tool_spec" ||
		kind === "eval_fixture"
	) {
		return kind;
	}
	return "tool_spec";
}

function resolveScope(scope: string | undefined): EvolutionScope {
	if (scope === "workspace") return "workspace";
	if (scope === "global") return "global";
	return "session";
}

function assertKnownAction(action: string): void {
	if (
		action !== "create_tool_spec" &&
		action !== "create_artifact" &&
		action !== "propose_eval_fixture_from_trace" &&
		action !== "sweep_workspace_traces"
	) {
		throw new Error(`Unsupported evolution_refine action: ${action}`);
	}
}

export interface EvolutionRefineToolOptions {
	runGate?: EvolutionGateRunner;
}

export function createEvolutionRefineTool(options: EvolutionRefineToolOptions = {}): ToolDefinition<typeof EvolutionRefineInput, unknown> {
	const runGate = options.runGate ?? runEvolutionGate;
	return {
		name: "evolution_refine",
		label: "Evolution Refine",
		description:
			"Create scoped declarative evolved artifacts for future reuse. This is autonomous but non-executable: it cannot install packages, create code, call endpoints, or register new runtime commands.",
		parameters: EvolutionRefineInput,
		isConcurrencySafe: false,
		guidance:
			"Use evolution_refine after discovering a reusable lesson, preference, prompt note, procedure, tool spec, skill manifest, or subagent spec. Prefer autoPromote only for narrow, non-executable artifacts with clear applicability; global tool_spec artifacts also need explicit non-applicability.",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			try {
				assertKnownAction(params.action);
				const scope = resolveScope(params.scope);
				const root = getEvolutionScopeRoot(ctx.agentDir, scope === "workspace"
					? { scope, cwd: ctx.cwd }
					: scope === "global"
						? { scope }
						: { scope, sessionId: ctx.sessionManager.getSessionId() });
				const kind = resolveKind(params.action, params.kind);
				if (params.action === "sweep_workspace_traces") {
					if (scope !== "workspace") throw new Error("Trace sweep must be workspace-scoped.");
					const tracePaths = workspaceTracePaths(ctx.cwd, params.maxTraces ?? 10);
					let created = 0;
					let skipped = 0;
					const candidateIds: string[] = [];
					for (const tracePath of tracePaths) {
						const relTracePath = relative(resolve(ctx.cwd), tracePath);
						const title = `${params.title}: ${relTracePath}`;
						const scenarioId = slug(`${params.scenarioId ?? "trace-sweep"}-${relTracePath}`);
						const fixture = await evalFixtureContent(ctx.cwd, tracePath, params.observedOutputFingerprint);
						try {
							const candidate = createEvolutionCandidate(root, {
								scope,
								summary: `Create workspace evolved eval_fixture from trace: ${relTracePath}`,
								rationale: "Created autonomously by sweeping recent validated run traces so future self-evolution can replay historical behavior.",
								expectedOutcome: "Future automatic promotion gates replay this fixture before activating new evolved artifacts.",
								...(params.predictions ? { predictions: params.predictions } : {}),
								artifacts: [
									{
										id: `evolved:eval_fixture:${slug(title)}`,
										kind: "eval_fixture",
										title,
										content: fixture.content,
										applicability: params.applicability ?? "Future self-evolution auto-promotion in this workspace.",
										metadata: { scenarioId, tracePath: relTracePath },
									},
								],
								evidence: {
									source: "model_tool",
									createdBy: "evolution_refine",
									tracePath: relTracePath,
									sweep: true,
								},
							});
							created += 1;
							candidateIds.push(candidate.id);
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							if (!/duplicate eval_fixture/i.test(message)) throw error;
							skipped += 1;
						}
					}
					return textResult(`Evolution workspace trace sweep created ${created} eval_fixture candidate(s), skipped ${skipped} duplicate trace(s).`, {
						scope,
						kind: "eval_fixture",
						created,
						skipped,
						candidateIds,
					});
				}
				if (params.action === "propose_eval_fixture_from_trace") {
					if (scope !== "workspace") throw new Error("Trace-derived eval fixtures must be workspace-scoped.");
					if (!params.tracePath) throw new Error("tracePath is required for propose_eval_fixture_from_trace.");
					const scenarioId = params.scenarioId?.trim() || slug(params.title);
					const fixture = await evalFixtureContent(ctx.cwd, params.tracePath, params.observedOutputFingerprint);
					const candidate = createEvolutionCandidate(root, {
						scope,
						summary: `Create workspace evolved eval_fixture: ${params.title}`,
						rationale: "Created autonomously from a validated run trace so future self-evolution can replay historical behavior.",
						expectedOutcome: "Future automatic promotion gates replay this fixture before activating new evolved artifacts.",
						...(params.predictions ? { predictions: params.predictions } : {}),
						artifacts: [
							{
								id: `evolved:eval_fixture:${slug(params.title)}`,
								kind: "eval_fixture",
								title: params.title,
								content: fixture.content,
								applicability: params.applicability ?? "Future self-evolution auto-promotion in this workspace.",
								metadata: { scenarioId, tracePath: relative(resolve(ctx.cwd), fixture.resolvedTracePath) },
							},
						],
						evidence: {
							source: "model_tool",
							createdBy: "evolution_refine",
							tracePath: params.tracePath,
						},
					});
					return textResult(`Evolution workspace eval_fixture candidate ${candidate.id} created. It is inactive until promoted.`, {
						candidateId: candidate.id,
						scope,
						kind: "eval_fixture",
						promoted: false,
					});
				}
				const input = {
					scope,
					summary: `Create ${scope} evolved ${kind}: ${params.title}`,
					rationale: `Created autonomously by the model after identifying a reusable ${scope}-scoped procedure.`,
					expectedOutcome:
						kind === "tool_spec"
							? "Future turns can invoke the promoted tool spec through evolved_tool."
							: "Future turns can consume the promoted artifact when applicable.",
					...(params.predictions ? { predictions: params.predictions } : {}),
					artifacts: [
						{
							id: `evolved:${kind}:${slug(params.title)}`,
							kind,
							title: params.title,
							content: params.content,
							...(params.applicability ? { applicability: params.applicability } : {}),
							...(params.nonApplicability ? { nonApplicability: params.nonApplicability } : {}),
							...(params.metadata ? { metadata: params.metadata } : {}),
						},
					],
					evidence: {
						source: "model_tool",
						createdBy: "evolution_refine",
					},
				};
				const candidate = createEvolutionCandidate(root, input);
				if (!params.autoPromote) {
					return textResult(`Evolution ${scope} ${kind} candidate ${candidate.id} created. It is inactive until promoted.`, {
						candidateId: candidate.id,
						scope,
						kind,
						promoted: false,
					});
				}
				const globalPolicy = scope === "global" ? canAutoPromoteGlobalEvolution(input) : { allowed: true };
				if (!globalPolicy.allowed) {
					return textResult(
						`Evolution global ${kind} candidate ${candidate.id} created but not promoted: ${globalPolicy.reason}. It requires explicit user review through /refine --global promote.`,
						{ candidateId: candidate.id, scope, kind, promoted: false, reason: globalPolicy.reason },
					);
				}
				const gateReport = await runGate(candidate, { agentDir: ctx.agentDir, cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() });
				if (!gateReport.passed) {
					recordEvolutionGateFailure(root, candidate.id, { gateReport });
					return textResult(
						`Evolution ${scope} ${kind} candidate ${candidate.id} created but not promoted: eval gate failed (${gateReport.failure ?? gateReport.name}).`,
						{ candidateId: candidate.id, scope, kind, promoted: false, gateReport },
					);
				}
				const revision = promoteEvolutionCandidate(root, candidate.id, { approvedBy: "model-session-autopromote", gateReport });
				return textResult(
					kind === "tool_spec"
						? `Evolution ${scope} tool_spec candidate ${candidate.id} created and promoted as revision ${revision.id}. Use evolved_tool action=list or action=invoke to reuse it.`
						: `Evolution ${scope} ${kind} candidate ${candidate.id} created and promoted as revision ${revision.id}. It will be available to future turns when applicable.`,
					{ candidateId: candidate.id, revisionId: revision.id, scope, kind, promoted: true },
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`Error: ${message}`, { error: message });
			}
		},
	};
}
