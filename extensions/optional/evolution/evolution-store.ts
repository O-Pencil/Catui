/**
 * [WHO]: Evolution ledger path resolution, validation, no-IO executable DSL manifests, usage records, prediction manifests, post-hoc attribution, eval_fixture dedupe/retention, gated promotion, quarantine, rollback, and conservative auto-rollback
 * [FROM]: Depends on node fs/path/crypto for owner-only runtime state below agentDir/evolution/v1
 * [TO]: Consumed by optional evolution extension command handlers and tests
 * [HERE]: extensions/optional/evolution/evolution-store.ts - durable store for controlled self-evolution
 */

import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type {
	EvolutionArtifact,
	EvolutionArtifactKind,
	EvolutionAttribution,
	EvolutionCandidate,
	EvolutionCandidateInput,
	EvolutionActiveFixtures,
	EvolutionCurrent,
	EvolutionGateReport,
	EvolutionInspection,
	EvolutionQuarantine,
	EvolutionRevision,
	EvolutionScopeSelector,
	EvolutionValidationReport,
	EvolutionPrediction,
	EvolutionPredictionAttribution,
	EvolutionStreamAttribution,
	EvolutionUsageRecord,
	EvolutionFeedbackRecord,
} from "./evolution-types.js";

const EVOLUTION_SCHEMA_VERSION = 1;
const MAX_ARTIFACTS_PER_CANDIDATE = 12;
const MAX_PREDICTIONS_PER_CANDIDATE = 8;
const MAX_CONTENT_CHARS = 4000;
const MAX_GLOBAL_AUTO_PROMOTE_CONTENT_CHARS = 800;
const MAX_TITLE_CHARS = 160;
const MAX_ACTIVE_EVAL_FIXTURES = 3;
const MAX_EXECUTABLE_DSL_PATTERN_CHARS = 240;
const SAFE_FILE_MODE = 0o600;

const ARTIFACT_KINDS: readonly EvolutionArtifactKind[] = [
	"prompt_note",
	"memory",
	"skill_manifest",
	"subagent_spec",
	"tool_spec",
	"workflow_spec",
	"executable_tool",
	"eval_fixture",
];

const PREDICTION_DIRECTIONS = new Set(["increase", "decrease", "stay_at_or_above", "stay_at_or_below", "no_regression"]);
type EvolutionStreamMode = NonNullable<EvolutionGateReport["streams"]>[number]["mode"];

const EXECUTABLE_PATTERNS: readonly RegExp[] = [
	/\b(?:npm|pnpm|yarn|bun|pip|pipx|uv|cargo|go|python|python3|node|npx|bash|sh|zsh)\s+(?:i|install|add|run|exec|-c|x)\b/i,
	/\b(?:brew|apt|apt-get|apk|dnf|yum|pacman)\s+(?:install|add)\b/i,
	/\b(?:docker|podman)\s+(?:run|compose|build|pull)\b/i,
	/\bgit\s+(?:clone|pull|push|apply|merge|reset)\b/i,
	/\b(?:curl|wget)\b.*\|\s*(?:sh|bash|zsh|python|node)\b/i,
	/\b(?:sudo|chmod|chown|rm\s+-rf|dd\s+if=|mkfs|launchctl|osascript)\b/i,
	/(?:^|\s)\.\/[A-Za-z0-9._/-]+/,
	/\b(?:api[_-]?key|secret|token|credential|password|authorization)\b\s*[:=]/i,
	/\bAuthorization\s*:\s*Bearer\b/i,
	/\bsk-[A-Za-z0-9_-]{16,}\b/,
	/\bhttps?:\/\/[^\s)]+/i,
	/\bmcpServers\b|\bserverCommand\b|\bpackage\.json\b|\bserver\s+(?:endpoint|url|command)\b/i,
];

const SECRET_REDACTION_PATTERNS: readonly RegExp[] = [
	/\bAuthorization\s*:\s*Bearer\s+[^\s,;)]+/gi,
	/\b(?:api[_-]?key|secret|token|credential|password)\b\s*[:=]\s*[^\s,;)]+/gi,
	/\bsk-[A-Za-z0-9_-]{16,}\b/g,
];

export interface EvolutionClockOptions {
	now?: () => string;
	id?: () => string;
}

export interface EvolutionPromotionOptions extends EvolutionClockOptions {
	approvedBy?: string;
	gateReport?: EvolutionGateReport;
}

export interface EvolutionRejectOptions extends EvolutionClockOptions {
	rejectedBy?: string;
}

export interface EvolutionRollbackOptions extends EvolutionClockOptions {
	requestedBy?: string;
}

export interface EvolutionGateFailureOptions extends EvolutionClockOptions {
	gateReport: EvolutionGateReport;
}

export interface EvolutionAttributionOptions extends EvolutionClockOptions {
	gateReport: EvolutionGateReport;
	attributedBy?: string;
}

export interface EvolutionAutoRollbackOptions extends EvolutionAttributionOptions {
	rollbackBy?: string;
}

export interface EvolutionUsageOptions extends EvolutionClockOptions {
	artifact: EvolutionArtifact;
	scope: EvolutionUsageRecord["scope"];
	revisionId?: string;
	status: EvolutionUsageRecord["status"];
	usedBy?: string;
	input?: Record<string, unknown>;
	resultSummary?: string;
	error?: string;
}

export interface EvolutionFeedbackOptions extends EvolutionClockOptions {
	usageId: string;
	outcome: EvolutionFeedbackRecord["outcome"];
	note?: string;
	recordedBy?: string;
}

function now(options?: EvolutionClockOptions): string {
	return options?.now?.() ?? new Date().toISOString();
}

