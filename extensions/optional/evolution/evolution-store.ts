/**
 * [WHO]: Evolution ledger path resolution, scope/root agreement enforcement, candidate/revision validation, rejected-candidate listing, skill_manifest body structure enforcement, the refinement change budget, the shared artifact hash, and behavioral prose dedup, no-IO executable DSL manifests, usage records, prediction manifests, post-hoc attribution, eval_fixture dedupe/retention, gated promotion, quarantine, rollback, and conservative auto-rollback
 * [FROM]: Depends on node fs/path/crypto for owner-only runtime state below agentDir/evolution/v1
 * [TO]: Consumed by optional evolution extension command handlers and tests
 * [HERE]: extensions/optional/evolution/evolution-store.ts - durable store for controlled self-evolution
 */

import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { evolutionCandidateContentHash, verifyEvolutionBenchmarkReport } from "./benchmark-comparison.js";
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
	EvolutionScope,
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
/**
 * The proposal asks for "at most four logical add/delete/replace changes per refinement, subject to
 * a documented mapping onto existing artifact semantics". The mapping is one artifact-level change:
 * an artifact the active set does not have is an add, an artifact replacing an active one is a
 * replace, and an active artifact the candidate leaves out is a delete. That is the same unit
 * `formatEvolutionChanges` already renders, and both sides hash an artifact through
 * `evolutionArtifactHash`, so a change counted here is exactly a change a reviewer is shown.
 *
 * Counting artifact entries rather than diffed text is deliberate. A character-level budget would
 * make the number depend on how verbosely a body is phrased, which is not what "logical changes"
 * means; and a heading rewrite would spend the whole budget while a genuine restructuring spent
 * none.
 */
const MAX_LOGICAL_CHANGES_PER_CANDIDATE = 4;
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

/**
 * Body sections a skill_manifest must carry, with every heading accepted for each.
 *
 * Trigger and limits are deliberately absent: they already have structured fields
 * (applicability / nonApplicability) that skillMarkdown renders. Asking for them again in prose
 * would create a second source of truth that can silently disagree with the field. The four below
 * have no field, so a skill whose body omits them ships as a bare paragraph the agent cannot
 * follow, check, or hand off.
 */
