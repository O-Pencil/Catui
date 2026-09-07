/**
 * [WHO]: Fail-closed benchmark snapshot parsing and frozen paired-run validation
 * [FROM]: Depends on private evolution benchmark contracts
 * [TO]: Consumed by benchmark comparison, CLI, tests, and promotion evidence loading
 * [HERE]: extensions/optional/evolution/benchmark-evidence.ts - untrusted benchmark input boundary
 */

import type {
	EvolutionBenchmarkPolicyV1,
	EvolutionBenchmarkRunV1,
	EvolutionBenchmarkSnapshotV1,
	EvolutionBenchmarkSplit,
	ValidatedEvolutionBenchmarkPair,
} from "./benchmark-types.js";

const MAX_BENCHMARK_RUNS = 10_000;

function record(value: unknown, field: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error(`${field} must be a plain object`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const data: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") throw new Error(`${field} must contain only string data properties`);
		const descriptor = descriptors[key];
		if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, "value")) {
			throw new Error(`${field}.${key} must be an own data property`);
		}
		data[key] = descriptor.value;
	}
	return data;
}

function dataArray(value: unknown, field: string, minimum: number, maximum: number): unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new Error(`${field} must be a plain array`);
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
	const length = lengthDescriptor?.value;
	if (!Number.isSafeInteger(length) || length < minimum || length > maximum) {
		throw new Error(`${field} array length must be from ${minimum} to ${maximum}`);
	}
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== length + 1) throw new Error(`${field} must be a dense array without extra properties`);
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, "value")) {
			throw new Error(`${field}[${index}] must be an own data property`);
		}
	}
	return value;
}

function text(value: unknown, field: string, pattern?: RegExp): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 512 || (pattern && !pattern.test(value))) {
		throw new Error(`${field} is invalid`);
	}
	return value;
}

function finite(value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new Error(`${field} must be a finite number from ${minimum} to ${maximum}`);
	}
	return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
	const parsed = finite(value, field, minimum);
	if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
	return parsed;
}