function nextId(prefix: string, options?: EvolutionClockOptions): string {
	return options?.id?.() ?? `${prefix}-${randomUUID()}`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function safeSegment(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "unknown";
}

function evolvedSkillName(artifactId: string): string {
	const prefix = "evolved:skill_manifest:";
	const raw = artifactId.startsWith(prefix) ? artifactId.slice(prefix.length) : artifactId;
	return `evolved-${safeSegment(raw).toLowerCase()}`;
}

function skillMarkdown(artifact: EvolutionArtifact): string {
	const applicability = artifact.applicability ? `\n\nApplicability: ${artifact.applicability}` : "";
	const nonApplicability = artifact.nonApplicability ? `\n\nNon-applicability: ${artifact.nonApplicability}` : "";
	return [
		"---",
		`name: ${evolvedSkillName(artifact.id)}`,
		`description: ${JSON.stringify(artifact.title)}`,
		"---",
		"",
		`# ${artifact.title}`,
		"",
		artifact.content,
		applicability,
		nonApplicability,
		"",
	].join("\n");
}

function redactSecretLikeText(value: string): string {
	let redacted = value;
	for (const pattern of SECRET_REDACTION_PATTERNS) redacted = redacted.replace(pattern, "[redacted-secret]");
	return redacted;
}

function assertInside(root: string, target: string): void {
	const resolvedRoot = resolve(root);
	const resolvedTarget = resolve(target);
	const rel = relative(resolvedRoot, resolvedTarget);
	if (rel.startsWith("..") || rel === "" || resolve(resolvedRoot, rel) !== resolvedTarget) {
		throw new Error(`Evolution path escapes scope root: ${target}`);
	}
}

export function getEvolutionScopeRoot(agentDir: string, selector: EvolutionScopeSelector): string {
	const base = join(agentDir, "evolution", "v1");
	if (selector.scope === "global") return join(base, "global");
	if (selector.scope === "workspace") {
		if (!selector.cwd) throw new Error("Workspace evolution requires cwd.");
		return join(base, "workspaces", sha256(resolve(selector.cwd)).slice(0, 24));
	}
	if (!selector.sessionId) throw new Error("Session evolution requires sessionId.");
	return join(base, "sessions", safeSegment(selector.sessionId));
}

function writeJsonAtomic(filePath: string, value: unknown, options: { overwrite?: boolean } = {}): void {
	if (!options.overwrite && existsSync(filePath)) throw new Error(`Evolution record already exists: ${filePath}`);
	const dir = resolve(filePath, "..");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: SAFE_FILE_MODE });
		renameSync(tempPath, filePath);
	} finally {
		if (existsSync(tempPath)) unlinkSync(tempPath);
	}
}

function readJson<T>(filePath: string): T | undefined {
	if (!existsSync(filePath)) return undefined;
	const stats = statSync(filePath);
	if (!stats.isFile()) throw new Error(`Evolution path is not a file: ${filePath}`);
	return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function appendHistory(scopeRoot: string, event: Record<string, unknown>): void {
	mkdirSync(scopeRoot, { recursive: true, mode: 0o700 });
	appendFileSync(join(scopeRoot, "history.jsonl"), `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: SAFE_FILE_MODE });
}

function candidatePath(scopeRoot: string, candidateId: string): string {
	const path = join(scopeRoot, "candidates", safeSegment(candidateId), "proposal.json");
	assertInside(scopeRoot, path);
	return path;
}

function revisionPath(scopeRoot: string, revisionId: string): string {
	const path = join(scopeRoot, "revisions", safeSegment(revisionId), "manifest.json");
	assertInside(scopeRoot, path);
	return path;
}

function attributionPath(scopeRoot: string, revisionId: string, attributionId: string): string {
	const path = join(scopeRoot, "revisions", safeSegment(revisionId), "attributions", safeSegment(attributionId), "record.json");
	assertInside(scopeRoot, path);
	return path;
}

function currentPath(scopeRoot: string): string {
	return join(scopeRoot, "current.json");
}

function activeFixturesPath(scopeRoot: string): string {
	return join(scopeRoot, "active-fixtures.json");
}

function quarantinePath(scopeRoot: string, quarantineId: string): string {
	const path = join(scopeRoot, "quarantines", safeSegment(quarantineId), "record.json");
	assertInside(scopeRoot, path);
	return path;
}

function usagePath(scopeRoot: string, usageId: string): string {
	const path = join(scopeRoot, "usage", safeSegment(usageId), "record.json");
	assertInside(scopeRoot, path);
	return path;
}

function feedbackPath(scopeRoot: string, feedbackId: string): string {
	const path = join(scopeRoot, "feedback", safeSegment(feedbackId), "record.json");
	assertInside(scopeRoot, path);
	return path;
}

function loadActiveFixtures(scopeRoot: string): EvolutionActiveFixtures | undefined {
	const active = readJson<EvolutionActiveFixtures>(activeFixturesPath(scopeRoot));
	if (!active || active.schemaVersion !== EVOLUTION_SCHEMA_VERSION) return undefined;
	return active;
}

function hasExecutableContent(artifact: EvolutionArtifact): boolean {
	const text = [
		artifact.title,
		artifact.content,
		artifact.applicability,
		artifact.nonApplicability,
		JSON.stringify(artifact.metadata ?? {}),
	].join("\n");
	return EXECUTABLE_PATTERNS.some((pattern) => pattern.test(text));
}

function validateExecutableToolManifest(artifact: EvolutionArtifact): string[] {
	const errors: string[] = [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(artifact.content);
	} catch (error) {
		return [`artifact ${artifact.id} executable_tool content must be valid JSON: ${error instanceof Error ? error.message : String(error)}`];
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		errors.push(`artifact ${artifact.id} executable_tool content must be an object`);
		return errors;
	}
	const manifest = parsed as Record<string, unknown>;
	if (manifest.schemaVersion !== 1) errors.push(`artifact ${artifact.id} executable_tool schemaVersion must be 1`);
	if (typeof manifest.description !== "string" || !manifest.description.trim()) {
		errors.push(`artifact ${artifact.id} executable_tool description is required`);
	}
	if (!Array.isArray(manifest.steps) || manifest.steps.length === 0 || manifest.steps.length > 12) {
		errors.push(`artifact ${artifact.id} executable_tool steps must contain 1-12 steps`);
	} else {
		for (const [index, step] of manifest.steps.entries()) {
			if (typeof step !== "object" || step === null || Array.isArray(step)) {
				errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} must be an object`);
				continue;
			}
			const record = step as Record<string, unknown>;
			if (typeof record.output !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(record.output)) {
				errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} output is invalid`);
			}
			if (record.op === "template") {
				if (typeof record.template !== "string" || record.template.length > 1000) {
					errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} template is invalid`);
				}
				continue;
			}
			if (record.op === "regex_extract") {
				if (typeof record.source !== "string" || !/^(input|outputs)\.[a-zA-Z][a-zA-Z0-9_.]{0,127}$/.test(record.source)) {
					errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} regex source is invalid`);
				}
				if (typeof record.pattern !== "string" || record.pattern.length === 0 || record.pattern.length > MAX_EXECUTABLE_DSL_PATTERN_CHARS) {
					errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} regex pattern is invalid`);
				} else {
					try {
						new RegExp(record.pattern);
					} catch {
						errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} regex pattern is invalid`);
					}
				}
				if (record.flags !== undefined && (typeof record.flags !== "string" || !/^[imsu]*$/.test(record.flags))) {
					errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} regex flags are invalid`);
				}
				if (record.group !== undefined && (!Number.isInteger(record.group) || Number(record.group) < 0 || Number(record.group) > 20)) {
					errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} regex group is invalid`);
				}
				if (record.fallback !== undefined && (typeof record.fallback !== "string" || record.fallback.length > 1000)) {
					errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} fallback is invalid`);
				}
				continue;
			}
			if (record.op === "json_path") {
				if (typeof record.path !== "string" || !/^(input|outputs)\.[a-zA-Z][a-zA-Z0-9_.]{0,127}$/.test(record.path)) {
					errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} json path is invalid`);
				}
				if (record.fallback !== undefined && (typeof record.fallback !== "string" || record.fallback.length > 1000)) {
					errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} fallback is invalid`);
				}
				continue;
			}
			errors.push(`artifact ${artifact.id} executable_tool step ${index + 1} uses unsupported op`);
		}
	}
	const approvedHash = artifact.metadata?.approvedContentHash;
	if (approvedHash !== `sha256:${sha256(artifact.content)}`) {
		errors.push(`artifact ${artifact.id} executable_tool approvedContentHash does not match content`);
	}
	const permissions = artifact.metadata?.permissionManifest;
	if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
		errors.push(`artifact ${artifact.id} executable_tool permission manifest is required`);
	} else {
		const record = permissions as Record<string, unknown>;
		if (record.workspaceOnly !== true || record.network !== false || record.install !== false || record.write !== "none") {
			errors.push(`artifact ${artifact.id} executable_tool permission manifest must be workspace-only with network=false, install=false, and write=none`);
		}
	}
	return errors;
}

