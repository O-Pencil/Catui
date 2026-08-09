/**
 * [WHO]: Promoted declarative prompt, memory, delegation, and tool-planning consumers
 * [FROM]: Depends on ExtensionContext, evolution store, workflow precedence, and artifact types
 * [TO]: Consumed by the evolution before-agent hook
 * [HERE]: extensions/optional/evolution/consumers.ts - non-executable active-context rendering
 */
import type { ExtensionContext } from "../../../core/extensions-host/types.js";
import { EvolutionStore } from "./store.js";
import type { EvolutionArtifact, EvolutionScope } from "./types.js";
import { mergeScopedArtifacts } from "./workflow.js";

const EVOLVED_CONTEXT_BYTE_BUDGET = 4_096;

function storeFor(ctx: ExtensionContext): EvolutionStore {
	return new EvolutionStore({ agentDir: ctx.agentDir, cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() });
}

function appliesToPrompt(artifact: EvolutionArtifact, prompt: string): boolean {
	const normalized = prompt.toLocaleLowerCase();
	const matches = (condition: string): boolean => normalized.includes(condition.toLocaleLowerCase());
	return artifact.applicability.some(matches) && !artifact.nonApplicability.some(matches);
}

function truncateUtf8(value: string, maxBytes: number): string {
	let bytes = 0;
	let end = 0;
	for (const character of value) {
		const width = Buffer.byteLength(character, "utf8");
		if (bytes + width > maxBytes) break;
		bytes += width;
		end += character.length;
	}
	return value.slice(0, end);
}

export async function evolvedActivePrompt(ctx: ExtensionContext, prompt: string): Promise<string | undefined> {
	const store = storeFor(ctx);
	const scoped: Array<{ scope: EvolutionScope; artifacts: EvolutionArtifact[] }> = [];
	for (const scope of ["global", "workspace", "session"] as const) {
		try {
			const manifest = await store.readActiveManifest(scope);
			if (!manifest) continue;
			scoped.push({ scope, artifacts: manifest.artifacts.filter((artifact) => artifact.kind !== "skill_manifest") });
		} catch {
			// A corrupt evolution scope disables only that scope; normal sessions continue.
		}
	}
	const groups: Record<"context" | "delegation" | "tools", string[]> = { context: [], delegation: [], tools: [] };
	let remainingCharacters = EVOLVED_CONTEXT_BYTE_BUDGET;
	for (const artifact of mergeScopedArtifacts(scoped)) {
		if (!appliesToPrompt(artifact, prompt) || remainingCharacters <= 0) continue;
		const bounded = artifact.content.slice(0, Math.min(artifact.promptTokenBudget * 4, remainingCharacters));
		remainingCharacters -= bounded.length;
		const rendered = `[${artifact.id} | ${artifact.scope} | candidate:${artifact.provenance.sourceCandidateId}]\n${bounded}`;
		if (artifact.kind === "subagent_spec") groups.delegation.push(rendered);
		else if (artifact.kind === "tool_spec") groups.tools.push(rendered);
		else groups.context.push(rendered);
	}
	const sections: string[] = [];
	if (groups.context.length > 0) sections.push(`## Evolved Prompt, Memory & Preference Facets\n${groups.context.join("\n\n")}`);
	if (groups.delegation.length > 0) {
		sections.push(`## Evolved Delegation Catalog\nPlanning-only guidance for using Catui's existing Agent/subagent capabilities; these entries do not alter built-in definitions, tools, or permissions.\n\n${groups.delegation.join("\n\n")}`);
	}
	if (groups.tools.length > 0) {
		sections.push(`## Evolved Tool Design Backlog\nThese specifications are planning-only and are not registered as executable tools, commands, packages, or MCP servers.\n\n${groups.tools.join("\n\n")}`);
	}
	if (sections.length === 0) return undefined;
	return truncateUtf8(
		`# Promoted Evolved Context\nSupplementary only; explicit user/project resources and built-in safety rules take precedence.\n\n${sections.join("\n\n")}`,
		EVOLVED_CONTEXT_BYTE_BUDGET,
	);
}
