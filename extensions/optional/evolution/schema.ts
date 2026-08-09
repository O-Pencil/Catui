/**
 * [WHO]: Pure validation for untrusted declarative self-evolution proposals
 * [FROM]: Depends on extension-local evolution types
 * [TO]: Consumed before any candidate persistence or activation
 * [HERE]: extensions/optional/evolution/schema.ts - v1 generated-artifact trust boundary
 */
import {
	ARTIFACT_KINDS,
	EVOLUTION_SCOPES,
	type ArtifactKind,
	type EvolutionArtifact,
	type EvolutionProposal,
	type ProposalValidation,
} from "./types.js";

const MAX_ARTIFACT_CONTENT = 20_000;
const MAX_TOTAL_CONTENT = 50_000;
const MAX_PROMPT_TOKEN_BUDGET = 4_096;
const EXECUTABLE_PATTERNS = [
	/\bcommand\s*:/i,
	/\b(?:npm|pnpm|yarn|pip|cargo)\s+(?:install|add)\b/i,
	/\b(?:bash|sh|python|node)\s+-[ce]\b/i,
	/\b(?:mcp[_ -]?server|registerTool|child_process|execSync|spawnSync)\b/i,
];
const NETWORK_PATTERN = /\b(?:https?|wss?):\/\/\S+/i;
const SECRET_PATTERN = /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/i;
const ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'`])(?:\/[A-Za-z0-9._-]+){2,}(?:\/[A-Za-z0-9._-]+)?/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown, requireNonEmpty = false): value is string[] {
	return Array.isArray(value) && (!requireNonEmpty || value.length > 0) && value.every(isNonEmptyString);
}

function validateArtifact(value: unknown, index: number, proposal: EvolutionProposal, issues: string[]): void {
	const path = `artifacts[${index}]`;
	if (!isRecord(value)) {
		issues.push(`${path} must be an object`);
		return;
	}
	if (value.schemaVersion !== 1) issues.push(`${path}.schemaVersion must be 1`);
	if (!ARTIFACT_KINDS.includes(value.kind as ArtifactKind)) issues.push(`${path}.kind is not a supported declarative kind`);
	const kind = value.kind as string;
	if (!isNonEmptyString(value.id) || !value.id.startsWith(`evolved:${kind}:`)) {
		issues.push(`${path}.id must start with evolved:${kind}:`);
	}
	if (!isNonEmptyString(value.title)) issues.push(`${path}.title is required`);
	if (!isNonEmptyString(value.content)) issues.push(`${path}.content is required`);
	if (!EVOLUTION_SCOPES.includes(value.scope as EvolutionProposal["scope"])) issues.push(`${path}.scope is invalid`);
	if (value.scope !== proposal.scope) issues.push(`${path}.scope must match proposal scope`);
	if (!Number.isInteger(value.version) || (value.version as number) < 1) issues.push(`${path}.version must be positive`);
	if (!isNonEmptyString(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) issues.push(`${path}.createdAt is invalid`);
	if (!isStringArray(value.applicability, true)) issues.push(`${path}.applicability must contain at least one condition`);
	if (!isStringArray(value.nonApplicability, true)) issues.push(`${path}.nonApplicability must contain at least one condition`);
	if (!Number.isInteger(value.promptTokenBudget) || (value.promptTokenBudget as number) < 0 || (value.promptTokenBudget as number) > MAX_PROMPT_TOKEN_BUDGET) {
		issues.push(`${path}.promptTokenBudget must be between 0 and ${MAX_PROMPT_TOKEN_BUDGET}`);
	}
	if (!isStringArray(value.dependencies)) issues.push(`${path}.dependencies must be a string array`);
	if (!isNonEmptyString(value.expectedOutcome)) issues.push(`${path}.expectedOutcome is required`);
	if (!isRecord(value.provenance)) {
		issues.push(`${path}.provenance is required`);
	} else {
		if (value.provenance.sourceCandidateId !== proposal.id) issues.push(`${path}.provenance source candidate must match proposal`);
		if (!isNonEmptyString(value.provenance.trigger)) issues.push(`${path}.provenance.trigger is required`);
		if (!isStringArray(value.provenance.traceRefs, true)) issues.push(`${path}.provenance.traceRefs must contain evidence`);
	}
	if (typeof value.content === "string") {
		const content = value.content;
		if (content.length > MAX_ARTIFACT_CONTENT) issues.push(`${path}.content exceeds 20,000 characters`);
		if (EXECUTABLE_PATTERNS.some((pattern) => pattern.test(content))) issues.push(`${path}.content declares executable behavior`);
		if (NETWORK_PATTERN.test(content)) issues.push(`${path}.content declares a network endpoint`);
		if (SECRET_PATTERN.test(content)) issues.push(`${path}.content contains secret-like material`);
		if (ABSOLUTE_PATH_PATTERN.test(content)) issues.push(`${path}.content contains an absolute path`);
	}
}

export function validateProposal(value: unknown): ProposalValidation {
	const issues: string[] = [];
	if (!isRecord(value)) return { ok: false, issues: ["proposal must be an object"] };
	if (value.schemaVersion !== 1) issues.push("schemaVersion must be 1");
	if (!isNonEmptyString(value.id)) issues.push("id is required");
	if (!EVOLUTION_SCOPES.includes(value.scope as EvolutionProposal["scope"])) issues.push("scope is invalid");
	if (value.baselineRevisionId !== null && !isNonEmptyString(value.baselineRevisionId)) issues.push("baselineRevisionId must be null or a non-empty string");
	if (!isNonEmptyString(value.summary)) issues.push("summary is required");
	if (!isNonEmptyString(value.expectedOutcome)) issues.push("expectedOutcome is required");
	if (!isNonEmptyString(value.createdAt) || Number.isNaN(Date.parse(value.createdAt))) issues.push("createdAt is invalid");
	if (!isRecord(value.provenance)) {
		issues.push("provenance is required");
	} else {
		if (!isNonEmptyString(value.provenance.trigger)) issues.push("provenance.trigger is required");
		if (!isNonEmptyString(value.provenance.sessionId)) issues.push("provenance.sessionId is required");
		if (!isStringArray(value.provenance.traceRefs, true)) issues.push("provenance.traceRefs must contain evidence");
	}
	if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
		issues.push("artifacts must contain at least one artifact");
	} else {
		const proposal = value as unknown as EvolutionProposal;
		value.artifacts.forEach((artifact, index) => validateArtifact(artifact, index, proposal, issues));
		const ids = value.artifacts.map((artifact) => isRecord(artifact) ? artifact.id : undefined).filter(isNonEmptyString);
		for (const id of new Set(ids)) {
			if (ids.filter((candidate) => candidate === id).length > 1) issues.push(`duplicate artifact id: ${id}`);
		}
		const totalContent = value.artifacts.reduce((sum, artifact) => sum + (isRecord(artifact) && typeof artifact.content === "string" ? artifact.content.length : 0), 0);
		if (totalContent > MAX_TOTAL_CONTENT) issues.push(`artifact content exceeds aggregate ${MAX_TOTAL_CONTENT} character limit`);
	}
	return issues.length > 0 ? { ok: false, issues } : { ok: true, proposal: value as unknown as EvolutionProposal };
}

export function artifactKindFor(value: EvolutionArtifact): ArtifactKind {
	return value.kind;
}