function validateWorkflowSpecMetadata(artifact: EvolutionArtifact): string[] {
	const errors: string[] = [];
	const metadata = artifact.metadata;
	if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
		return [`artifact ${artifact.id} workflow_spec metadata is required`];
	}
	const phases = metadata.phases;
	if (!Array.isArray(phases) || phases.length === 0 || phases.length > 12) {
		errors.push(`artifact ${artifact.id} workflow phases must contain 1-12 phases`);
	} else {
		for (const [index, phase] of phases.entries()) {
			if (typeof phase !== "object" || phase === null || Array.isArray(phase)) {
				errors.push(`artifact ${artifact.id} workflow phase ${index + 1} must be an object`);
				continue;
			}
			const record = phase as Record<string, unknown>;
			if (typeof record.name !== "string" || !record.name.trim() || record.name.length > 120) {
				errors.push(`artifact ${artifact.id} workflow phase ${index + 1} name is invalid`);
			}
			if (!Array.isArray(record.checks) || record.checks.length === 0 || record.checks.length > 12) {
				errors.push(`artifact ${artifact.id} workflow phase ${index + 1} checks must contain 1-12 checks`);
			} else {
				for (const [checkIndex, check] of record.checks.entries()) {
					if (typeof check !== "string" || !check.trim() || check.length > 200) {
						errors.push(`artifact ${artifact.id} workflow phase ${index + 1} check ${checkIndex + 1} is invalid`);
					}
				}
			}
		}
	}
	const successSignals = metadata.successSignals;
	if (!Array.isArray(successSignals) || successSignals.length === 0 || successSignals.length > 12) {
		errors.push(`artifact ${artifact.id} workflow successSignals must contain 1-12 signals`);
	} else {
		for (const [index, signal] of successSignals.entries()) {
			if (typeof signal !== "string" || !signal.trim() || signal.length > 240) {
				errors.push(`artifact ${artifact.id} workflow success signal ${index + 1} is invalid`);
			}
		}
	}
	return errors;
}

function validateArtifact(artifact: EvolutionArtifact, seen: Set<string>): string[] {
	const errors: string[] = [];
	if (!ARTIFACT_KINDS.includes(artifact.kind)) errors.push(`unsupported artifact kind: ${String(artifact.kind)}`);
	if (typeof artifact.id !== "string" || !artifact.id.startsWith(`evolved:${artifact.kind}:`)) {
		errors.push(`artifact id must start with evolved:${artifact.kind}:`);
	}
	if (seen.has(artifact.id)) errors.push(`duplicate artifact id: ${artifact.id}`);
	seen.add(artifact.id);
	if (!artifact.title?.trim() || artifact.title.length > MAX_TITLE_CHARS) errors.push(`artifact ${artifact.id} title is invalid`);
	const maxContentChars = artifact.kind === "eval_fixture" ? 128 * 1024 : MAX_CONTENT_CHARS;
	if (!artifact.content?.trim() || artifact.content.length > maxContentChars) {
		errors.push(`artifact ${artifact.id} content is invalid`);
	}
	if (artifact.tokenBudget !== undefined && (!Number.isInteger(artifact.tokenBudget) || artifact.tokenBudget < 1 || artifact.tokenBudget > 1200)) {
		errors.push(`artifact ${artifact.id} tokenBudget is invalid`);
	}
	if (hasExecutableContent(artifact)) {
		errors.push(`artifact ${artifact.id} contains executable command, package, credential, or server content`);
	}
	if (artifact.kind === "workflow_spec") errors.push(...validateWorkflowSpecMetadata(artifact));
	if (artifact.kind === "executable_tool") errors.push(...validateExecutableToolManifest(artifact));
	return errors;
}

