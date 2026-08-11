/**
 * [WHO]: createEvolvedTool exposes promoted tool_spec and workflow_spec artifacts as controlled model-callable structured plans
 * [FROM]: Depends on @catui/agent-core result shape, TypeBox schema, extension context, and evolution store/format data
 * [TO]: Consumed by optional evolution extension entry
 * [HERE]: extensions/optional/evolution/evolution-tool.ts - declarative evolved tool invocation boundary
 */

import { Type } from "@sinclair/typebox";
import type { AgentToolResult } from "@catui/agent-core";
import type { ExtensionContext, ToolDefinition } from "../../../core/extensions-host/types.js";
import { currentEvolutionRevisionId, getEvolutionScopeRoot, loadActiveEvolutionArtifacts, recordEvolutionUsage } from "./evolution-store.js";
import type { EvolutionArtifact, EvolutionScope } from "./evolution-types.js";

const EvolvedToolInput = Type.Object({
	action: Type.Union([Type.Literal("list"), Type.Literal("invoke")], {
		description: "Use list to discover promoted evolved tool specs; use invoke to retrieve one spec's reusable procedure.",
	}),
	id: Type.Optional(Type.String({ description: "The evolved:tool_spec:<id> or evolved:workflow_spec:<id> to invoke." })),
	input: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Task-specific inputs for the tool spec." })),
});

function textResult(text: string, details: unknown): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details };
}

interface EvolvedToolStep {
	name: string;
	instruction: string;
}

interface EvolvedToolPlan {
	id: string;
	kind: "tool_spec" | "workflow_spec";
	title: string;
	inputs: Record<string, unknown>;
	steps: EvolvedToolStep[];
	usesExistingTools: string[];
	phases?: EvolvedWorkflowPhase[];
	successSignals?: string[];
}

interface EvolvedWorkflowPhase {
	name: string;
	checks: string[];
}

interface ActiveDeclarativeSpec {
	scope: EvolutionScope;
	scopeRoot: string;
	revisionId?: string;
	artifact: EvolutionArtifact;
}

function activeDeclarativeSpecs(ctx: ExtensionContext): ActiveDeclarativeSpec[] {
	const roots: Array<{ scope: EvolutionScope; scopeRoot: string }> = [
		{ scope: "global", scopeRoot: getEvolutionScopeRoot(ctx.agentDir, { scope: "global" }) },
		{ scope: "workspace", scopeRoot: getEvolutionScopeRoot(ctx.agentDir, { scope: "workspace", cwd: ctx.cwd }) },
		{ scope: "session", scopeRoot: getEvolutionScopeRoot(ctx.agentDir, { scope: "session", sessionId: ctx.sessionManager.getSessionId() }) },
	];
	return roots.flatMap(({ scope, scopeRoot }) => {
		const revisionId = currentEvolutionRevisionId(scopeRoot);
		return loadActiveEvolutionArtifacts(scopeRoot)
			.filter((artifact) => artifact.kind === "tool_spec" || artifact.kind === "workflow_spec")
			.map((artifact) => ({ scope, scopeRoot, revisionId, artifact }));
	});
}

function formatToolList(specs: readonly ActiveDeclarativeSpec[]): string {
	if (specs.length === 0) return "No promoted evolved tool or workflow specs are active for this session.";
	return [
		"Promoted evolved tool and workflow specs:",
		...specs.map(({ artifact }) => `- ${artifact.id} [${artifact.kind}]: ${artifact.title}${artifact.applicability ? ` (when: ${artifact.applicability})` : ""}`),
		"",
		"Invoke one with action=invoke and its full id. These are declarative reusable assets; they guide use of existing Catui tools and do not execute generated code.",
	].join("\n");
}

function inputContract(spec: EvolutionArtifact): Record<string, unknown> {
	const inputs = spec.metadata?.inputs;
	if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) return {};
	return inputs as Record<string, unknown>;
}

function structuredSteps(spec: EvolutionArtifact): EvolvedToolStep[] {
	const steps = spec.metadata?.steps;
	if (!Array.isArray(steps)) return [];
	return steps.flatMap((step) => {
		if (typeof step !== "object" || step === null || Array.isArray(step)) return [];
		const record = step as Record<string, unknown>;
		if (typeof record.name !== "string" || typeof record.instruction !== "string") return [];
		return [{ name: record.name, instruction: record.instruction }];
	});
}

function existingToolNames(spec: EvolutionArtifact): string[] {
	const tools = spec.metadata?.usesExistingTools;
	if (!Array.isArray(tools)) return [];
	return tools.filter((tool): tool is string => typeof tool === "string");
}

function workflowPhases(spec: EvolutionArtifact): EvolvedWorkflowPhase[] {
	const phases = spec.metadata?.phases;
	if (!Array.isArray(phases)) return [];
	return phases.flatMap((phase) => {
		if (typeof phase !== "object" || phase === null || Array.isArray(phase)) return [];
		const record = phase as Record<string, unknown>;
		if (typeof record.name !== "string" || !Array.isArray(record.checks)) return [];
		const checks = record.checks.filter((check): check is string => typeof check === "string");
		return [{ name: record.name, checks }];
	});
}

function workflowSuccessSignals(spec: EvolutionArtifact): string[] {
	const signals = spec.metadata?.successSignals;
	if (!Array.isArray(signals)) return [];
	return signals.filter((signal): signal is string => typeof signal === "string");
}

function missingInputs(spec: EvolutionArtifact, input: Record<string, unknown> | undefined): string[] {
	const required = Object.keys(inputContract(spec));
	if (required.length === 0) return [];
	return required.filter((name) => input?.[name] === undefined || input[name] === null || input[name] === "");
}