const REQUIRED_SKILL_BODY_SECTIONS: readonly { section: string; canonical: string; aliases: readonly string[] }[] = [
	{ section: "prerequisites", canonical: "Prerequisites", aliases: ["prerequisites", "preconditions", "before you start", "requirements"] },
	{ section: "steps", canonical: "Steps", aliases: ["steps", "procedure", "how to run", "process"] },
	{ section: "pitfalls", canonical: "Pitfalls", aliases: ["pitfalls", "gotchas", "common mistakes", "failure modes"] },
	{ section: "verification", canonical: "Verification", aliases: ["verification", "verify", "how to verify", "checks"] },
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

const EVOLUTION_ROOT_SEGMENTS: ReadonlyArray<{ directory: string; scope: EvolutionScope }> = [
	{ directory: "global", scope: "global" },
	{ directory: "workspaces", scope: "workspace" },
	{ directory: "sessions", scope: "session" },
];

/**
 * The scope a root belongs to, read from the fixed layout `<...>/evolution/v1/<scope directory>`.
 *
 * The alternative is to have every caller pass its scope alongside the root and trust it, but that
 * is the hole this closes: a candidate's own `scope` field and the directory it is written to can
 * disagree, and every scope-keyed policy reads the field. A candidate declaring `workspace` inside
 * the global root is refused here; without the check `canAutoPromoteGlobalEvolution` sees
 * `scope !== "global"` and waves a `skill_manifest` through a gate that exists to forbid exactly
 * that. Undefined means the path is not an evolution root at all, which callers treat as a refusal
 * rather than as a wildcard.
 */
export function evolutionScopeOfRoot(scopeRoot: string): EvolutionScope | undefined {
	const segments = resolve(scopeRoot).split(sep);
	// Last occurrence, so an agent directory that itself contains a "v1" segment does not win.
	const version = segments.lastIndexOf("v1");
	if (version < 0) return undefined;
	return EVOLUTION_ROOT_SEGMENTS.find((entry) => entry.directory === segments[version + 1])?.scope;
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

function hasText(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/** Lowercased heading text with punctuation collapsed, so "Failure-Modes" and "failure modes" agree. */
function normalizeHeading(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Every markdown heading in a body, normalized, so section lookup does not depend on heading depth.
 *
 * Fence tracking follows CommonMark: the opening run fixes both the marker character and its
 * length, and only a bare run of that same character at least that long closes the block. Toggling
 * on any fence-looking line is not good enough — a body that opens with four backticks and closes
 * the block with three would otherwise put every required heading inside a code sample and still
 * pass. Unrecognized markers keep the block open, which is the conservative direction: it can only
 * fail validation, never fake a section.
 */
function markdownHeadings(content: string): Set<string> {
	const headings = new Set<string>();
	let openFence: { marker: string; length: number } | undefined;
	for (const line of content.split("\n")) {
		const fence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
		if (openFence) {
			if (fence && fence[2]!.trim() === "" && fence[1]!.startsWith(openFence.marker.repeat(openFence.length))) {
				openFence = undefined;
			}
			continue;
		}
		if (fence) openFence = { marker: fence[1]![0]!, length: fence[1]!.length };
		const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
		if (!match) continue;
		const normalized = normalizeHeading(match[1]);
		if (normalized) headings.add(normalized);
	}
	return headings;
}

/**
 * A skill_manifest is materialized into a real SKILL.md, so its body has to be usable as a
 * procedure rather than readable as a note. Enforced on write only: `loadRevision` re-validates
 * what is already on disk and it opts out, so a skill promoted before this rule existed still loads,
 * still renders, and is still rollback-able rather than being quarantined out of discovery.
 */
function validateSkillManifestStructure(artifact: EvolutionArtifact): string[] {
	const errors: string[] = [];
	if (!hasText(artifact.applicability)) {
		errors.push(`artifact ${artifact.id} skill_manifest needs applicability describing its trigger`);
	}
	if (!hasText(artifact.nonApplicability)) {
		errors.push(`artifact ${artifact.id} skill_manifest needs nonApplicability describing its limits`);
	}
	const headings = markdownHeadings(typeof artifact.content === "string" ? artifact.content : "");
	for (const required of REQUIRED_SKILL_BODY_SECTIONS) {
		if (!required.aliases.some((alias) => headings.has(alias))) {
			errors.push(
				`artifact ${artifact.id} skill_manifest content is missing a ${required.section} section; add a markdown heading "## ${required.canonical}"`,
			);
		}
	}
	return errors;
}

/**
 * The identity of an artifact's meaning, not of its record. `overrides` is excluded because it is a
 * proposal-time instruction that is resolved away before anything is stored.
 */
export function evolutionArtifactHash(artifact: EvolutionArtifact): string {
	return JSON.stringify({
		kind: artifact.kind,
		title: artifact.title,
		content: artifact.content,
		applicability: artifact.applicability,
		nonApplicability: artifact.nonApplicability,
		tokenBudget: artifact.tokenBudget,
		metadata: artifact.metadata,
	});
}

export interface EvolutionLogicalChanges {
	added: number;
	changed: number;
	removed: number;
}

/**
 * Counts the logical add/delete/replace a candidate makes to the active set.
 *
 * An artifact is charged against the entry it *replaces* rather than against its own id: its own id
 * normally, or the id it names in `overrides`. Charging the incoming id instead would make a
 * renamed update cost an add plus a delete, which is exactly the expensive path S07.2 exists to
 * make cheap, and it would push authors back toward duplicate ids.
 */
function logicalArtifactChanges(
	baseline: readonly EvolutionArtifact[],
	candidate: readonly EvolutionArtifact[],
): EvolutionLogicalChanges {
	const baselineById = new Map(baseline.map((artifact) => [artifact.id, artifact]));
	// Whether deletes exist at all depends on which promotion path this candidate takes, and
	// `resolveOverrideArtifacts` is the authority on that: a candidate carrying `overrides` merges
	// into the baseline and carries every untouched artifact forward, so nothing is removed.
	// Charging deletes in that case would price an update for work it will not do, and would refuse
	// any single-skill update against a baseline of five or more — exactly the case `overrides`
	// exists to serve. Without `overrides` the set is replaced wholesale and a delete is real.
	const merges = candidate.some((artifact) => artifact.overrides);
	const replaced = new Set<string>();
	let added = 0;
	let changed = 0;
	for (const artifact of candidate) {
		const target = artifact.overrides?.skillId ?? artifact.id;
		if (target === artifact.id) replaced.add(target);
		const previous = baselineById.get(target);
		if (!previous) {
			added += 1;
			continue;
		}
		if (artifact.overrides) replaced.add(target);
		if (evolutionArtifactHash(previous) !== evolutionArtifactHash(artifact)) changed += 1;
	}
	return {
		added,
		changed,
		removed: merges ? 0 : baseline.filter((artifact) => !replaced.has(artifact.id)).length,
	};
}

function validateArtifact(artifact: EvolutionArtifact, seen: Set<string>, overrideTargets: Set<string>, enforceSkillBodyStructure: boolean): string[] {
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
	if (artifact.overrides !== undefined) {
		const target = artifact.overrides?.skillId;
		if (typeof target !== "string" || !target.startsWith(`evolved:${artifact.kind}:`)) {
			// Same rule the proposal schema already applies, so a candidate written through either
			// door is held to the same naming discipline.
			errors.push(`artifact ${artifact.id} overrides must name an evolved:${artifact.kind}: id`);
		} else if (overrideTargets.has(target)) {
			// Two artifacts claiming the same target would make the merge order-dependent, so the
			// outcome would depend on array order rather than on what the author meant.
			errors.push(`artifact ${artifact.id} overrides ${target}, which another artifact in this candidate also overrides`);
		} else {
			overrideTargets.add(target);
		}
	}
	if (artifact.kind === "workflow_spec") errors.push(...validateWorkflowSpecMetadata(artifact));
	if (artifact.kind === "executable_tool") errors.push(...validateExecutableToolManifest(artifact));
	if (artifact.kind === "skill_manifest" && enforceSkillBodyStructure) errors.push(...validateSkillManifestStructure(artifact));
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
	/**
	 * Deliberately not an exported option: the read path is the only consumer, and a public switch
	 * that disables validation is a switch some future caller will disable by accident.
	 * `loadRevision` re-validates what is already on disk, and a revision promoted before the skill
	 * body rule existed must still load, render, and roll back; enforcing there would quarantine
	 * every such skill and silently drop it out of discovery. Write paths leave it on, so nothing
	 * non-conforming can become active.
	 */
	validation: { enforceSkillBodyStructure?: boolean } = {},
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
	const overrideTargets = new Set<string>();
	for (const artifact of input.artifacts ?? []) {
		errors.push(...validateArtifact(artifact, seen, overrideTargets, validation.enforceSkillBodyStructure !== false));
	}
	const evalFixtureCount = input.artifacts.filter((artifact) => artifact.kind === "eval_fixture").length;
	if (evalFixtureCount > 0 && (evalFixtureCount !== 1 || input.artifacts.length !== 1)) {
		errors.push("eval_fixture verifier candidates must contain exactly one artifact and cannot mix behavioral artifacts");
	}
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

function assertValidInput(
	input: EvolutionCandidateInput,
	options?: EvolutionClockOptions,
	baseline: readonly EvolutionArtifact[] = [],
): EvolutionValidationReport {
	const validation = validateEvolutionCandidateInput(input, options);
	if (!validation.passed) throw new Error(`Invalid evolution candidate: ${validation.errors.join("; ")}`);
	const changes = logicalArtifactChanges(baseline, input.artifacts);
	const total = changes.added + changes.changed + changes.removed;
	if (total > MAX_LOGICAL_CHANGES_PER_CANDIDATE) {
		// Rejected whole, never trimmed. Cutting a candidate down to the budget would silently hand
		// the author a different proposal than the one that was evaluated.
		throw new Error(
			`Evolution candidate exceeds the refinement budget: ${total} logical changes (${changes.added} added, ${changes.changed} changed, ${changes.removed} removed) exceeds the limit of ${MAX_LOGICAL_CHANGES_PER_CANDIDATE}`,
		);
	}
	return validation;
}

/**
 * Kinds whose content is prose someone reads and follows, so two of them saying the same thing
 * differently is the near-duplicate S07.1 is about.
 *
 * `eval_fixture` is excluded because it already has its own exact-content dedup and a repeated trace
 * is a legitimate record rather than a redundant instruction. `executable_tool` and `workflow_spec`
 * are excluded on a different ground: their content is a JSON manifest under its own validation, and
 * prose normalization would corrupt it — case-folding a JSON payload changes the values in it, not
 * just its formatting.
 */
const PROSE_ARTIFACT_KINDS: readonly EvolutionArtifactKind[] = [
	"prompt_note",
	"memory",
	"skill_manifest",
	"subagent_spec",
	"tool_spec",
];

/**
 * Text reduced to what it says rather than how it is typed: NFKC, case-folded, markdown markers
 * dropped, whitespace collapsed. Deliberately Unicode-aware — an ASCII-only filter would erase
 * every CJK character and report two plainly different Chinese skills as the same text.
 */
function normalizedProse(text: string): string {
	return text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[#*_`>[\]()]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function proseArtifacts(artifacts: readonly EvolutionArtifact[]): EvolutionArtifact[] {
	return artifacts.filter((artifact) => PROSE_ARTIFACT_KINDS.includes(artifact.kind));
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

/**
 * Every record an incoming candidate could be duplicating: candidates that are still live or
 * already promoted, plus every revision. Both are checked because a proposal duplicated only
 * against pending candidates would slip through the moment the other one is rejected.
 */
function comparableRecords(scopeRoot: string): { label: string; artifacts: readonly EvolutionArtifact[] }[] {
	const records: { label: string; artifacts: readonly EvolutionArtifact[] }[] = [];
	for (const candidate of listJsonRecords<EvolutionCandidate>(join(scopeRoot, "candidates"), "proposal.json")) {
		if (candidate.status !== "proposed" && candidate.status !== "promoted") continue;
		records.push({ label: `candidate ${candidate.id}`, artifacts: candidate.artifacts });
	}
	for (const revision of listJsonRecords<EvolutionRevision>(join(scopeRoot, "revisions"), "manifest.json")) {
		records.push({ label: `revision ${revision.id}`, artifacts: revision.artifacts });
	}
	return records;
}

/**
 * Refuses a behavioral artifact whose content is byte-identical to one already in the store.
 *
 * Byte-identical rather than "same id": a same-id artifact with identical content is a no-op
 * proposal that would spend a revision to change nothing, and a different id with identical content
 * is the near-duplicate copy this exists to stop. The eval_fixture check above uses the same
 * shape, and its own meaning is untouched.
 */
function assertNoDuplicateProseArtifact(scopeRoot: string, input: EvolutionCandidateInput): void {
	const incoming = proseArtifacts(input.artifacts);
	if (incoming.length === 0) return;
	const found: string[] = [];
	// Compared pairwise in both directions. A batch-wide exemption is the hole: carrying one skill
	// forward puts its id in the incoming set, and that then excused every *other* stored artifact,
	// so a fresh copy arriving in the same batch went unnoticed. Only `a.id === b.id` may skip a
	// pair, and only for that one pair.
	//
	// Within the candidate first, because a copy can arrive with nothing in the store to collide
	// with: a fresh scope has no records, so the ledger check alone would find nothing.
	for (const artifact of incoming) {
		if (artifact.overrides) continue;
		for (const other of incoming) {
			if (other.id === artifact.id) continue;
			if (artifact.content === other.content) {
				found.push(`Duplicate ${artifact.kind} content in one candidate: ${artifact.id} and ${other.id} carry identical content`);
			}
		}
		for (const record of comparableRecords(scopeRoot)) {
			for (const existing of proseArtifacts(record.artifacts)) {
				if (existing.id === artifact.id) continue;
				if (artifact.content === existing.content) {
					found.push(`Duplicate ${artifact.kind} content already exists in ${record.label} as ${existing.id}`);
				}
			}
		}
	}
	if (found.length > 0) throw new Error(found[0]!);
}

/**
 * Names behavioral artifacts that already say, in different words, what an incoming one says.
 *
 * A warning and not a refusal. Two skills that differ only in phrasing are the author's call, not
 * the store's — a reviewer is told, the proposal still lands, and the promotion gate still decides
 * whether it is worth having. Refusing here would block the ordinary case of restating a procedure
 * more clearly, which is most of what a refinement is for.
 *
 * Artifacts that declare they are updating an existing one, or that reuse an existing id, are not
 * reported: they are updates, and flagging an update as a near-duplicate of what it updates would
 * fire on the honest path every time.
 */
function nearDuplicateProseWarnings(scopeRoot: string, input: EvolutionCandidateInput): string[] {
	const incoming = proseArtifacts(input.artifacts);
	if (incoming.length === 0) return [];
	const warnings: string[] = [];
	// Reported once per (incoming, existing) pair, and pairwise for the same reason the refusal is:
	// a batch-wide id set would let a carried-forward skill hide a second near-copy beside it.
	const reported = new Set<string>();
	const compare = (artifact: EvolutionArtifact, other: EvolutionArtifact, label: string): void => {
		// A same-id artifact is an update of what it collides with, not a copy, and an artifact
		// declaring `overrides` has said which entry it supersedes.
		if (artifact.overrides) return;
		if (other.id === artifact.id) return;
		// Keyed on the unordered pair: comparing both directions would report the same single fact
		// twice, and a reviewer reading two lines about one collision would rightly distrust both.
		const [first, second] = [artifact.id, other.id].sort();
		const key = `${first}\u0000${second}`;
		if (reported.has(key)) return;
		if (sha256(normalizedProse(artifact.content)) !== sha256(normalizedProse(other.content))) return;
		reported.add(key);
		warnings.push(`${first} and ${second} say the same thing in ${label}, differing only in wording`);
	};
	for (const artifact of incoming) {
		for (const other of incoming) compare(artifact, other, "this candidate");
		for (const record of comparableRecords(scopeRoot)) {
			for (const existing of proseArtifacts(record.artifacts)) compare(artifact, existing, record.label);
		}
	}
	return warnings;
}

export function createEvolutionCandidate(
	scopeRoot: string,
	input: EvolutionCandidateInput,
	options?: EvolutionClockOptions,
): EvolutionCandidate {
	// Before anything is read or written: the record's declared scope and the directory it is being
	// written to must agree. Every scope-keyed policy downstream reads the field, so a mismatch is
	// a policy bypass rather than a cosmetic inconsistency. The message names the two scopes and not
	// the path, which may sit under a private directory.
	const rootScope = evolutionScopeOfRoot(scopeRoot);
	if (rootScope === undefined) {
		throw new Error("Evolution scope root is not a recognized evolution root, so no candidate scope can be verified against it");
	}
	if (rootScope !== input.scope) {
		throw new Error(`Evolution candidate declares scope ${input.scope} but its scope root is ${rootScope}`);
	}
	// Capture the baseline here, from store state, on the one path every caller funnels through.
	// A model proposal, the refine tool, and a direct caller therefore cannot choose the baseline
	// their evidence will later be judged against. `null` records a genuine first candidate and is
	// distinct from a record that predates this field.
	//
	// Read once and handed to validation, so the budget is measured against the very same revision
	// the candidate records as its baseline. Measuring against a separate read could let a
	// promotion in between produce a budget verdict for a baseline the record does not claim.
	const current = loadCurrentEvolution(scopeRoot);
	const baselineRevisionId = current?.revisionId ?? null;
	// Nothing is written before these throw, so a refused candidate leaves no record at all.
	const validation = assertValidInput(input, options, current ? loadRevision(scopeRoot, current.revisionId).artifacts : []);
	assertNoDuplicateEvalFixture(scopeRoot, input);
	assertNoDuplicateProseArtifact(scopeRoot, input);
	// Recorded on the candidate rather than raised: a near-duplicate is something a reviewer should
	// be shown, not a reason to refuse the proposal.
	validation.warnings.push(...nearDuplicateProseWarnings(scopeRoot, input));
	const id = nextId("candidate", options);
	const createdAt = now(options);
	const candidate: EvolutionCandidate = {
		...input,
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		id,
		contentHash: evolutionCandidateContentHash(input.artifacts),
		status: "proposed",
		createdAt,
		updatedAt: createdAt,
		validation,
		baselineRevisionId,
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
	if (candidate.contentHash !== evolutionCandidateContentHash(candidate.artifacts)) {
		throw new Error(`Evolution candidate content hash mismatch: ${candidateId}`);
	}
	return candidate;
}

function loadRevision(scopeRoot: string, revisionId: string): EvolutionRevision {
	const revision = readJson<EvolutionRevision>(revisionPath(scopeRoot, revisionId));
	if (!revision) throw new Error(`Evolution revision not found: ${revisionId}`);
	if (revision.schemaVersion !== EVOLUTION_SCHEMA_VERSION) throw new Error(`Unsupported evolution revision schema: ${revision.schemaVersion}`);
	const validation = validateEvolutionCandidateInput(revision, undefined, { enforceSkillBodyStructure: false });
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

/**
 * Resolves a candidate's `overrides` into the artifact set the revision will hold.
 *
 * A revision normally *replaces* the active set with the candidate's artifacts, which is right for
 * "here is something new" and wrong for "here is the same skill, improved": the improved artifact
 * would land beside its predecessor under a new id, or the predecessor would be dropped silently.
 * An artifact carrying `overrides` therefore replaces the named active artifact in place, and the
 * rest of the active set is carried forward instead of being discarded.
 *
 * Candidates with no override at all are returned untouched, so every candidate written before
 * this field existed promotes exactly as it did.
 *
 * The baseline is the revision the candidate was captured against, which promotion has already
 * proved is the current one. Merging against it rather than against whatever is live is what makes
 * the result a function of evidence that was actually bound to the benchmark report.
 */
function resolveOverrideArtifacts(
	scopeRoot: string,
	candidate: EvolutionCandidate,
	expectedBaselineRevision: string | null,
): EvolutionArtifact[] {
	const overrides = candidate.artifacts.filter((artifact) => artifact.overrides);
	if (overrides.length === 0) return candidate.artifacts;
	if (expectedBaselineRevision === null) {
		throw new Error("Evolution candidate overrides an active skill, but no revision is active to override");
	}
	const baseline = loadRevision(scopeRoot, expectedBaselineRevision).artifacts;
	const resolved = [...baseline];
	for (const artifact of overrides) {
		const target = artifact.overrides!.skillId;
		const index = resolved.findIndex((existing) => existing.id === target);
		if (index < 0) {
			throw new Error(`Evolution candidate overrides ${target}, which is not active in baseline ${expectedBaselineRevision}`);
		}
		// The incoming artifact now occupies the target's slot. If its own id is already held by a
		// different entry, the resolved set carries one id twice; loadRevision rejects duplicate
		// ids, so that revision could never be read back and the entire active set would be
		// quarantined out of discovery. One id cannot be both the target and its replacement.
		const clash = resolved.findIndex((existing, position) => position !== index && existing.id === artifact.id);
		if (clash >= 0) {
			throw new Error(
				`Evolution candidate overrides ${target} with ${artifact.id}, but ${artifact.id} is also active; an id cannot be both the override target and its replacement`,
			);
		}
		// The instruction is resolved here, so the stored revision carries no proposal-time fields.
		const { overrides: _overrides, ...rest } = artifact;
		resolved[index] = rest as EvolutionArtifact;
	}
	for (const artifact of candidate.artifacts) {
		if (artifact.overrides) continue;
		const index = resolved.findIndex((existing) => existing.id === artifact.id);
		// Reusing an id is how an update was expressed before this field existed, so it still
		// replaces in place. Appending instead would leave two artifacts with one id, and a
		// revision that fails its own duplicate-id check cannot be loaded back.
		if (index >= 0) resolved[index] = artifact;
		else resolved.push(artifact);
	}
	return resolved;
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
	if (options?.gateReport?.passed !== true) {
		throw new Error("Evolution promotion requires a passing gate report");
	}
	if (
		options.gateReport.metrics.passRate !== 1
		|| options.gateReport.metrics.replayDivergences !== 0
		|| options.gateReport.metrics.policyViolations !== 0
		|| options.gateReport.metrics.unpairedToolCalls !== 0
	) {
		throw new Error("Evolution promotion requires a perfect replay and safety gate");
	}
	// The baseline is captured at creation and must still describe reality at promotion. A stale
	// base means the evidence was gathered against different active content than it would replace.
	// Three distinct states, none of which is silently treated as "fine":
	//   - string  : captured against a real revision; must still be the current one
	//   - null    : captured when nothing was active, a legitimate first candidate; promotion
	//               requires that nothing has become active since
	//   - absent  : a record written before this field existed. Readable, but it cannot prove its
	//               base, so it may only promote while no revision is active.
	//
	// Resolved before the evidence check so the report is verified against the same baseline the
	// candidate claims: a report gathered against a different active state cannot activate it.
	const current = loadCurrentEvolution(scopeRoot);
	const expectedBaselineRevision = current?.revisionId ?? null;
	if (!("baselineRevisionId" in candidate)) {
		if (expectedBaselineRevision !== null) {
			throw new Error(
				`Evolution candidate predates baseline capture and cannot prove its base against active revision ${expectedBaselineRevision}`,
			);
		}
	} else if (candidate.baselineRevisionId !== expectedBaselineRevision) {
		throw new Error(
			`Evolution candidate baseline is stale: created against ${candidate.baselineRevisionId ?? "no revision"} but ${expectedBaselineRevision ?? "no revision"} is active`,
		);
	}
	const requiresBenchmark = candidate.artifacts.some((artifact) => artifact.kind !== "eval_fixture");
	if (requiresBenchmark && (
		options.gateReport.benchmark?.passed !== true
		|| !verifyEvolutionBenchmarkReport(options.gateReport.benchmark, candidate.id, candidate.contentHash, expectedBaselineRevision)
	)) {
		throw new Error("Behavioral evolution promotion requires passing integrity-bound benchmark evidence");
	}
	if (!requiresBenchmark && (
		options.gateReport.name !== "candidate-eval-fixture"
	)) {
		throw new Error("eval_fixture promotion requires a passing candidate fixture replay gate");
	}
	const revisionId = nextId("revision", options);
	const createdAt = now(options);
	const resolvedArtifacts = resolveOverrideArtifacts(scopeRoot, candidate, expectedBaselineRevision);
	const contentHash = `sha256:${sha256(JSON.stringify(resolvedArtifacts))}`;
	const revision: EvolutionRevision = {
		schemaVersion: EVOLUTION_SCHEMA_VERSION,
		id: revisionId,
		candidateId: candidate.id,
		scope: candidate.scope,
		summary: candidate.summary,
		rationale: candidate.rationale,
		expectedOutcome: candidate.expectedOutcome,
		artifacts: resolvedArtifacts,
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

/**
 * Rejected candidates at this scope, most recently rejected first.
 *
 * Read for the refiner's history block, so it deliberately returns the whole record rather than a
 * pre-shaped summary: what counts as untrusted is decided at the point where the text becomes
 * prompt, not here. Rejected records are excluded from duplicate detection for the same reason they
 * are included here — a proposal that failed once is still allowed to be made again, because the
 * conditions that failed it may no longer hold.
 */
export function listRejectedCandidates(scopeRoot: string): EvolutionCandidate[] {
	return listJsonRecords<EvolutionCandidate>(join(scopeRoot, "candidates"), "proposal.json")
		.filter((candidate) => candidate.status === "rejected")
		.sort((a, b) => (b.rejectedAt ?? "").localeCompare(a.rejectedAt ?? ""));
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

export function autoEvaluateAndRollback(scopeRoot: string): { rolledBack: string[] } {
	const inspection = inspectEvolution(scopeRoot);
	const current = inspection.current;
	if (!current) return { rolledBack: [] };

	// Group feedbacks by revisionId, sorted by recordedAt ascending
	const feedbackByRevision = new Map<string, EvolutionFeedbackRecord[]>();
	for (const fb of inspection.feedbacks) {
		if (!fb.revisionId) continue;
		const list = feedbackByRevision.get(fb.revisionId) ?? [];
		list.push(fb);
		feedbackByRevision.set(fb.revisionId, list);
	}

	const rolledBack: string[] = [];
	for (const [revisionId, feedbacks] of feedbackByRevision) {
		// Skip if this is already the current revision or it's the rollback target
		if (revisionId === current.revisionId) continue;
		// Count consecutive not_useful from the most recent
		const sorted = [...feedbacks].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
		let consecutiveNotUseful = 0;
		for (const fb of sorted) {
			if (fb.outcome === "not_useful") consecutiveNotUseful++;
			else break;
		}
		if (consecutiveNotUseful >= 3) {
			// Check if not already rolled back away from this revision
			if (current.rollbackOf !== revisionId) {
				try {
					rollbackEvolution(scopeRoot, current.revisionId, { requestedBy: "auto-feedback" });
					rolledBack.push(revisionId);
				} catch { /* skip if rollback fails */ }
			}
		}
	}
	return { rolledBack };
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

/**
 * Revision ids that some rollback moved away from.
 *
 * `rollbackEvolution` records `rollbackOf: <withdrawn revision id>` in history.jsonl, and
 * auto-rollback routes through the same function, so one event covers both paths. History is
 * used rather than the `current` pointer because the pointer's `rollbackOf` only remembers the
 * most recent rollback: a second rollback would otherwise resurrect the first withdrawn revision.
 *
 * Malformed lines are skipped, so a corrupted log degrades to "nothing withdrawn" — the prior
 * behavior — rather than throwing during resource discovery.
 */
export function readWithdrawnRevisionIds(scopeRoot: string): Set<string> {
	const historyPath = join(scopeRoot, "history.jsonl");
	const withdrawn = new Set<string>();
	if (!existsSync(historyPath)) return withdrawn;
	for (const line of readFileSync(historyPath, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line) as { event?: unknown; rollbackOf?: unknown };
			if (event?.event !== "rolled_back") continue;
			if (typeof event.rollbackOf === "string" && event.rollbackOf.length > 0) withdrawn.add(event.rollbackOf);
		} catch { /* skip malformed history line */ }
	}
	return withdrawn;
}

/**
 * Scan all revision directories under <scopeRoot>/revisions/ for SKILL.md files.
 * Unlike loadActiveEvolutionSkillPaths (which only materializes the current active
 * revision's skills), this discovers every skill that was ever promoted, enabling
 * local-only users to benefit from all their accumulated skills without needing
 * remote push or global auto-promotion.
 *
 * Revisions that a rollback withdrew are excluded, and any directory an earlier run left behind
 * is removed. Without this, a rolled-back skill would keep being offered to the model through
 * this historical scan even though `rollbackEvolution` moved the current pointer away from it.
 */
export function discoverLocalSkillPaths(scopeRoot: string): string[] {
	const revisionsDir = join(scopeRoot, "revisions");
	if (!existsSync(revisionsDir)) return [];
	const skillRoot = join(scopeRoot, "resources", "skills", "_local");
	const withdrawn = readWithdrawnRevisionIds(scopeRoot);
	const discovered: string[] = [];
	for (const revEntry of readdirSync(revisionsDir, { withFileTypes: true })) {
		if (!revEntry.isDirectory()) continue;
		if (withdrawn.has(revEntry.name)) {
			// Remove a stale materialization so it cannot re-enter discovery from disk.
			const stale = join(skillRoot, revEntry.name);
			if (existsSync(stale)) {
				assertInside(scopeRoot, stale);
				rmSync(stale, { recursive: true, force: true });
			}
			continue;
		}
		const manifestPath = join(revisionsDir, revEntry.name, "manifest.json");
		if (!existsSync(manifestPath)) continue;
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			if (!manifest?.artifacts) continue;
			const skills = manifest.artifacts.filter((a: Record<string, string>) => a.kind === "skill_manifest");
			if (skills.length === 0) continue;
			const revSkillRoot = join(skillRoot, revEntry.name);
			mkdirSync(revSkillRoot, { recursive: true, mode: 0o700 });
			for (const skill of skills) {
				const skillDir = join(revSkillRoot, evolvedSkillName(skill.id));
				mkdirSync(skillDir, { recursive: true, mode: 0o700 });
				writeFileSync(join(skillDir, "SKILL.md"), skillMarkdown({ id: skill.id, title: skill.title, content: skill.content, applicability: skill.applicability, nonApplicability: skill.nonApplicability } as EvolutionArtifact), { encoding: "utf8", mode: SAFE_FILE_MODE });
			}
			discovered.push(revSkillRoot);
		} catch { /* skip corrupted manifests */ }
	}
	return discovered;
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