function validatePredictions(input: EvolutionCandidateInput): string[] {
	const errors: string[] = [];
	if (input.predictions === undefined) return errors;
	if (!Array.isArray(input.predictions)) return ["predictions must be an array"];
	if (input.predictions.length > MAX_PREDICTIONS_PER_CANDIDATE) errors.push("too many predictions in one candidate");
	const seen = new Set<string>();
	for (const prediction of input.predictions) {
		if (!prediction.id?.trim() || prediction.id.length > 120) errors.push("prediction id is invalid");
		if (seen.has(prediction.id)) errors.push(`duplicate prediction id: ${prediction.id}`);
		seen.add(prediction.id);
		if (!prediction.metric?.trim() || prediction.metric.length > 160) errors.push(`prediction ${prediction.id} metric is invalid`);
		if (!PREDICTION_DIRECTIONS.has(prediction.direction)) errors.push(`prediction ${prediction.id} direction is invalid`);
		if (!prediction.target?.trim() || prediction.target.length > 160) errors.push(`prediction ${prediction.id} target is invalid`);
		if (!prediction.rationale?.trim() || prediction.rationale.length > 1000) errors.push(`prediction ${prediction.id} rationale is invalid`);
	}
	return errors;
}

export function validateEvolutionCandidateInput(
	input: EvolutionCandidateInput,
	options?: EvolutionClockOptions,
): EvolutionValidationReport {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!["session", "workspace", "global"].includes(input.scope)) errors.push(`unsupported scope: ${String(input.scope)}`);
	if (!input.summary?.trim()) errors.push("summary is required");
	if (!input.rationale?.trim()) errors.push("rationale is required");
	if (!input.expectedOutcome?.trim()) warnings.push("expectedOutcome is empty");
	if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) errors.push("at least one artifact is required");
	if (input.artifacts.length > MAX_ARTIFACTS_PER_CANDIDATE) errors.push("too many artifacts in one candidate");
	const seen = new Set<string>();
	for (const artifact of input.artifacts ?? []) errors.push(...validateArtifact(artifact, seen));
	if (input.artifacts.some((artifact) => artifact.kind === "executable_tool") && input.scope !== "workspace") {
		errors.push("executable_tool artifacts must be workspace-scoped");
	}
	errors.push(...validatePredictions(input));
	return { passed: errors.length === 0, errors, warnings, validatedAt: now(options) };
}

export function canAutoPromoteGlobalEvolution(input: EvolutionCandidateInput): { allowed: boolean; reason?: string } {
	const validation = validateEvolutionCandidateInput(input);
	if (!validation.passed) return { allowed: false, reason: validation.errors.join("; ") };
	if (input.scope !== "global") return { allowed: true };
	for (const artifact of input.artifacts) {
		if (artifact.kind !== "memory" && artifact.kind !== "prompt_note" && artifact.kind !== "tool_spec") {
			return { allowed: false, reason: `global auto-promotion only allows memory, prompt_note, and bounded tool_spec artifacts, got ${artifact.kind}` };
		}
		if (!artifact.applicability?.trim()) {
			return { allowed: false, reason: "global auto-promotion requires explicit applicability" };
		}
		if (artifact.kind === "tool_spec" && !artifact.nonApplicability?.trim()) {
			return { allowed: false, reason: "global tool_spec auto-promotion requires explicit non-applicability" };
		}
		if (artifact.content.length > MAX_GLOBAL_AUTO_PROMOTE_CONTENT_CHARS) {
			return { allowed: false, reason: `global auto-promotion content exceeds ${MAX_GLOBAL_AUTO_PROMOTE_CONTENT_CHARS} characters` };
		}
		if (artifact.metadata && Object.keys(artifact.metadata).length > 0) {
			return { allowed: false, reason: "global auto-promotion does not allow metadata" };
		}
	}
	return { allowed: true };
}

function assertValidInput(input: EvolutionCandidateInput, options?: EvolutionClockOptions): EvolutionValidationReport {
	const validation = validateEvolutionCandidateInput(input, options);
	if (!validation.passed) throw new Error(`Invalid evolution candidate: ${validation.errors.join("; ")}`);
	return validation;
}

function evalFixtureContentHashes(artifacts: readonly EvolutionArtifact[]): string[] {
	return artifacts
		.filter((artifact) => artifact.kind === "eval_fixture")
		.map((artifact) => sha256(artifact.content));
}

function evalFixtureArtifactIds(artifacts: readonly EvolutionArtifact[]): string[] {
	return artifacts.filter((artifact) => artifact.kind === "eval_fixture").map((artifact) => artifact.id);
}

function updateActiveFixtures(scopeRoot: string, promoted: EvolutionRevision): void {
	const newIds = evalFixtureArtifactIds(promoted.artifacts);
	if (newIds.length === 0) return;
	const previous = loadActiveFixtures(scopeRoot);
	const allActive = [...(previous?.activeArtifactIds ?? []), ...newIds].filter((id, index, values) => values.indexOf(id) === index);
	const activeArtifactIds = allActive.slice(-MAX_ACTIVE_EVAL_FIXTURES);
	const archivedArtifactIds = [...(previous?.archivedArtifactIds ?? []), ...allActive.slice(0, Math.max(0, allActive.length - MAX_ACTIVE_EVAL_FIXTURES))]
		.filter((id, index, values) => values.indexOf(id) === index && !activeArtifactIds.includes(id));
	const pointer: EvolutionActiveFixtures = {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		activeArtifactIds,
		archivedArtifactIds,
		updatedAt: promoted.createdAt,
		updatedBy: promoted.approvedBy,
	};
	writeJsonAtomic(activeFixturesPath(scopeRoot), pointer, { overwrite: true });
	appendHistory(scopeRoot, {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		event: "active_fixtures_updated",
		activeArtifactIds,
		archivedArtifactIds,
		at: pointer.updatedAt,
		updatedBy: pointer.updatedBy,
	});
}