function invocationPlan(spec: EvolutionArtifact, input: Record<string, unknown> | undefined): EvolvedToolPlan {
	return {
		id: spec.id,
		kind: spec.kind === "workflow_spec" ? "workflow_spec" : "tool_spec",
		title: spec.title,
		inputs: input ?? {},
		steps: structuredSteps(spec),
		usesExistingTools: existingToolNames(spec),
		...(spec.kind === "workflow_spec" ? { phases: workflowPhases(spec), successSignals: workflowSuccessSignals(spec) } : {}),
	};
}

function formatInvocation(spec: EvolutionArtifact, input: Record<string, unknown> | undefined): string {
	if (spec.kind === "workflow_spec") return formatWorkflowInvocation(spec, input);
	const suppliedInput = input && Object.keys(input).length > 0 ? `\nSupplied input:\n${JSON.stringify(input, null, 2)}` : "";
	const steps = structuredSteps(spec);
	const toolNames = existingToolNames(spec);
	const structuredPlan = steps.length > 0
		? `\nStructured plan:\n${steps.map((step, index) => `${index + 1}. ${step.name}: ${step.instruction}`).join("\n")}`
		: "";
	const existingTools = toolNames.length > 0 ? `\nUse existing tools only: ${toolNames.join(", ")}` : "";
	return [
		`Evolved tool: ${spec.title}`,
		`ID: ${spec.id}`,
		"",
		"Procedure:",
		spec.content,
		spec.applicability ? `\nApplicability: ${spec.applicability}` : "",
		spec.nonApplicability ? `\nDo not use when: ${spec.nonApplicability}` : "",
		suppliedInput,
		structuredPlan,
		existingTools,
		"",
		"This evolved tool is declarative: use normal Catui tools and current permissions to carry out the procedure. Do not execute generated code, install packages, or create new external servers from this spec.",
	].filter(Boolean).join("\n");
}

function formatWorkflowInvocation(spec: EvolutionArtifact, input: Record<string, unknown> | undefined): string {
	const suppliedInput = input && Object.keys(input).length > 0 ? `\nSupplied input:\n${JSON.stringify(input, null, 2)}` : "";
	const phases = workflowPhases(spec);
	const successSignals = workflowSuccessSignals(spec);
	const phaseText = phases.length > 0
		? `\nWorkflow phases:\n${phases.map((phase, index) => [
			`${index + 1}. ${phase.name}`,
			...phase.checks.map((check) => `   - ${check}`),
		].join("\n")).join("\n")}`
		: "";
	const successText = successSignals.length > 0
		? `\nSuccess signals:\n${successSignals.map((signal) => `- ${signal}`).join("\n")}`
		: "";
	const toolNames = existingToolNames(spec);
	const existingTools = toolNames.length > 0 ? `\nUse existing tools only: ${toolNames.join(", ")}` : "";
	return [
		`Evolved workflow: ${spec.title}`,
		`ID: ${spec.id}`,
		"",
		"Workflow intent:",
		spec.content,
		spec.applicability ? `\nApplicability: ${spec.applicability}` : "",
		spec.nonApplicability ? `\nDo not use when: ${spec.nonApplicability}` : "",
		suppliedInput,
		phaseText,
		successText,
		existingTools,
		"",
		"This evolved workflow is declarative: execute only through normal Catui tools, current permissions, and explicit user approval where required. Do not install packages, run generated code, create external servers, or publish without the existing release checks.",
	].filter(Boolean).join("\n");
}

export function createEvolvedTool(): ToolDefinition<typeof EvolvedToolInput, unknown> {
	return {
		name: "evolved_tool",
		label: "Evolved Tool",
		description:
			"List or invoke user-promoted evolved tool and workflow specifications. These are reusable declarative assets created by Catui's controlled self-evolution and must be carried out using existing tools and permissions.",
		parameters: EvolvedToolInput,
		isConcurrencySafe: true,
		guidance:
			"Use evolved_tool when a promoted evolved tool_spec or workflow_spec may fit the task. It returns reusable procedure guidance only; it does not execute generated code.",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const specs = activeDeclarativeSpecs(ctx);
			if (params.action === "list") return textResult(formatToolList(specs), { count: specs.length });
			if (!params.id) return textResult("Error: action=invoke requires id.", { error: "missing_id" });
			const activeSpec = specs.find((candidate) => candidate.artifact.id === params.id);
			if (!activeSpec) return textResult(`Error: promoted evolved tool or workflow spec not found: ${params.id}`, { error: "not_found", id: params.id });
			const spec = activeSpec.artifact;
			const missing = missingInputs(spec, params.input);
			if (missing.length > 0) {
				recordEvolutionUsage(activeSpec.scopeRoot, {
					artifact: spec,
					scope: activeSpec.scope,
					revisionId: activeSpec.revisionId,
					status: "error",
					input: params.input,
					error: "missing_required_input",
				});
				return textResult(`Error: missing required input: ${missing.join(", ")}`, {
					error: "missing_required_input",
					id: spec.id,
					missing,
					required: Object.keys(inputContract(spec)),
				});
			}
			recordEvolutionUsage(activeSpec.scopeRoot, {
				artifact: spec,
				scope: activeSpec.scope,
				revisionId: activeSpec.revisionId,
				status: "success",
				input: params.input,
				resultSummary: spec.kind === "workflow_spec" ? "workflow_plan_returned" : "tool_plan_returned",
			});
			return textResult(formatInvocation(spec, params.input), {
				id: spec.id,
				title: spec.title,
				plan: invocationPlan(spec, params.input),
			});
		},
	};
}