function timestamp(value: unknown, field: string): string {
	const parsed = text(value, field);
	if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${field} must be an ISO timestamp`);
	return parsed;
}

function split(value: unknown, field: string): EvolutionBenchmarkSplit {
	if (value !== "train" && value !== "validation" && value !== "heldout") throw new Error(`${field} is invalid`);
	return value;
}

function stringList(value: unknown, field: string): string[] {
	const input = dataArray(value, field, 1, 32);
	const values = input.map((item, index) => text(item, `${field}[${index}]`, /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/));
	if (new Set(values).size !== values.length) throw new Error(`${field} contains duplicates`);
	return [...values].sort();
}

function parseRun(value: unknown, index: number): EvolutionBenchmarkRunV1 {
	const input = record(value, `runs[${index}]`);
	const diagnostics = input.diagnostics === undefined
		? undefined
		: stringList(input.diagnostics, `runs[${index}].diagnostics`);
	return {
		taskId: text(input.taskId, `runs[${index}].taskId`, /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),
		repetition: integer(input.repetition, `runs[${index}].repetition`, 1),
		split: split(input.split, `runs[${index}].split`),
		slices: stringList(input.slices, `runs[${index}].slices`),
		...(diagnostics ? { diagnostics } : {}),
		success: (() => {
			if (typeof input.success !== "boolean") throw new Error(`runs[${index}].success must be boolean`);
			return input.success;
		})(),
		score: finite(input.score, `runs[${index}].score`, 0, 1),
		costUsd: finite(input.costUsd, `runs[${index}].costUsd`),
		latencyMs: finite(input.latencyMs, `runs[${index}].latencyMs`),
		policyViolations: integer(input.policyViolations, `runs[${index}].policyViolations`),
		replayDivergences: integer(input.replayDivergences, `runs[${index}].replayDivergences`),
		unpairedToolCalls: integer(input.unpairedToolCalls, `runs[${index}].unpairedToolCalls`),
	};
}

export function parseBenchmarkSnapshot(value: unknown): EvolutionBenchmarkSnapshotV1 {
	const input = record(value, "Benchmark snapshot");
	if (input.schemaVersion !== 1) throw new Error("Unsupported benchmark snapshot schema version");
	if (input.kind !== "catui-evolution-benchmark-snapshot") throw new Error("Benchmark snapshot kind is invalid");
	if (input.role !== "baseline" && input.role !== "candidate") throw new Error("Benchmark snapshot role is invalid");
	const corpus = record(input.corpus, "corpus");
	const harness = record(input.harness, "harness");
	const execution = record(input.execution, "execution");
	if (Array.isArray(input.runs) && Object.getOwnPropertyDescriptor(input.runs, "length")?.value === 0) {
		throw new Error("Benchmark snapshot runs must be non-empty");
	}
	const runs = dataArray(input.runs, "Benchmark snapshot runs", 1, MAX_BENCHMARK_RUNS);
	const candidateId = input.candidateId === undefined ? undefined : text(input.candidateId, "candidateId", /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
	const candidateContentHash = input.candidateContentHash === undefined
		? undefined
		: text(input.candidateContentHash, "candidateContentHash", /^sha256:[a-f0-9]{64}$/);
	if (input.role === "candidate" && !candidateId) throw new Error("Candidate benchmark snapshot requires candidateId");
	if (input.role === "candidate" && !candidateContentHash) throw new Error("Candidate benchmark snapshot requires candidateContentHash");
	if (input.role === "baseline" && candidateId) throw new Error("Baseline benchmark snapshot cannot carry candidateId");
	if (input.role === "baseline" && candidateContentHash) throw new Error("Baseline benchmark snapshot cannot carry candidateContentHash");
	return {
		schemaVersion: 1,
		kind: "catui-evolution-benchmark-snapshot",
		role: input.role,
		...(candidateId ? { candidateId } : {}),
		...(candidateContentHash ? { candidateContentHash } : {}),
		createdAt: timestamp(input.createdAt, "createdAt"),
		corpus: {
			id: text(corpus.id, "corpus.id", /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/),
			version: text(corpus.version, "corpus.version"),
			digest: text(corpus.digest, "corpus.digest", /^sha256:[a-f0-9]{64}$/),
		},
		harness: {
			revisionId: text(harness.revisionId, "harness.revisionId", /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
			commitSha: text(harness.commitSha, "harness.commitSha", /^[a-f0-9]{40,64}$/),
		},
		execution: {
			model: text(execution.model, "execution.model"),
			modelVersion: text(execution.modelVersion, "execution.modelVersion"),
			temperature: finite(execution.temperature, "execution.temperature", 0, 2),
			maxTokens: integer(execution.maxTokens, "execution.maxTokens", 1),
			timeoutMs: integer(execution.timeoutMs, "execution.timeoutMs", 1),
			budgetUsd: finite(execution.budgetUsd, "execution.budgetUsd", 0.000001),
		},
		runs: runs.map(parseRun),
	};
}

function runKey(run: EvolutionBenchmarkRunV1): string {
	return `${run.split}\u0000${run.taskId}\u0000${run.repetition}`;
}

function heldoutKey(run: EvolutionBenchmarkRunV1): string {
	return `${run.taskId}\u0000${run.repetition}`;
}

function uniqueRuns(runs: readonly EvolutionBenchmarkRunV1[], role: string): void {
	const keys = new Set<string>();
	for (const run of runs) {
		const key = runKey(run);
		if (keys.has(key)) throw new Error(`${role} benchmark contains duplicate task repetition: ${run.taskId}/${run.repetition}`);
		keys.add(key);
	}
}

function stable(value: unknown): string {
	return JSON.stringify(value);
}

export function validateBenchmarkPair(
	baselineInput: unknown,
	candidateInput: unknown,
	candidateId: string,
	policy: EvolutionBenchmarkPolicyV1,
): ValidatedEvolutionBenchmarkPair {
	const baseline = parseBenchmarkSnapshot(baselineInput);
	const candidate = parseBenchmarkSnapshot(candidateInput);
	if (baseline.role !== "baseline" || candidate.role !== "candidate") throw new Error("Benchmark roles must be baseline then candidate");
	if (candidate.candidateId !== candidateId) throw new Error("Benchmark candidateId does not match the evolution candidate");
	if (stable(baseline.corpus) !== stable(candidate.corpus)) throw new Error("Benchmark corpus identity differs between baseline and candidate");
	if (stable(baseline.execution) !== stable(candidate.execution)) throw new Error("Benchmark execution envelope differs between baseline and candidate");
	uniqueRuns(baseline.runs, "Baseline");
	uniqueRuns(candidate.runs, "Candidate");
	const baselineHeldout = baseline.runs.filter((run) => run.split === "heldout");
	const candidateHeldout = candidate.runs.filter((run) => run.split === "heldout");
	if (baselineHeldout.length === 0 || candidateHeldout.length === 0) throw new Error("Benchmark requires held-out runs");
	const baselineByKey = new Map(baselineHeldout.map((run) => [heldoutKey(run), run]));
	const candidateByKey = new Map(candidateHeldout.map((run) => [heldoutKey(run), run]));
	if (baselineByKey.size !== candidateByKey.size || [...baselineByKey.keys()].some((key) => !candidateByKey.has(key))) {
		throw new Error("Benchmark held-out runs are not exactly paired by task and repetition");
	}
	const repetitions = new Map<string, Set<number>>();
	for (const run of baselineHeldout) {
		const values = repetitions.get(run.taskId) ?? new Set<number>();
		values.add(run.repetition);
		repetitions.set(run.taskId, values);
		const paired = candidateByKey.get(heldoutKey(run));
		if (!paired || stable(run.slices) !== stable(paired.slices)) throw new Error(`Benchmark paired run metadata differs for ${run.taskId}/${run.repetition}`);
	}
	for (const [taskId, values] of repetitions) {
		if (values.size < policy.minimumRepetitions) {
			throw new Error(`Benchmark held-out task ${taskId} has fewer than ${policy.minimumRepetitions} paired repetitions`);
		}
	}
	return { baseline, candidate, baselineHeldout, candidateHeldout };
}