function assertNoDuplicateEvalFixture(scopeRoot: string, input: EvolutionCandidateInput): void {
	const incoming = new Set(evalFixtureContentHashes(input.artifacts));
	if (incoming.size === 0) return;
	const candidates = listJsonRecords<EvolutionCandidate>(join(scopeRoot, "candidates"), "proposal.json");
	for (const candidate of candidates) {
		if (candidate.status !== "proposed" && candidate.status !== "promoted") continue;
		for (const hash of evalFixtureContentHashes(candidate.artifacts)) {
			if (incoming.has(hash)) throw new Error(`Duplicate eval_fixture content already exists in candidate ${candidate.id}`);
		}
	}
	const revisions = listJsonRecords<EvolutionRevision>(join(scopeRoot, "revisions"), "manifest.json");
	for (const revision of revisions) {
		for (const hash of evalFixtureContentHashes(revision.artifacts)) {
			if (incoming.has(hash)) throw new Error(`Duplicate eval_fixture content already exists in revision ${revision.id}`);
		}
	}
}

export function createEvolutionCandidate(
	scopeRoot: string,
	input: EvolutionCandidateInput,
	options?: EvolutionClockOptions,
): EvolutionCandidate {
	const validation = assertValidInput(input, options);
	assertNoDuplicateEvalFixture(scopeRoot, input);
	const id = nextId("candidate", options);
	const createdAt = now(options);
	const candidate: EvolutionCandidate = {
		...input,
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		id,
		status: "proposed",
		createdAt,
		updatedAt: createdAt,
		validation,
	};
	writeJsonAtomic(candidatePath(scopeRoot, id), candidate);
	appendHistory(scopeRoot, { schemaVersion: EVOLUTION_SCHEMA_VERSION, event: "candidate_created", candidateId: id, at: createdAt });
	return candidate;
}

export function recordEvolutionGateFailure(
	scopeRoot: string,
	candidateId: string,
	options: EvolutionGateFailureOptions,
): EvolutionCandidate {
	const candidate = loadCandidate(scopeRoot, candidateId);
	if (candidate.status !== "proposed") throw new Error(`Evolution gate failure can only be recorded for proposed candidates: ${candidateId}`);
	const updatedAt = now(options);
	const updated: EvolutionCandidate = {
		...candidate,
		updatedAt,
		evidence: {
			...(candidate.evidence ?? {}),
			gateReport: options.gateReport,
		},
	};
	writeJsonAtomic(candidatePath(scopeRoot, candidateId), updated, { overwrite: true });
	appendHistory(scopeRoot, {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		event: "auto_promotion_gate_failed",
		candidateId,
		gate: options.gateReport.name,
		failure: options.gateReport.failure,
		metrics: options.gateReport.metrics,
		at: updatedAt,
	});
	return updated;
}

export function recordEvolutionUsage(scopeRoot: string, options: EvolutionUsageOptions): EvolutionUsageRecord {
	const usedAt = now(options);
	const usage: EvolutionUsageRecord = {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		id: nextId("usage", options),
		artifactId: options.artifact.id,
		artifactKind: options.artifact.kind,
		...(options.revisionId ? { revisionId: options.revisionId } : {}),
		scope: options.scope,
		status: options.status,
		usedAt,
		usedBy: options.usedBy ?? "model-tool",
		...(options.input ? { inputHash: `sha256:${sha256(JSON.stringify(options.input))}` } : {}),
		...(options.resultSummary ? { resultSummary: options.resultSummary.slice(0, 500) } : {}),
		...(options.error ? { error: options.error.slice(0, 500) } : {}),
	};
	writeJsonAtomic(usagePath(scopeRoot, usage.id), usage);
	appendHistory(scopeRoot, {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		event: "artifact_used",
		usageId: usage.id,
		artifactId: usage.artifactId,
		artifactKind: usage.artifactKind,
		revisionId: usage.revisionId,
		status: usage.status,
		at: usage.usedAt,
		usedBy: usage.usedBy,
	});
	return usage;
}

export function recordEvolutionFeedback(scopeRoot: string, options: EvolutionFeedbackOptions): EvolutionFeedbackRecord {
	const usage = readJson<EvolutionUsageRecord>(usagePath(scopeRoot, options.usageId));
	if (!usage || usage.schemaVersion !== EVOLUTION_SCHEMA_VERSION) throw new Error(`Evolution usage record not found: ${options.usageId}`);
	const recordedAt = now(options);
	const feedback: EvolutionFeedbackRecord = {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		id: nextId("feedback", options),
		usageId: usage.id,
		artifactId: usage.artifactId,
		...(usage.revisionId ? { revisionId: usage.revisionId } : {}),
		scope: usage.scope,
		outcome: options.outcome,
		...(options.note?.trim() ? { note: redactSecretLikeText(options.note.trim()).slice(0, 500) } : {}),
		recordedAt,
		recordedBy: options.recordedBy ?? "user",
	};
	writeJsonAtomic(feedbackPath(scopeRoot, feedback.id), feedback);
	appendHistory(scopeRoot, {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		event: "usage_feedback_recorded",
		feedbackId: feedback.id,
		usageId: feedback.usageId,
		artifactId: feedback.artifactId,
		revisionId: feedback.revisionId,
		outcome: feedback.outcome,
		at: feedback.recordedAt,
		recordedBy: feedback.recordedBy,
	});
	return feedback;
}

