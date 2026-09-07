/**
 * [WHO]: Provides the 64 MiB PawBench source bound and byte-bound checkpoint/manifest importer
 * [FROM]: Depends on node:crypto plus private evolution benchmark validation and contracts
 * [TO]: Consumed by the offline PawBench evolution CLI and focused contract tests
 * [HERE]: extensions/optional/evolution/pawbench-import.ts - fail-closed untrusted PawBench import boundary
 */

import { createHash } from "node:crypto";
import { parseBenchmarkSnapshot } from "./benchmark-evidence.js";
import type {
	EvolutionBenchmarkRole,
	EvolutionBenchmarkRunV1,
	EvolutionBenchmarkSnapshotV1,
	EvolutionBenchmarkSplit,
} from "./benchmark-types.js";

export const MAX_PAWBENCH_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_RESULTS = 10_000;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_SHORT_TEXT_LENGTH = 512;
const MAX_DETAIL_TEXT_LENGTH = 16_384;
const MAX_LIST_ITEMS = 32;
const MAX_BREAKDOWN_ITEMS = 64;
const MAX_ARTIFACTS = 64;
const MAX_REPETITION = 1_000_000;
const MAX_AUDIT_COUNT = 1_000_000;
const MAX_COST_USD = 1_000_000;
const MAX_EXECUTION_SECONDS = 7 * 24 * 60 * 60;
const MAX_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_TOKENS = 100_000_000;
const MAX_OBJECT_PROPERTIES = 512;

const SAFE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40,64}$/;

type ParsedManifestResult = {
	repetition: number;
	split: EvolutionBenchmarkSplit;
	costUsd: number;
	policyViolations: number;
	replayDivergences: number;
	unpairedToolCalls: number;
	additionalSlices: string[];
};

type ParsedManifest = Omit<EvolutionBenchmarkSnapshotV1, "runs"> & {
	sourceSha256: string;
	resultIndex: ParsedManifestResult[];
};

type ParsedPawBenchResult = {
	taskId: string;
	score: number;
	maxScore: number;
	passed: boolean;
	executionSeconds: number;
	status: PawBenchResultStatus;
	timedOut: boolean;
	labels: string[];
	failingBreakdownKeys: string[];
};

type PawBenchResultStatus = "success" | "timeout" | "error";

function record(value: unknown, field: string, maximumProperties = MAX_OBJECT_PROPERTIES): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error(`${field} must be a plain JSON object`);
	if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${field} cannot contain symbol properties`);
	let propertyCount = 0;
	for (const key in value) {
		if (!Object.hasOwn(value, key)) continue;
		propertyCount += 1;
		if (propertyCount > maximumProperties) throw new Error(`${field} has too many properties`);
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Object.keys(descriptors).length !== propertyCount) throw new Error(`${field} must contain only enumerable data properties`);
	const copy: Record<string, unknown> = Object.create(null);
	for (const [key, descriptor] of Object.entries(descriptors)) {
		if (!("value" in descriptor)) throw new Error(`${field}.${key} must be an own data property`);
		copy[key] = descriptor.value;
	}
	return copy;
}

function assertKnownKeys(input: Record<string, unknown>, field: string, allowed: readonly string[]): void {
	const allowedKeys = new Set(allowed);
	for (const key of Object.keys(input)) {
		if (!allowedKeys.has(key)) throw new Error(`${field}.${key} is not supported`);
	}
}

function text(value: unknown, field: string, maximum = MAX_SHORT_TEXT_LENGTH, pattern?: RegExp): string {
	if (
		typeof value !== "string"
		|| value.length === 0
		|| value.length > maximum
		|| (pattern !== undefined && !pattern.test(value))
	) {
		throw new Error(`${field} is invalid`);
	}
	return value;
}

function optionalText(value: unknown, field: string, maximum = MAX_DETAIL_TEXT_LENGTH): string | null | undefined {
	if (value === undefined || value === null) return value;
	if (typeof value !== "string" || value.length > maximum) throw new Error(`${field} is invalid`);
	return value;
}

function boundedString(value: unknown, field: string, maximum = MAX_DETAIL_TEXT_LENGTH): string {
	if (typeof value !== "string" || value.length > maximum) throw new Error(`${field} must be a bounded string`);
	return value;
}

function finite(value: unknown, field: string, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new Error(`${field} must be a finite number from ${minimum} to ${maximum}`);
	}
	return value;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
	const parsed = finite(value, field, minimum, maximum);
	if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
	return parsed;
}

function booleanValue(value: unknown, field: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
	return value;
}

function timestamp(value: unknown, field: string): string {
	const parsed = text(value, field);
	if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${field} must be an ISO timestamp`);
	return parsed;
}

