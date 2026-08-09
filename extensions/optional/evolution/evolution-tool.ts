/**
 * [WHO]: createEvolvedTool exposes promoted tool_spec artifacts as controlled model-callable structured plans
 * [FROM]: Depends on @catui/agent-core result shape, TypeBox schema, extension context, and evolution store/format data
 * [TO]: Consumed by optional evolution extension entry
 * [HERE]: extensions/optional/evolution/evolution-tool.ts - declarative evolved tool invocation boundary
 */

import { Type } from "@sinclair/typebox";
import type { AgentToolResult } from "@catui/agent-core";
import type { ExtensionContext, ToolDefinition } from "../../../core/extensions-host/types.js";
import { getEvolutionScopeRoot, loadActiveEvolutionArtifacts } from "./evolution-store.js";
import type { EvolutionArtifact } from "./evolution-types.js";

const EvolvedToolInput = Type.Object({
	action: Type.Union([Type.Literal("list"), Type.Literal("invoke")], {
		description: "Use list to discover promoted evolved tool specs; use invoke to retrieve one spec's reusable procedure.",
	}),
	id: Type.Optional(Type.String({ description: "The evolved:tool_spec:<id> to invoke." })),
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
	title: string;
	inputs: Record<string, unknown>;
	steps: EvolvedToolStep[];
	usesExistingTools: string[];
}

function activeToolSpecs(ctx: ExtensionContext): EvolutionArtifact[] {
	const roots = [
		getEvolutionScopeRoot(ctx.agentDir, { scope: "global" }),
		getEvolutionScopeRoot(ctx.agentDir, { scope: "workspace", cwd: ctx.cwd }),
		getEvolutionScopeRoot(ctx.agentDir, { scope: "session", sessionId: ctx.sessionManager.getSessionId() }),
	];
	return roots.flatMap((root) => loadActiveEvolutionArtifacts(root)).filter((artifact) => artifact.kind === "tool_spec");
}

function formatToolList(specs: readonly EvolutionArtifact[]): string {
	if (specs.length === 0) return "No promoted evolved tool specs are active for this session.";
	return [
		"Promoted evolved tool specs:",
		...specs.map((spec) => `- ${spec.id}: ${spec.title}${spec.applicability ? ` (when: ${spec.applicability})` : ""}`),
		"",
		"Invoke one with action=invoke and its full id. These are declarative reusable tools; they guide use of existing Catui tools and do not execute generated code.",
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

function missingInputs(spec: EvolutionArtifact, input: Record<string, unknown> | undefined): string[] {
	const required = Object.keys(inputContract(spec));
	if (required.length === 0) return [];
	return required.filter((name) => input?.[name] === undefined || input[name] === null || input[name] === "");
}

function invocationPlan(spec: EvolutionArtifact, input: Record<string, unknown> | undefined): EvolvedToolPlan {
	return {
		id: spec.id,
		title: spec.title,
		inputs: input ?? {},
		steps: structuredSteps(spec),
		usesExistingTools: existingToolNames(spec),
	};
}

function formatInvocation(spec: EvolutionArtifact, input: Record<string, unknown> | undefined): string {
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

export function createEvolvedTool(): ToolDefinition<typeof EvolvedToolInput, unknown> {
	return {
		name: "evolved_tool",
		label: "Evolved Tool",
		description:
			"List or invoke user-promoted evolved tool specifications. These are reusable declarative tools created by Catui's controlled self-evolution and must be carried out using existing tools and permissions.",
		parameters: EvolvedToolInput,
		isConcurrencySafe: true,
		guidance:
			"Use evolved_tool when a promoted evolved tool_spec may fit the task. It returns reusable procedure guidance only; it does not execute generated code.",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const specs = activeToolSpecs(ctx);
			if (params.action === "list") return textResult(formatToolList(specs), { count: specs.length });
			if (!params.id) return textResult("Error: action=invoke requires id.", { error: "missing_id" });
			const spec = specs.find((candidate) => candidate.id === params.id);
			if (!spec) return textResult(`Error: promoted evolved tool spec not found: ${params.id}`, { error: "not_found", id: params.id });
			const missing = missingInputs(spec, params.input);
			if (missing.length > 0) {
				return textResult(`Error: missing required input: ${missing.join(", ")}`, {
					error: "missing_required_input",
					id: spec.id,
					missing,
					required: Object.keys(inputContract(spec)),
				});
			}
			return textResult(formatInvocation(spec, params.input), {
				id: spec.id,
				title: spec.title,
				plan: invocationPlan(spec, params.input),
			});
		},
	};
}
