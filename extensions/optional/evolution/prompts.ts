/**
 * [WHO]: Bounded/redacted session evidence and structured refinement proposal prompt construction
 * [FROM]: Depends on Node crypto and extension-local evolution types
 * [TO]: Consumed by the optional evolution extension command
 * [HERE]: extensions/optional/evolution/prompts.ts - model-facing refinement boundary
 */
import { createHash } from "node:crypto";
import type { EvolutionScope } from "./types.js";

export const PROPOSAL_DRAFT_SCHEMA: Record<string, unknown> = {
	type: "object",
	additionalProperties: false,
	required: ["summary", "expectedOutcome", "artifacts"],
	properties: {
		summary: { type: "string", minLength: 1, maxLength: 500 },
		expectedOutcome: { type: "string", minLength: 1, maxLength: 1_000 },
		artifacts: {
			type: "array",
			minItems: 1,
			maxItems: 8,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "kind", "title", "content", "applicability", "nonApplicability", "promptTokenBudget", "dependencies", "expectedOutcome"],
				properties: {
					id: { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{0,79}$" },
					kind: { enum: ["prompt_note", "memory", "skill_manifest", "subagent_spec", "tool_spec"] },
					title: { type: "string", minLength: 1, maxLength: 200 },
					content: { type: "string", minLength: 1, maxLength: 20_000 },
					applicability: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
					nonApplicability: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
					promptTokenBudget: { type: "integer", minimum: 0, maximum: 4_096 },
					dependencies: { type: "array", items: { type: "string", minLength: 1 } },
					expectedOutcome: { type: "string", minLength: 1, maxLength: 1_000 },
					overrides: { type: "string", pattern: "^evolved:" },
				},
			},
		},
	},
};

const SYSTEM_PROMPT = `You are Catui's controlled continual-harness refinement planner.
Propose only small, evidence-backed declarative artifacts. The base system prompt, built-in tools, user resources, source files, commands, packages, MCP servers, network endpoints, credentials, and permissions are immutable.
Allowed kinds: prompt_note, memory, skill_manifest, subagent_spec, tool_spec. tool_spec is descriptive and non-executable. Return only the requested JSON object. One-off noise and unsupported hypotheses must not become artifacts.`;

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function redactEvolutionEvidence(value: string, privatePaths: readonly string[]): string {
	let redacted = value;
	for (const path of [...privatePaths].sort((a, b) => b.length - a.length)) {
		if (path.length > 0) redacted = redacted.split(path).join("[REDACTED_PATH]");
	}
	redacted = redacted.replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/gi, "[REDACTED_SECRET]");
	redacted = redacted.replace(/\bauthorization\s*:\s*(?:bearer|basic)\s+\S+/gi, "[REDACTED_SECRET]");
	redacted = redacted.replace(/\b(?:sk-(?:proj-)?|gh[pousr]_|xox[baprs]-|AIza)[A-Za-z0-9._-]{8,}/g, "[REDACTED_SECRET]");
	redacted = redacted.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_SECRET]");
	redacted = redacted.replace(/\bAWS_(?:SECRET_ACCESS_KEY|SESSION_TOKEN)\s*=\s*\S+/g, "[REDACTED_SECRET]");
	redacted = redacted.replace(/["']?(?:api_key|client_secret|private_key|access_token|refresh_token)["']?\s*:\s*["'][\s\S]*?["']/gi, "[REDACTED_SECRET]");
	redacted = redacted.replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*(?:["'][\s\S]*?["']|\S+)/gi, "[REDACTED_SECRET]");
	redacted = redacted.replace(/(?:\/Users\/|\/home\/)[^\s"']+/g, "[REDACTED_PATH]");
	return redacted;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((block) => {
		if (typeof block === "object" && block !== null && "type" in block && block.type === "text" && "text" in block && typeof block.text === "string") return block.text;
		return `[non-text content omitted:${digest(JSON.stringify(block))}]`;
	}).join("\n");
}

export interface SessionEvidenceEntry {
	id: string;
	type: string;
	role?: string;
	content: string;
}

export function boundedSessionEvidence(entries: readonly unknown[], privatePaths: readonly string[]): SessionEvidenceEntry[] {
	return entries.slice(-12).map((entry, index) => {
		const record = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
		const message = typeof record.message === "object" && record.message !== null ? record.message as Record<string, unknown> : {};
		const raw = contentText(message.content).slice(0, 2_000);
		return {
			id: typeof record.id === "string" ? record.id : `entry-${index}`,
			type: typeof record.type === "string" ? record.type : "unknown",
			...(typeof message.role === "string" ? { role: message.role } : {}),
			content: redactEvolutionEvidence(raw, privatePaths),
		};
	});
}

export function buildRefinementPrompt(input: {
	scope: EvolutionScope;
	baselineRevisionId: string | null;
	instructions: string;
	evidence: SessionEvidenceEntry[];
}): { systemPrompt: string; userPrompt: string } {
	return {
		systemPrompt: SYSTEM_PROMPT,
		userPrompt: JSON.stringify({
			scope: input.scope,
			baselineRevisionId: input.baselineRevisionId,
			instructions: input.instructions || "Identify the smallest reusable improvement supported by this session.",
			evidence: input.evidence,
		}),
	};
}