function split(value: unknown, field: string): EvolutionBenchmarkSplit {
	if (value !== "train" && value !== "validation" && value !== "heldout") {
		throw new Error(`${field} is invalid`);
	}
	return value;
}

function resultStatus(value: unknown, field: string): PawBenchResultStatus {
	if (value !== "success" && value !== "timeout" && value !== "error") {
		throw new Error(`${field} must be success, timeout, or error`);
	}
	return value;
}

function rawTextList(value: unknown, field: string, allowEmpty = false): string[] {
	if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > MAX_LIST_ITEMS) {
		throw new Error(`${field} must be a bounded${allowEmpty ? "" : " non-empty"} string array`);
	}
	return value.map((item, index) => text(item, `${field}[${index}]`, 128));
}

function normalizeTaxonomyLabel(value: string, field: string): string {
	const normalized = value
		.normalize("NFKC")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._:/-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-._:/]+|[-._:/]+$/g, "");
	if (normalized.length === 0 || normalized.length > MAX_IDENTIFIER_LENGTH || !SAFE_IDENTIFIER.test(normalized)) {
		throw new Error(`${field} cannot be normalized to a safe identifier`);
	}
	return normalized;
}

function normalizedSlices(values: readonly string[], field: string): string[] {
	const normalized = values.map((value, index) => normalizeTaxonomyLabel(value, `${field}[${index}]`));
	const unique = [...new Set(normalized)].sort();
	if (unique.length === 0 || unique.length > MAX_LIST_ITEMS) throw new Error(`${field} has too many normalized slices`);
	return unique;
}

function normalizedDiagnosticKey(value: string): string | undefined {
	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0 || normalized.length > MAX_IDENTIFIER_LENGTH || !SAFE_IDENTIFIER.test(normalized)) {
		return undefined;
	}
	return normalized;
}

function sha256(sourceText: string): string {
	return `sha256:${createHash("sha256").update(sourceText, "utf8").digest("hex")}`;
}

function parseTraceAudit(value: unknown, field: string): Pick<ParsedManifestResult, "policyViolations" | "replayDivergences" | "unpairedToolCalls"> {
	const input = record(value, field);
	assertKnownKeys(input, field, ["policyViolations", "replayDivergences", "unpairedToolCalls"]);
	return {
		policyViolations: integer(input.policyViolations, `${field}.policyViolations`, 0, MAX_AUDIT_COUNT),
		replayDivergences: integer(input.replayDivergences, `${field}.replayDivergences`, 0, MAX_AUDIT_COUNT),
		unpairedToolCalls: integer(input.unpairedToolCalls, `${field}.unpairedToolCalls`, 0, MAX_AUDIT_COUNT),
	};
}

function parseManifestResult(value: unknown, field: string): ParsedManifestResult {
	const input = record(value, field);
	assertKnownKeys(input, field, ["repetition", "split", "costUsd", "traceAudit", "extraSlices", "additionalSlices"]);
	if (input.extraSlices !== undefined && input.additionalSlices !== undefined) {
		throw new Error(`${field} cannot contain both extraSlices and additionalSlices`);
	}
	const sliceInput = input.extraSlices ?? input.additionalSlices;
	const rawAdditionalSlices = sliceInput === undefined
		? []
		: rawTextList(sliceInput, `${field}.additionalSlices`, true);
	const additionalSlices = rawAdditionalSlices.length === 0
		? []
		: normalizedSlices(rawAdditionalSlices, `${field}.additionalSlices`);
	return {
		repetition: integer(input.repetition, `${field}.repetition`, 1, MAX_REPETITION),
		split: split(input.split, `${field}.split`),
		costUsd: finite(input.costUsd, `${field}.costUsd`, 0, MAX_COST_USD),
		...parseTraceAudit(input.traceAudit, `${field}.traceAudit`),
		additionalSlices,
	};
}