export function currentEvolutionRevisionId(scopeRoot: string): string | undefined {
	return loadCurrentEvolution(scopeRoot)?.revisionId;
}

function loadCandidate(scopeRoot: string, candidateId: string): EvolutionCandidate {
	const candidate = readJson<EvolutionCandidate>(candidatePath(scopeRoot, candidateId));
	if (!candidate) throw new Error(`Evolution candidate not found: ${candidateId}`);
	if (candidate.schemaVersion !== EVOLUTION_SCHEMA_VERSION) throw new Error(`Unsupported evolution candidate schema: ${candidate.schemaVersion}`);
	return candidate;
}

function loadRevision(scopeRoot: string, revisionId: string): EvolutionRevision {
	const revision = readJson<EvolutionRevision>(revisionPath(scopeRoot, revisionId));
	if (!revision) throw new Error(`Evolution revision not found: ${revisionId}`);
	if (revision.schemaVersion !== EVOLUTION_SCHEMA_VERSION) throw new Error(`Unsupported evolution revision schema: ${revision.schemaVersion}`);
	const validation = validateEvolutionCandidateInput(revision);
	if (!validation.passed) throw new Error(`Evolution revision failed validation: ${validation.errors.join("; ")}`);
	const expectedHash = `sha256:${sha256(JSON.stringify(revision.artifacts))}`;
	if (revision.contentHash !== expectedHash) throw new Error(`Evolution revision content hash mismatch: ${revisionId}`);
	return revision;
}

function quarantineActiveRevision(scopeRoot: string, current: EvolutionCurrent | undefined, reason: string): void {
	const revisionId = current?.revisionId;
	const id = `active-${safeSegment(revisionId ?? "unknown")}-${sha256(reason).slice(0, 12)}`;
	const path = quarantinePath(scopeRoot, id);
	if (existsSync(path)) {
		if (existsSync(currentPath(scopeRoot))) unlinkSync(currentPath(scopeRoot));
		return;
	}
	const quarantinedAt = new Date().toISOString();
	const record: EvolutionQuarantine = {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		id,
		...(revisionId ? { revisionId } : {}),
		reason,
		quarantinedAt,
		source: "active_revision",
	};
	writeJsonAtomic(path, record);
	if (existsSync(currentPath(scopeRoot))) unlinkSync(currentPath(scopeRoot));
	appendHistory(scopeRoot, {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		event: "active_revision_quarantined",
		quarantineId: id,
		revisionId,
		reason,
		at: quarantinedAt,
	});
}

export function loadCurrentEvolution(scopeRoot: string): EvolutionCurrent | undefined {
	let current: EvolutionCurrent | undefined;
	try {
		current = readJson<EvolutionCurrent>(currentPath(scopeRoot));
		if (!current || current.schemaVersion !== EVOLUTION_SCHEMA_VERSION) return undefined;
		loadRevision(scopeRoot, current.revisionId);
		return current;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		quarantineActiveRevision(scopeRoot, current, reason);
		return undefined;
	}
}

export function promoteEvolutionCandidate(
	scopeRoot: string,
	candidateId: string,
	options?: EvolutionPromotionOptions,
): EvolutionRevision {
	const candidate = loadCandidate(scopeRoot, candidateId);
	if (candidate.status === "rejected") throw new Error(`Evolution candidate is rejected: ${candidateId}`);
	if (candidate.status === "quarantined") throw new Error(`Evolution candidate is quarantined: ${candidateId}`);
	if (candidate.status === "promoted") throw new Error(`Evolution candidate is already promoted: ${candidateId}`);
	const validation = validateEvolutionCandidateInput(candidate, options);
	if (!validation.passed) throw new Error(`Evolution candidate failed validation: ${validation.errors.join("; ")}`);
	if (candidate.artifacts.some((artifact) => artifact.kind === "executable_tool") && options?.gateReport?.passed !== true) {
		throw new Error("Executable tool promotion requires a passing gate report");
	}
	const current = loadCurrentEvolution(scopeRoot);
	const revisionId = nextId("revision", options);
	const createdAt = now(options);
	const contentHash = `sha256:${sha256(JSON.stringify(candidate.artifacts))}`;
	const revision: EvolutionRevision = {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		id: revisionId,
		candidateId: candidate.id,
		scope: candidate.scope,
		summary: candidate.summary,
		rationale: candidate.rationale,
		expectedOutcome: candidate.expectedOutcome,
		artifacts: candidate.artifacts,
		...(candidate.predictions ? { predictions: candidate.predictions } : {}),
		contentHash,
		...(options?.gateReport ? { gateReport: options.gateReport } : {}),
		createdAt,
		approvedBy: options?.approvedBy ?? "manual",
		predecessorRevisionId: current?.revisionId,
	};
	writeJsonAtomic(revisionPath(scopeRoot, revisionId), revision);
	const pointer: EvolutionCurrent = {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		revisionId,
		activatedAt: createdAt,
		activatedBy: revision.approvedBy,
	};
	writeJsonAtomic(currentPath(scopeRoot), pointer, { overwrite: true });
	const promoted: EvolutionCandidate = {
		...candidate,
		status: "promoted",
		updatedAt: createdAt,
		promotedRevisionId: revisionId,
		validation,
	};
	writeJsonAtomic(candidatePath(scopeRoot, candidateId), promoted, { overwrite: true });
	appendHistory(scopeRoot, {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		event: "promoted",
		candidateId,
		revisionId,
		predecessorRevisionId: current?.revisionId,
		at: createdAt,
		approvedBy: revision.approvedBy,
	});
	updateActiveFixtures(scopeRoot, revision);
	return revision;
}

function metricValue(metric: string, report: EvolutionGateReport): number | undefined {
	if (metric.endsWith("passRate")) return report.metrics.passRate;
	if (metric.endsWith("replayDivergences")) return report.metrics.replayDivergences;
	if (metric.endsWith("policyViolations")) return report.metrics.policyViolations;
	if (metric.endsWith("unpairedToolCalls")) return report.metrics.unpairedToolCalls;
	return undefined;
}

