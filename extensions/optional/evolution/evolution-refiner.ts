/**
 * [WHO]: LLM proposal prompt, JSON extraction, and candidate input normalization for /refine
 * [FROM]: Depends on extension context completion APIs and local evolution contracts
 * [TO]: Consumed by optional evolution extension command handler
 * [HERE]: extensions/optional/evolution/evolution-refiner.ts - untrusted model output boundary
 */

import type { ExtensionCommandContext } from "../../../core/extensions-host/types.js";
import type { SessionEntry } from "../../../core/session/session-manager.js";
import type { EvolutionArtifact, EvolutionArtifactKind, EvolutionCandidateInput, EvolutionPredictionDirection, EvolutionScope } from "./evolution-types.js";

const REFINER_SYSTEM_PROMPT = `You are Catui's controlled self-evolution proposal writer.

Create small, evidence-backed declarative harness improvements from the current session.
Allowed artifact kinds:
- prompt_note: supplemental behavior note, never the base system prompt.
- memory: durable fact, preference, failure, decision, or outcome.
- skill_manifest: non-executable reusable procedure description only.
- subagent_spec: non-executable delegation role description only.
- tool_spec: non-executable capability description only.

Never propose source patches, JavaScript, TypeScript, Python, shell commands, package installs, MCP server commands, network endpoints, credentials, or permission escalation.
IDs must be namespaced as evolved:<kind>:<stable-slug>.

Return JSON only:
{
  "summary": "one sentence",
  "rationale": "evidence from this trajectory",
  "expectedOutcome": "what should improve",
  "predictions": [
    {
      "id": "prediction-stable-slug",
      "metric": "harness_eval.passRate|token.cost|tool_success_rate|manual_metric",
      "direction": "increase|decrease|stay_at_or_above|stay_at_or_below|no_regression",
      "target": "falsifiable threshold or baseline comparison",
      "rationale": "why this edit should move that metric"
    }
  ],
  "artifacts": [
    {
      "id": "evolved:prompt_note:stable-slug",
      "kind": "prompt_note|memory|skill_manifest|subagent_spec|tool_spec",
      "title": "short title",
      "content": "declarative content only",
      "applicability": "when to use",
      "nonApplicability": "when not to use",
      "tokenBudget": 80,
      "metadata": {}
    }
  ]
}`;

function textFromEntry(entry: SessionEntry): string | undefined {
	if (entry.type === "message") {
		const message = entry.message as unknown as Record<string, unknown>;
		const role = typeof message.role === "string" ? message.role : "message";
		const content = message.content;
		if (typeof content === "string") return `${role}: ${content}`;
		if (Array.isArray(content)) {
			return `${role}: ${content
				.map((part) => {
					if (typeof part !== "object" || part === null) return String(part);
					const record = part as Record<string, unknown>;
					if (typeof record.text === "string") return record.text;
					return typeof record.type === "string" ? `[${record.type}]` : "[part]";
				})
				.join(" ")}`;
		}
		return undefined;
	}
	if (entry.type === "compaction") return `compaction: ${entry.summary}`;
	if (entry.type === "branch_summary") return `branch_summary: ${entry.summary}`;
	if (entry.type === "custom_message" && typeof entry.content === "string") return `custom:${entry.customType}: ${entry.content}`;
	return undefined;
}

function sessionExcerpt(entries: readonly SessionEntry[]): string {
	return entries
		.map(textFromEntry)
		.filter((line): line is string => Boolean(line))
		.slice(-40)
		.join("\n\n")
		.slice(-24_000);
}

function extractJson(text: string): unknown {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced?.[1]?.trim() ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
	if (!candidate || !candidate.startsWith("{")) throw new Error("Refiner did not return a JSON object.");
	return JSON.parse(candidate);
}

function artifactKind(value: unknown): EvolutionArtifactKind | undefined {
	return value === "prompt_note" || value === "memory" || value === "skill_manifest" || value === "subagent_spec" || value === "tool_spec"
		? value
		: undefined;
}

function predictionDirection(value: unknown): EvolutionPredictionDirection | undefined {
	return value === "increase" || value === "decrease" || value === "stay_at_or_above" || value === "stay_at_or_below" || value === "no_regression"
		? value
		: undefined;
}

function normalizeArtifact(value: unknown): EvolutionArtifact | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const kind = artifactKind(record.kind);
	if (!kind || typeof record.title !== "string" || typeof record.content !== "string") return undefined;
	const id = typeof record.id === "string" ? record.id : `evolved:${kind}:${record.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
	return {
		id,
		kind,
		title: record.title,
		content: record.content,
		...(typeof record.applicability === "string" ? { applicability: record.applicability } : {}),
		...(typeof record.nonApplicability === "string" ? { nonApplicability: record.nonApplicability } : {}),
		...(typeof record.tokenBudget === "number" ? { tokenBudget: record.tokenBudget } : {}),
		...(typeof record.metadata === "object" && record.metadata !== null && !Array.isArray(record.metadata)
			? { metadata: record.metadata as Record<string, unknown> }
			: {}),
	};
}

export async function planEvolutionCandidate(
	ctx: ExtensionCommandContext,
	scope: EvolutionScope,
	instructions: string,
): Promise<EvolutionCandidateInput> {
	const userMessage = [
		instructions ? `User refinement instructions:\n${instructions}` : "User refinement instructions: propose the smallest useful reusable harness update.",
		"",
		"Recent session trajectory:",
		sessionExcerpt(ctx.sessionManager.getEntries()),
	].join("\n");
	const response = await ctx.completeSimple(REFINER_SYSTEM_PROMPT, userMessage);
	if (!response) throw new Error("Refine unavailable: no model response. Check the selected model and API key.");
	const parsed = extractJson(response);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Refiner JSON must be an object.");
	const record = parsed as Record<string, unknown>;
	const artifacts = Array.isArray(record.artifacts) ? record.artifacts.map(normalizeArtifact).filter((artifact): artifact is EvolutionArtifact => Boolean(artifact)) : [];
	const predictions = Array.isArray(record.predictions)
		? record.predictions.flatMap((value) => {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
			const prediction = value as Record<string, unknown>;
			const direction = predictionDirection(prediction.direction);
			if (
				typeof prediction.id !== "string" ||
				typeof prediction.metric !== "string" ||
				typeof prediction.target !== "string" ||
				typeof prediction.rationale !== "string" ||
				!direction
			) {
				return [];
			}
			return [{ id: prediction.id, metric: prediction.metric, direction, target: prediction.target, rationale: prediction.rationale }];
		})
		: [];
	return {
		scope,
		summary: typeof record.summary === "string" ? record.summary : "Proposed evolved harness update",
		rationale: typeof record.rationale === "string" ? record.rationale : "Generated from current session trajectory.",
		expectedOutcome: typeof record.expectedOutcome === "string" ? record.expectedOutcome : "Future turns use the promoted artifact when applicable.",
		artifacts,
		...(predictions.length > 0 ? { predictions } : {}),
		evidence: {
			source: "session",
			entryCount: ctx.sessionManager.getEntries().length,
			generatedAt: new Date().toISOString(),
		},
	};
}
