/**
 * [WHO]: Existing-scope artifact inventory, LLM proposal prompt, JSON extraction, and candidate input normalization for /refine
 * [FROM]: Depends on extension context completion APIs, evolution-store for the target scope root, and local evolution contracts
 * [TO]: Consumed by optional evolution extension command handler
 * [HERE]: extensions/optional/evolution/evolution-refiner.ts - untrusted model output boundary
 */

import type { ExtensionCommandContext } from "../../../core/extensions-host/types.js";
import type { SessionEntry } from "../../../core/session/session-manager.js";
import { redactEvolutionEvidence } from "./prompts.js";
import { getEvolutionScopeRoot, loadActiveEvolutionArtifacts } from "./evolution-store.js";
import type { EvolutionArtifact, EvolutionArtifactKind, EvolutionCandidateInput, EvolutionPredictionDirection, EvolutionScope } from "./evolution-types.js";

const REFINER_SYSTEM_PROMPT = `You are Catui's controlled self-evolution proposal writer.

Create small, evidence-backed declarative harness improvements from the current session.
Allowed artifact kinds:
- prompt_note: supplemental behavior note, never the base system prompt.
- memory: durable fact, preference, failure, decision, or outcome.
- skill_manifest: non-executable reusable procedure description only. Its body must carry four
  markdown headings, "## Prerequisites", "## Steps", "## Pitfalls", and "## Verification", and it
  must set applicability (what triggers it) and nonApplicability (where it does not apply). A body
  missing any of them is rejected at the store before it can become active.
- subagent_spec: non-executable delegation role description only.
- tool_spec: non-executable capability description only.

Never propose source patches, JavaScript, TypeScript, Python, shell commands, package installs, MCP server commands, network endpoints, credentials, or permission escalation.
IDs must be namespaced as evolved:<kind>:<stable-slug>.

If the change refines a skill already listed as active at this scope, set
"overrides": { "skillId": "<that id>" } on it. That updates the existing skill in place instead of
adding a near-duplicate beside it. Leave "overrides" off when the artifact is genuinely new.

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
      "overrides": { "skillId": "evolved:skill_manifest:the-id-being-improved" },
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

/**
 * Active artifacts already live at this scope, listed so the refiner updates one instead of
 * emitting a near-duplicate under a fresh id. Titles and ids only: the full body of a live skill
 * is not the refiner's to restate, and the model is about to author a competing version of it.
 *
 * Bounded because this is prompt text on every refine call. A large library degrades the
 * instruction it sits inside, which is the opposite of the intent.
 */
const MAX_EXISTING_ARTIFACTS_LISTED = 40;

function existingArtifactInventory(ctx: ExtensionCommandContext, scope: EvolutionScope): string {
	// Mirrors the selector the command handler builds, so the refiner reads the same scope root
	// the candidate will be written to. Reusing that rule keeps the two from drifting.
	const scopeRoot = getEvolutionScopeRoot(
		ctx.agentDir,
		scope === "global"
			? { scope }
			: scope === "workspace"
				? { scope, cwd: ctx.cwd }
				: { scope, sessionId: ctx.sessionManager.getSessionId() },
	);
	let active: EvolutionArtifact[];
	try {
		active = loadActiveEvolutionArtifacts(scopeRoot);
	} catch {
		// A missing or unreadable revision must not block a proposal; the refiner simply has no
		// inventory and behaves exactly as it did before this lookup existed.
		return "";
	}
	if (active.length === 0) return "";
	const listed = active.slice(0, MAX_EXISTING_ARTIFACTS_LISTED);
	const lines = listed.map((artifact) => `- ${artifact.id} (${artifact.kind}): ${artifact.title}`);
	const overflow = active.length - listed.length;
	return [
		"Already active at this scope. Reuse one of these ids when your change refines existing work;",
		"propose a new id only when nothing above covers it.",
		...lines,
		...(overflow > 0 ? [`- ...and ${overflow} more not listed.`] : []),
	].join("\n");
}

/**
 * The model is asked for `"overrides": { "skillId": "..." }`, but an untrusted payload can put a
 * string or a nested object there. The store rejects anything malformed; normalizing here keeps
 * the rejection message about the real problem instead of a type mismatch.
 */
function normalizeOverrides(value: Record<string, unknown>): { overrides?: { skillId: string } } {
	const raw = value.overrides;
	if (typeof raw === "string") return raw.trim() ? { overrides: { skillId: raw } } : {};
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
	const skillId = (raw as Record<string, unknown>).skillId;
	return typeof skillId === "string" && skillId.trim() ? { overrides: { skillId } } : {};
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
		...normalizeOverrides(record),
	};
}

export async function planEvolutionCandidate(
	ctx: ExtensionCommandContext,
	scope: EvolutionScope,
	instructions: string,
): Promise<EvolutionCandidateInput> {
	// The inventory is built first but joined inside the redacted block below, so a persisted id
	// or title carrying a secret or private path is scrubbed on the same path as session text.
	const inventory = existingArtifactInventory(ctx, scope);
	// Session text is untrusted data that may contain credentials or private paths. Redact before
	// it leaves the process, not after the model has already seen it.
	const userMessage = redactEvolutionEvidence(
		[
			instructions ? `User refinement instructions:\n${instructions}` : "User refinement instructions: propose the smallest useful reusable harness update.",
			...(inventory ? ["", inventory] : []),
			"",
			"Recent session trajectory:",
			sessionExcerpt(ctx.sessionManager.getEntries()),
		].join("\n"),
		[ctx.cwd, ctx.agentDir],
	);
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