function numericTarget(target: string): number | undefined {
	const match = target.trim().match(/^(?:[<>]=?|=)?\s*(-?\d+(?:\.\d+)?)$/);
	return match ? Number(match[1]) : undefined;
}

function attributePrediction(prediction: EvolutionPrediction, report: EvolutionGateReport): EvolutionPredictionAttribution {
	const observedValue = metricValue(prediction.metric, report);
	const target = numericTarget(prediction.target);
	if (observedValue === undefined || target === undefined) {
		return {
			predictionId: prediction.id,
			metric: prediction.metric,
			status: "inconclusive",
			target: prediction.target,
			reason: "Prediction metric or target is not directly comparable with the gate report.",
		};
	}
	const kept =
		prediction.direction === "increase" || prediction.direction === "stay_at_or_above"
			? observedValue >= target
			: prediction.direction === "decrease" || prediction.direction === "stay_at_or_below" || prediction.direction === "no_regression"
				? observedValue <= target
				: false;
	return {
		predictionId: prediction.id,
		metric: prediction.metric,
		status: kept ? "kept" : "falsified",
		observedValue,
		target: prediction.target,
		reason: kept ? "Observed gate metric satisfied the prediction target." : "Observed gate metric violated the prediction target.",
	};
}

function streamReport(parent: EvolutionGateReport, stream: NonNullable<EvolutionGateReport["streams"]>[number]): EvolutionGateReport {
	return {
		name: `${parent.name}:${stream.id}`,
		passed: stream.passed,
		checkedAt: parent.checkedAt,
		metrics: stream.metrics,
		...(stream.passed ? {} : { failure: parent.failure ?? `${stream.id} failed` }),
	};
}

function attributeStreams(revision: EvolutionRevision, report: EvolutionGateReport): EvolutionStreamAttribution[] | undefined {
	if (!report.streams || report.streams.length === 0) return undefined;
	return report.streams.map((stream) => ({
		streamId: stream.id,
		mode: stream.mode,
		passed: stream.passed,
		metrics: stream.metrics,
		results: (revision.predictions ?? []).map((prediction) => attributePrediction(prediction, streamReport(report, stream))),
	}));
}

function hasFalsifiedPrediction(results: readonly EvolutionPredictionAttribution[]): boolean {
	return results.some((result) => result.status === "falsified");
}

function streamFalsificationScore(attribution: EvolutionAttribution): number {
	const falsifiedModes = new Set<EvolutionStreamMode>();
	for (const stream of attribution.streamResults ?? []) {
		if (hasFalsifiedPrediction(stream.results)) falsifiedModes.add(stream.mode);
	}
	let score = 0;
	for (const mode of falsifiedModes) score += mode === "interleaved" ? 2 : 1;
	return score;
}

function rollbackPolicyAllows(revision: EvolutionRevision, attribution: EvolutionAttribution): { allowed: boolean; reason?: string } {
	if (!hasFalsifiedPrediction(attribution.results)) return { allowed: false, reason: "no_falsified_predictions" };
	if (revision.scope === "session") return { allowed: true };
	const score = streamFalsificationScore(attribution);
	if (score >= 2) return { allowed: true };
	return { allowed: false, reason: "insufficient_stream_falsification" };
}

export function recordEvolutionAttribution(
	scopeRoot: string,
	revisionId: string,
	options: EvolutionAttributionOptions,
): EvolutionAttribution {
	const revision = loadRevision(scopeRoot, revisionId);
	const attributedAt = now(options);
	const attributionId = nextId("attribution", options);
	const streamResults = attributeStreams(revision, options.gateReport);
	const attribution: EvolutionAttribution = {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		id: attributionId,
		revisionId,
		gateReport: options.gateReport,
		results: (revision.predictions ?? []).map((prediction) => attributePrediction(prediction, options.gateReport)),
		...(streamResults ? { streamResults } : {}),
		attributedAt,
		attributedBy: options.attributedBy ?? "system",
	};
	writeJsonAtomic(attributionPath(scopeRoot, revisionId, attributionId), attribution);
	appendHistory(scopeRoot, {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		event: "prediction_attributed",
		revisionId,
		attributionId,
		kept: attribution.results.filter((result) => result.status === "kept").length,
		falsified: attribution.results.filter((result) => result.status === "falsified").length,
		inconclusive: attribution.results.filter((result) => result.status === "inconclusive").length,
		at: attributedAt,
		attributedBy: attribution.attributedBy,
	});
	return attribution;
}

export function recordEvolutionAttributionAndMaybeRollback(
	scopeRoot: string,
	revisionId: string,
	options: EvolutionAutoRollbackOptions,
): { attribution: EvolutionAttribution; rollback?: EvolutionCurrent; reason?: string } {
	const attribution = recordEvolutionAttribution(scopeRoot, revisionId, options);
	const revision = loadRevision(scopeRoot, revisionId);
	const policy = rollbackPolicyAllows(revision, attribution);
	if (!policy.allowed) return { attribution, reason: policy.reason };
	const current = loadCurrentEvolution(scopeRoot);
	if (current?.revisionId !== revisionId) return { attribution, reason: "revision_not_current" };
	if (!revision.predecessorRevisionId) return { attribution, reason: "no_predecessor_revision" };
	const rollback = rollbackEvolution(scopeRoot, revision.predecessorRevisionId, {
		now: options.now,
		requestedBy: options.rollbackBy ?? "auto-attribution",
	});
	appendHistory(scopeRoot, {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		event: "auto_rolled_back",
		revisionId,
		rollbackToRevisionId: rollback.revisionId,
		attributionId: attribution.id,
		falsified: attribution.results.filter((result) => result.status === "falsified").length,
		streamFalsificationScore: streamFalsificationScore(attribution),
		at: rollback.activatedAt,
		rollbackBy: rollback.activatedBy,
	});
	return { attribution, rollback };
}

