/**
 * [WHO]: Provides evolved_executable_tool, a workspace-only no-IO runtime for approved executable_tool artifacts
 * [FROM]: Depends on TypeBox, extension context, crypto hash verification, and evolution active artifact loading
 * [TO]: Consumed by optional evolution extension entry
 * [HERE]: extensions/optional/evolution/evolution-executable-tool.ts - restricted executable evolution prototype
 */

import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { AgentToolResult } from "@catui/agent-core";
import type { ExtensionContext, ToolDefinition } from "../../../core/extensions-host/types.js";
import { getEvolutionScopeRoot, loadActiveEvolutionArtifacts } from "./evolution-store.js";
import type { EvolutionArtifact } from "./evolution-types.js";

const ExecutableToolInput = Type.Object({
	action: Type.Union([Type.Literal("list"), Type.Literal("invoke")], {
		description: "Use list to discover promoted workspace executable tools; use invoke to run one approved no-IO tool.",
	}),
	id: Type.Optional(Type.String({ description: "The evolved:executable_tool:<id> to invoke." })),
	input: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "JSON input for the executable tool manifest." })),
});

interface ExecutableManifest {
	schemaVersion: 1;
	description: string;
	steps: Array<{
		op: "template";
		output: string;
		template: string;
	}>;
}

function textResult(text: string, details: unknown): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details };
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function assertApprovedExecutableTool(artifact: EvolutionArtifact): ExecutableManifest {
	if (artifact.kind !== "executable_tool") throw new Error(`Artifact is not executable_tool: ${artifact.id}`);
	if (artifact.metadata?.approvedContentHash !== `sha256:${sha256(artifact.content)}`) {
		throw new Error(`Executable tool hash approval failed: ${artifact.id}`);
	}
	const permissions = artifact.metadata.permissionManifest;
	if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
		throw new Error(`Executable tool permission manifest missing: ${artifact.id}`);
	}
	const permissionRecord = permissions as Record<string, unknown>;
	if (
		permissionRecord.workspaceOnly !== true ||
		permissionRecord.network !== false ||
		permissionRecord.install !== false ||
		permissionRecord.write !== "none"
	) {
		throw new Error(`Executable tool permission manifest is not no-IO workspace-only: ${artifact.id}`);
	}
	const parsed = JSON.parse(artifact.content) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`Executable tool manifest is invalid: ${artifact.id}`);
	const manifest = parsed as Partial<ExecutableManifest>;
	if (manifest.schemaVersion !== 1 || typeof manifest.description !== "string" || !Array.isArray(manifest.steps)) {
		throw new Error(`Executable tool manifest is invalid: ${artifact.id}`);
	}
	for (const step of manifest.steps) {
		if (step?.op !== "template" || typeof step.output !== "string" || typeof step.template !== "string") {
			throw new Error(`Executable tool manifest contains unsupported step: ${artifact.id}`);
		}
	}
	return manifest as ExecutableManifest;
}

function activeExecutableTools(ctx: ExtensionContext): EvolutionArtifact[] {
	const workspaceRoot = getEvolutionScopeRoot(ctx.agentDir, { scope: "workspace", cwd: ctx.cwd });
	return loadActiveEvolutionArtifacts(workspaceRoot).filter((artifact) => artifact.kind === "executable_tool");
}

function formatList(artifacts: readonly EvolutionArtifact[]): string {
	if (artifacts.length === 0) return "No promoted workspace executable tools are active for this workspace.";
	return [
		"Promoted workspace executable tools:",
		...artifacts.map((artifact) => `- ${artifact.id}: ${artifact.title}${artifact.applicability ? ` (when: ${artifact.applicability})` : ""}`),
		"",
		"These tools run in Catui's restricted no-IO evolution runtime: no shell, no package install, no network, and no file writes.",
	].join("\n");
}

function templateValue(path: string, input: Record<string, unknown>, outputs: Record<string, string>): string {
	if (path.startsWith("input.")) {
		const key = path.slice("input.".length);
		const value = input[key];
		return value === undefined || value === null ? "" : String(value);
	}
	if (path.startsWith("outputs.")) {
		const key = path.slice("outputs.".length);
		return outputs[key] ?? "";
	}
	return "";
}

function renderTemplate(template: string, input: Record<string, unknown>, outputs: Record<string, string>): string {
	return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.]{0,127})\s*\}\}/g, (_match, key: string) => templateValue(key, input, outputs));
}

function executeManifest(manifest: ExecutableManifest, input: Record<string, unknown>): Record<string, string> {
	const outputs: Record<string, string> = {};
	for (const step of manifest.steps) {
		const rendered = renderTemplate(step.template, input, outputs);
		if (rendered.length > 4000) throw new Error(`Executable tool output exceeds 4000 characters: ${step.output}`);
		outputs[step.output] = rendered;
	}
	return outputs;
}

function formatInvocation(artifact: EvolutionArtifact, outputs: Record<string, string>): string {
	return [
		`Executable evolved tool: ${artifact.title}`,
		`ID: ${artifact.id}`,
		"",
		"Outputs:",
		...Object.entries(outputs).map(([key, value]) => `- ${key}: ${value}`),
		"",
		"Runtime: restricted no-IO workspace evolution runtime.",
	].join("\n");
}

export function createEvolvedExecutableTool(): ToolDefinition<typeof ExecutableToolInput, unknown> {
	return {
		name: "evolved_executable_tool",
		label: "Evolved Executable Tool",
		description:
			"List or invoke user-promoted workspace executable_tool artifacts. Execution is restricted to an install-free, no-network, no-write manifest interpreter.",
		parameters: ExecutableToolInput,
		isConcurrencySafe: true,
		guidance:
			"Use evolved_executable_tool only for promoted workspace executable_tool artifacts. It cannot run shell commands, install packages, access the network, or write files.",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const tools = activeExecutableTools(ctx);
			if (params.action === "list") return textResult(formatList(tools), { count: tools.length });
			if (!params.id) return textResult("Error: action=invoke requires id.", { error: "missing_id" });
			const artifact = tools.find((candidate) => candidate.id === params.id);
			if (!artifact) return textResult(`Error: promoted workspace executable tool not found: ${params.id}`, { error: "not_found", id: params.id });
			try {
				const manifest = assertApprovedExecutableTool(artifact);
				const outputs = executeManifest(manifest, params.input ?? {});
				return textResult(formatInvocation(artifact, outputs), {
					id: artifact.id,
					title: artifact.title,
					outputs,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`Error: ${message}`, { error: message, id: artifact.id });
			}
		},
	};
}