function parseExactResultIndex(value: unknown, resultCount: number): ParsedManifestResult[] {
	const input = record(value, "manifest.resultIndex", Math.min(resultCount, MAX_RESULTS));
	const entries = Object.entries(input);
	if (entries.length !== resultCount) {
		throw new Error(`manifest.resultIndex must map every result exactly once; expected ${resultCount} indexes`);
	}
	const parsed: Array<ParsedManifestResult | undefined> = Array.from({ length: resultCount });
	for (const [key, entry] of entries) {
		if (!/^(0|[1-9][0-9]*)$/.test(key)) throw new Error(`manifest.resultIndex key ${key} is not a canonical integer index`);
		const index = Number(key);
		if (!Number.isSafeInteger(index) || index < 0 || index >= resultCount) {
			throw new Error(`manifest.resultIndex key ${key} is out of range`);
		}
		if (parsed[index] !== undefined) throw new Error(`manifest.resultIndex contains duplicate index ${index}`);
		parsed[index] = parseManifestResult(entry, `manifest.resultIndex[${key}]`);
	}
	return parsed.map((entry, index) => {
		if (entry === undefined) throw new Error(`manifest.resultIndex is missing result index ${index}`);
		return entry;
	});
}

function parseManifest(value: unknown, resultCount: number): ParsedManifest {
	const input = record(value, "PawBench import manifest");
	assertKnownKeys(input, "manifest", [
		"schemaVersion",
		"kind",
		"sourceSha256",
		"role",
		"candidateId",
		"candidateContentHash",
		"createdAt",
		"corpus",
		"harness",
		"execution",
		"resultIndex",
	]);
	if (input.schemaVersion !== 1) throw new Error("Unsupported PawBench import manifest schema version");
	if (input.kind !== "catui-pawbench-import-manifest") throw new Error("PawBench import manifest kind is invalid");
	if (input.role !== "baseline" && input.role !== "candidate") throw new Error("PawBench import manifest role is invalid");
	const role: EvolutionBenchmarkRole = input.role;
	const candidateId = input.candidateId === undefined
		? undefined
		: text(input.candidateId, "manifest.candidateId", MAX_IDENTIFIER_LENGTH, /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
	const candidateContentHash = input.candidateContentHash === undefined
		? undefined
		: text(input.candidateContentHash, "manifest.candidateContentHash", 71, SHA256);
	if (role === "candidate" && candidateId === undefined) throw new Error("Candidate PawBench manifest requires candidateId");
	if (role === "candidate" && candidateContentHash === undefined) throw new Error("Candidate PawBench manifest requires candidateContentHash");
	if (role === "baseline" && candidateId !== undefined) throw new Error("Baseline PawBench manifest cannot carry candidateId");
	if (role === "baseline" && candidateContentHash !== undefined) throw new Error("Baseline PawBench manifest cannot carry candidateContentHash");

	const corpus = record(input.corpus, "manifest.corpus");
	assertKnownKeys(corpus, "manifest.corpus", ["id", "version", "digest"]);
	const harness = record(input.harness, "manifest.harness");
	assertKnownKeys(harness, "manifest.harness", ["revisionId", "commitSha"]);
	const execution = record(input.execution, "manifest.execution");
	assertKnownKeys(execution, "manifest.execution", ["model", "modelVersion", "temperature", "maxTokens", "timeoutMs", "budgetUsd"]);

	return {
		schemaVersion: 1,
		kind: "catui-evolution-benchmark-snapshot",
		role,
		...(candidateId === undefined ? {} : { candidateId }),
		...(candidateContentHash === undefined ? {} : { candidateContentHash }),
		sourceSha256: text(input.sourceSha256, "manifest.sourceSha256", 71, SHA256),
		createdAt: timestamp(input.createdAt, "manifest.createdAt"),
		corpus: {
			id: text(corpus.id, "manifest.corpus.id", MAX_IDENTIFIER_LENGTH, /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/),
			version: text(corpus.version, "manifest.corpus.version"),
			digest: text(corpus.digest, "manifest.corpus.digest", 71, SHA256),
		},
		harness: {
			revisionId: text(harness.revisionId, "manifest.harness.revisionId", MAX_IDENTIFIER_LENGTH, /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
			commitSha: text(harness.commitSha, "manifest.harness.commitSha", 64, COMMIT_SHA),
		},
		execution: {
			model: text(execution.model, "manifest.execution.model"),
			modelVersion: text(execution.modelVersion, "manifest.execution.modelVersion"),
			temperature: finite(execution.temperature, "manifest.execution.temperature", 0, 2),
			maxTokens: integer(execution.maxTokens, "manifest.execution.maxTokens", 1, MAX_TOKENS),
			timeoutMs: integer(execution.timeoutMs, "manifest.execution.timeoutMs", 1, MAX_TIMEOUT_MS),
			budgetUsd: finite(execution.budgetUsd, "manifest.execution.budgetUsd", 0.000001, MAX_COST_USD),
		},
		resultIndex: parseExactResultIndex(input.resultIndex, resultCount),
	};
}

function parseBreakdown(value: unknown, field: string): string[] {
	const input = record(value, field);
	const entries = Object.entries(input);
	if (entries.length > MAX_BREAKDOWN_ITEMS) {
		throw new Error(`${field} cannot contain more than ${MAX_BREAKDOWN_ITEMS} graders`);
	}
	const failing: string[] = [];
	for (const [key, rawScore] of entries) {
		text(key, `${field} key`, 128);
		const score = finite(rawScore, `${field}.${key}`, 0, 1);
		if (score < 1) {
			const diagnostic = normalizedDiagnosticKey(key);
			if (diagnostic !== undefined) failing.push(diagnostic);
		}
	}
	return [...new Set(failing)].sort();
}

function validateUsage(value: unknown, field: string): void {
	const input = record(value, field);
	assertKnownKeys(input, field, ["prompt_tokens", "completion_tokens", "total_tokens", "estimated"]);
	if (input.prompt_tokens !== undefined) integer(input.prompt_tokens, `${field}.prompt_tokens`, 0, MAX_TOKENS);
	if (input.completion_tokens !== undefined) integer(input.completion_tokens, `${field}.completion_tokens`, 0, MAX_TOKENS);
	if (input.total_tokens !== undefined) integer(input.total_tokens, `${field}.total_tokens`, 0, MAX_TOKENS * 2);
	if (input.estimated !== undefined) booleanValue(input.estimated, `${field}.estimated`);
}

function validateBoundedJson(value: unknown, field: string, depth = 0): void {
	if (value === null || typeof value === "boolean") return;
	if (typeof value === "number") {
		finite(value, field, -1_000_000_000, 1_000_000_000);
		return;
	}
	if (typeof value === "string") {
		boundedString(value, field);
		return;
	}
	if (depth >= 4) throw new Error(`${field} exceeds the supported nesting depth`);
	if (Array.isArray(value)) {
		if (value.length > 256) throw new Error(`${field} must be a bounded array`);
		value.forEach((item, index) => validateBoundedJson(item, `${field}[${index}]`, depth + 1));
		return;
	}
	const input = record(value, field);
	const entries = Object.entries(input);
	if (entries.length > 256) throw new Error(`${field} must be a bounded object`);
	for (const [key, item] of entries) {
		text(key, `${field} key`, 128);
		validateBoundedJson(item, `${field}.${key}`, depth + 1);
	}
}

function parseLabels(value: unknown, field: string): string[] {
	const input = record(value, field);
	assertKnownKeys(input, field, ["scenario", "capabilities", "complexity", "modality", "environment"]);
	const values: string[] = [];
	if (input.scenario !== undefined) values.push(text(input.scenario, `${field}.scenario`, 128));
	if (input.capabilities !== undefined) values.push(...rawTextList(input.capabilities, `${field}.capabilities`, true));
	if (input.complexity !== undefined) values.push(text(input.complexity, `${field}.complexity`, 128));
	const modalityValues: string[] = [];
	if (input.modality !== undefined) {
		if (typeof input.modality === "string") {
			modalityValues.push(text(input.modality, `${field}.modality`, 128));
		} else {
			const modality = record(input.modality, `${field}.modality`);
			assertKnownKeys(modality, `${field}.modality`, ["type", "channels"]);
			modalityValues.push(text(modality.type, `${field}.modality.type`, 128));
			modalityValues.push(...rawTextList(modality.channels, `${field}.modality.channels`, true));
		}
	}
	values.push(...modalityValues);
	if (input.environment !== undefined) values.push(text(input.environment, `${field}.environment`, 128));
	return values;
}

function validateSummaryKeys(summary: Record<string, unknown>): void {
	const required = new Set([
		"total_runs",
		"tasks_completed",
		"passed",
		"pass_rate",
		"avg_score",
		"runs_per_task",
		"total_time",
		"avg_execution_time",
		"total_usage",
		"errors",
		"by_label",
	]);
	for (const key of Object.keys(summary)) {
		if (!required.has(key) && !/^pass[@^][1-9][0-9]*(?:_count)?$/.test(key)) {
			throw new Error(`checkpoint.summary.${key} is not supported`);
		}
	}
}

function validatePassKMetrics(summary: Record<string, unknown>, totalRuns: number): void {
	for (const [key, value] of Object.entries(summary)) {
		if (!/^pass[@^][1-9][0-9]*(?:_count)?$/.test(key)) continue;
		if (key.endsWith("_count")) integer(value, `checkpoint.summary.${key}`, 0, totalRuns);
		else finite(value, `checkpoint.summary.${key}`, 0, 1);
	}
}

function validateErrorSummary(value: unknown, totalRuns: number): void {
	const errors = record(value, "checkpoint.summary.errors");
	assertKnownKeys(errors, "checkpoint.summary.errors", ["total", "timed_out", "failed"]);
	integer(errors.total, "checkpoint.summary.errors.total", 0, totalRuns);
	integer(errors.timed_out, "checkpoint.summary.errors.timed_out", 0, totalRuns);
	integer(errors.failed, "checkpoint.summary.errors.failed", 0, totalRuns);
}

function validateArtifacts(value: unknown, field: string): void {
	if (!Array.isArray(value) || value.length > MAX_ARTIFACTS) throw new Error(`${field} must be a bounded array`);
	for (let index = 0; index < value.length; index += 1) record(value[index], `${field}[${index}]`);
}

function parsePawBenchResult(value: unknown, index: number): ParsedPawBenchResult {
	const field = `checkpoint.results[${index}]`;
	const input = record(value, field);
	const taskId = text(input.task_id, `${field}.task_id`, MAX_IDENTIFIER_LENGTH, SAFE_IDENTIFIER);
	text(input.task_name, `${field}.task_name`);
	const maxScore = finite(input.max_score, `${field}.max_score`, Number.MIN_VALUE, 1_000_000);
	const score = finite(input.score, `${field}.score`, 0, maxScore);
	const passed = booleanValue(input.passed, `${field}.passed`);
	text(input.grading_type, `${field}.grading_type`, 128, SAFE_IDENTIFIER);
	const failingBreakdownKeys = parseBreakdown(input.breakdown, `${field}.breakdown`);
	boundedString(input.notes, `${field}.notes`);
	const executionSeconds = finite(input.execution_time, `${field}.execution_time`, 0, MAX_EXECUTION_SECONDS);
	const status = resultStatus(input.status, `${field}.status`);
	validateUsage(input.usage, `${field}.usage`);
	integer(input.transcript_length, `${field}.transcript_length`, 0, MAX_TOKENS);
	const timedOut = booleanValue(input.timed_out, `${field}.timed_out`);
	if (passed && status !== "success") throw new Error(`${field}.passed cannot be true when status is ${status}`);
	if (status === "success" && timedOut) throw new Error(`${field}.timed_out cannot be true when status is success`);
	if (status === "timeout" && !timedOut) throw new Error(`${field}.timed_out must be true when status is timeout`);
	boundedString(input.error, `${field}.error`);
	if (input.prompt !== undefined) optionalText(input.prompt, `${field}.prompt`, 65_536);
	if (input.artifacts !== undefined) validateArtifacts(input.artifacts, `${field}.artifacts`);
	const anomaly = record(input.anomaly, `${field}.anomaly`);
	const hasError = booleanValue(anomaly.has_error, `${field}.anomaly.has_error`);
	if (anomaly.reason !== undefined) optionalText(anomaly.reason, `${field}.anomaly.reason`);
	if (hasError) throw new Error(`${field}.anomaly.has_error cannot be true for promotion evidence`);
	const labels = parseLabels(input.labels, `${field}.labels`);
	return { taskId, score, maxScore, passed, executionSeconds, status, timedOut, labels, failingBreakdownKeys };
}

function parseCheckpoint(sourceText: string): { model: string; results: ParsedPawBenchResult[] } {
	if (typeof sourceText !== "string" || sourceText.length === 0) throw new Error("PawBench source text must be non-empty");
	if (Buffer.byteLength(sourceText, "utf8") > MAX_PAWBENCH_SOURCE_BYTES) throw new Error("PawBench source bytes exceed the import limit");
	let parsed: unknown;
	try {
		parsed = JSON.parse(sourceText);
	} catch {
		throw new Error("PawBench source must be valid JSON");
	}
	const input = record(parsed, "PawBench checkpoint");
	if (input.benchmark !== "pawbench") throw new Error("PawBench checkpoint benchmark must be 'pawbench'");
	const model = text(input.model, "checkpoint.model");
	timestamp(input.timestamp, "checkpoint.timestamp");
	if (!Array.isArray(input.results) || input.results.length === 0 || input.results.length > MAX_RESULTS) {
		throw new Error(`PawBench checkpoint results must contain between 1 and ${MAX_RESULTS} entries`);
	}
	const results = input.results.map(parsePawBenchResult);
	const summary = record(input.summary, "checkpoint.summary");
	validateSummaryKeys(summary);
	const total = integer(summary.total_runs, "checkpoint.summary.total_runs", 1, MAX_RESULTS);
	integer(summary.tasks_completed, "checkpoint.summary.tasks_completed", 0, total);
	const passed = integer(summary.passed, "checkpoint.summary.passed", 0, MAX_RESULTS);
	const passRate = finite(summary.pass_rate, "checkpoint.summary.pass_rate", 0, 1);
	finite(summary.avg_score, "checkpoint.summary.avg_score", 0, 1_000_000);
	integer(summary.runs_per_task, "checkpoint.summary.runs_per_task", 1, MAX_REPETITION);
	finite(summary.total_time, "checkpoint.summary.total_time", 0, MAX_EXECUTION_SECONDS * MAX_RESULTS);
	finite(summary.avg_execution_time, "checkpoint.summary.avg_execution_time", 0, MAX_EXECUTION_SECONDS);
	validateUsage(summary.total_usage, "checkpoint.summary.total_usage");
	validateErrorSummary(summary.errors, total);
	validateBoundedJson(summary.by_label, "checkpoint.summary.by_label");
	validatePassKMetrics(summary, total);
	const actualPassed = results.filter((result) => result.passed).length;
	if (total !== results.length || passed !== actualPassed) {
		throw new Error("PawBench checkpoint summary counts do not match results");
	}
	const actualPassRate = actualPassed / results.length;
	if (Math.abs(passRate - actualPassRate) > 0.0001) throw new Error("PawBench checkpoint summary pass_rate does not match results");
	return { model, results };
}

function diagnosticsFor(result: ParsedPawBenchResult): string[] | undefined {
	const diagnostics = [...result.failingBreakdownKeys];
	if (result.timedOut) diagnostics.push("timeout");
	if (result.status !== "success") {
		const status = normalizedDiagnosticKey(result.status.replace(/_/g, "-"));
		if (status !== undefined) diagnostics.push(`status:${status}`);
	}
	const unique = [...new Set(diagnostics)].sort();
	if (unique.length > MAX_LIST_ITEMS) throw new Error(`PawBench result diagnostics exceed ${MAX_LIST_ITEMS} identifiers`);
	return unique.length === 0 ? undefined : unique;
}

export function importPawBenchEvolutionSnapshot(sourceText: string, manifestInput: unknown): EvolutionBenchmarkSnapshotV1 {
	const checkpoint = parseCheckpoint(sourceText);
	const manifest = parseManifest(manifestInput, checkpoint.results.length);
	if (manifest.sourceSha256 !== sha256(sourceText)) {
		throw new Error("PawBench source byte digest does not match manifest.sourceSha256");
	}
	if (manifest.execution.model !== checkpoint.model) {
		throw new Error("PawBench checkpoint model does not match the frozen manifest execution model");
	}
	let costSumUsd = 0;
	let costCorrectionUsd = 0;
	const runs: EvolutionBenchmarkRunV1[] = checkpoint.results.map((result, index) => {
		const attestation = manifest.resultIndex[index];
		if (attestation === undefined) throw new Error(`PawBench manifest is missing result index ${index}`);
		const latencyMs = result.executionSeconds * 1_000;
		if (latencyMs > manifest.execution.timeoutMs) {
			throw new Error(`PawBench result ${index} latency exceeds the frozen execution timeout`);
		}
		const nextCostSumUsd = costSumUsd + attestation.costUsd;
		costCorrectionUsd += Math.abs(costSumUsd) >= Math.abs(attestation.costUsd)
			? (costSumUsd - nextCostSumUsd) + attestation.costUsd
			: (attestation.costUsd - nextCostSumUsd) + costSumUsd;
		costSumUsd = nextCostSumUsd;
		const diagnostics = diagnosticsFor(result);
		return {
			taskId: result.taskId,
			repetition: attestation.repetition,
			split: attestation.split,
			slices: normalizedSlices([...result.labels, ...attestation.additionalSlices], `checkpoint.results[${index}].slices`),
			success: result.passed,
			score: result.score / result.maxScore,
			costUsd: attestation.costUsd,
			latencyMs,
			policyViolations: attestation.policyViolations,
			replayDivergences: attestation.replayDivergences,
			unpairedToolCalls: attestation.unpairedToolCalls,
			...(diagnostics === undefined ? {} : { diagnostics }),
		};
	});
	const totalCostUsd = costSumUsd + costCorrectionUsd;
	const monetaryMagnitude = Math.max(1, Math.abs(totalCostUsd), manifest.execution.budgetUsd);
	const budgetTolerance = monetaryMagnitude * Number.EPSILON * Math.max(8, runs.length * 2);
	if (totalCostUsd - manifest.execution.budgetUsd > budgetTolerance) {
		throw new Error("PawBench attested result costs exceed the frozen execution budget");
	}
	return parseBenchmarkSnapshot({
		schemaVersion: manifest.schemaVersion,
		kind: manifest.kind,
		role: manifest.role,
		...(manifest.candidateId === undefined ? {} : { candidateId: manifest.candidateId }),
		...(manifest.candidateContentHash === undefined ? {} : { candidateContentHash: manifest.candidateContentHash }),
		createdAt: manifest.createdAt,
		corpus: manifest.corpus,
		harness: manifest.harness,
		execution: manifest.execution,
		runs,
	});
}