export function rejectEvolutionCandidate(
	scopeRoot: string,
	candidateId: string,
	reason: string,
	options?: EvolutionRejectOptions,
): EvolutionCandidate {
	const candidate = loadCandidate(scopeRoot, candidateId);
	if (candidate.status === "promoted") throw new Error(`Cannot reject promoted evolution candidate: ${candidateId}`);
	const rejectedAt = now(options);
	const rejected: EvolutionCandidate = {
		...candidate,
		status: "rejected",
		updatedAt: rejectedAt,
		rejectedAt,
		rejectedBy: options?.rejectedBy ?? "manual",
		rejectionReason: reason.trim() || "Rejected",
	};
	writeJsonAtomic(candidatePath(scopeRoot, candidateId), rejected, { overwrite: true });
	appendHistory(scopeRoot, {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		event: "rejected",
		candidateId,
		reason: rejected.rejectionReason,
		at: rejectedAt,
		rejectedBy: rejected.rejectedBy,
	});
	return rejected;
}

export function rollbackEvolution(
	scopeRoot: string,
	revisionId: string,
	options?: EvolutionRollbackOptions,
): EvolutionCurrent {
	loadRevision(scopeRoot, revisionId);
	const previous = loadCurrentEvolution(scopeRoot);
	const activatedAt = now(options);
	const pointer: EvolutionCurrent = {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		revisionId,
		activatedAt,
		activatedBy: options?.requestedBy ?? "manual",
		rollbackOf: previous?.revisionId,
	};
	writeJsonAtomic(currentPath(scopeRoot), pointer, { overwrite: true });
	appendHistory(scopeRoot, {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		event: "rolled_back",
		revisionId,
		rollbackOf: previous?.revisionId,
		at: activatedAt,
		requestedBy: pointer.activatedBy,
	});
	return pointer;
}

export function loadActiveEvolutionArtifacts(scopeRoot: string): EvolutionArtifact[] {
	const current = loadCurrentEvolution(scopeRoot);
	if (!current) return [];
	return loadRevision(scopeRoot, current.revisionId).artifacts;
}

export function loadActiveEvolutionSkillPaths(scopeRoot: string): string[] {
	const current = loadCurrentEvolution(scopeRoot);
	if (!current) return [];
	const revision = loadRevision(scopeRoot, current.revisionId);
	const skillArtifacts = revision.artifacts.filter((artifact) => artifact.kind === "skill_manifest");
	if (skillArtifacts.length === 0) return [];
	const skillRoot = join(scopeRoot, "resources", "skills", safeSegment(revision.id));
	assertInside(scopeRoot, skillRoot);
	for (const artifact of skillArtifacts) {
		const skillDir = join(skillRoot, evolvedSkillName(artifact.id));
		assertInside(scopeRoot, skillDir);
		mkdirSync(skillDir, { recursive: true, mode: 0o700 });
		writeFileSync(join(skillDir, "SKILL.md"), skillMarkdown(artifact), { encoding: "utf8", mode: SAFE_FILE_MODE });
	}
	return [skillRoot];
}

export function loadActiveEvalFixtureArtifacts(scopeRoot: string): EvolutionArtifact[] {
	const active = loadActiveFixtures(scopeRoot);
	if (!active || active.activeArtifactIds.length === 0) return [];
	const activeIds = new Set(active.activeArtifactIds);
	return inspectEvolution(scopeRoot).revisions
		.flatMap((revision) => revision.artifacts)
		.filter((artifact) => artifact.kind === "eval_fixture" && activeIds.has(artifact.id));
}

function listJsonRecords<T>(dir: string, fileName: string): T[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(dir, basename(entry.name), fileName))
		.filter((filePath) => existsSync(filePath))
		.map((filePath) => readJson<T>(filePath))
		.filter((value): value is T => value !== undefined);
}

function listAttributions(scopeRoot: string, revisions: readonly EvolutionRevision[]): EvolutionAttribution[] {
	return revisions
		.flatMap((revision) => listJsonRecords<EvolutionAttribution>(join(scopeRoot, "revisions", safeSegment(revision.id), "attributions"), "record.json"))
		.sort((a, b) => a.attributedAt.localeCompare(b.attributedAt));
}

export function inspectEvolution(scopeRoot: string): EvolutionInspection {
	const candidates = listJsonRecords<EvolutionCandidate>(join(scopeRoot, "candidates"), "proposal.json").sort((a, b) =>
		a.createdAt.localeCompare(b.createdAt),
	);
	const revisions = listJsonRecords<EvolutionRevision>(join(scopeRoot, "revisions"), "manifest.json").sort((a, b) =>
		a.createdAt.localeCompare(b.createdAt),
	);
	const quarantines = listJsonRecords<EvolutionQuarantine>(join(scopeRoot, "quarantines"), "record.json").sort((a, b) =>
		a.quarantinedAt.localeCompare(b.quarantinedAt),
	);
	const usages = listJsonRecords<EvolutionUsageRecord>(join(scopeRoot, "usage"), "record.json").sort((a, b) =>
		a.usedAt.localeCompare(b.usedAt),
	);
	const feedbacks = listJsonRecords<EvolutionFeedbackRecord>(join(scopeRoot, "feedback"), "record.json").sort((a, b) =>
		a.recordedAt.localeCompare(b.recordedAt),
	);
	const attributions = listAttributions(scopeRoot, revisions);
	const latestAttributionByRevision = new Map<string, EvolutionAttribution>();
	for (const attribution of attributions) latestAttributionByRevision.set(attribution.revisionId, attribution);
	const enrichedRevisions = revisions.map((revision) => {
		const attribution = latestAttributionByRevision.get(revision.id);
		return attribution ? { ...revision, attribution } : revision;
	});
	return { current: loadCurrentEvolution(scopeRoot), activeFixtures: loadActiveFixtures(scopeRoot), candidates, revisions: enrichedRevisions, attributions, quarantines, usages, feedbacks };
}
