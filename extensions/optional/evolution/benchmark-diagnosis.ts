/**
 * [WHO]: Deterministic sanitized failure-cohort diagnosis and integrity verification
 * [FROM]: Depends on node crypto plus the private validated evolution benchmark snapshot boundary
 * [TO]: Consumed by the offline PawBench evidence CLI and focused evolution tests
 * [HERE]: extensions/optional/evolution/benchmark-diagnosis.ts - advisory benchmark failure clustering
 */

import { createHash } from "node:crypto";
import { parseBenchmarkSnapshot } from "./benchmark-evidence.js";
import type {
	EvolutionBenchmarkRunV1,
	EvolutionBenchmarkSnapshotV1,
} from "./benchmark-types.js";

const REPORT_KIND = "catui-evolution-failure-cohort-report" as const;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/;
const CANONICAL_UTC_TIMESTAMP_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_BENCHMARK_RUNS = 10_000;
const MAX_COHORTS = 4_096;
const MAX_TASK_IDS = 100;

type AuditSignal =
	| "policy-violation"
	| "replay-divergence"
	| "unpaired-tool-call";
export type EvolutionFailureSignalV1 = `diagnostic:${string}` | AuditSignal;

export interface EvolutionFailureCohortV1 {
	id: EvolutionFailureSignalV1;
	signal: EvolutionFailureSignalV1;
	runCount: number;
	taskCount: number;
	taskIds: string[];
	taskIdsTruncated: boolean;
}

export interface EvolutionFailureCohortReportV1 {
	schemaVersion: 1;
	kind: typeof REPORT_KIND;
	generatedAt: string;
	snapshotHash: string;
	cohorts: EvolutionFailureCohortV1[];
	contentHash: string;
}

function ordinalCompare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(
		([left], [right]) => ordinalCompare(left, right),
	);
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function digest(value: unknown): string {
	return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function runIdentity(run: EvolutionBenchmarkRunV1): string {
	return `${run.split}\u0000${run.taskId}\u0000${run.repetition}`;
}

function normalizedSnapshot(
	snapshot: EvolutionBenchmarkSnapshotV1,
): EvolutionBenchmarkSnapshotV1 {
	return {
		...snapshot,
		runs: [...snapshot.runs].sort((left, right) => {
			const identityOrder = ordinalCompare(
				runIdentity(left),
				runIdentity(right),
			);
			return identityOrder === 0
				? ordinalCompare(canonical(left), canonical(right))
				: identityOrder;
		}),
	};
}

function assertUniqueRunIdentities(
	runs: readonly EvolutionBenchmarkRunV1[],
): void {
	const identities = new Set<string>();
	for (const run of runs) {
		const identity = runIdentity(run);
		if (identities.has(identity)) {
			throw new Error(
				`Duplicate benchmark run identity for split, task repetition: ${run.split}/${run.taskId}/${run.repetition}`,
			);
		}
		identities.add(identity);
	}
}

function failureSignals(
	run: EvolutionBenchmarkRunV1,
): EvolutionFailureSignalV1[] {
	const signals: EvolutionFailureSignalV1[] = (run.diagnostics ?? []).map(
		(diagnostic) => `diagnostic:${diagnostic}` as const,
	);
	if (run.policyViolations > 0) signals.push("policy-violation");
	if (run.replayDivergences > 0) signals.push("replay-divergence");
	if (run.unpairedToolCalls > 0) signals.push("unpaired-tool-call");
	return signals;
}

function reportContent(
	report: Omit<EvolutionFailureCohortReportV1, "contentHash">,
): Omit<EvolutionFailureCohortReportV1, "contentHash"> {
	return {
		schemaVersion: report.schemaVersion,
		kind: report.kind,
		generatedAt: report.generatedAt,
		snapshotHash: report.snapshotHash,
		cohorts: report.cohorts,
	};
}

function validTimestamp(value: unknown): value is string {
	if (typeof value !== "string" || !CANONICAL_UTC_TIMESTAMP_PATTERN.test(value))
		return false;
	const parsed = new Date(value);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function ownDataRecord(
	value: unknown,
	keys: readonly string[],
): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.some((key) => typeof key !== "string")) return false;
	const actualKeys = (ownKeys as string[]).sort();
	const expectedKeys = [...keys].sort();
	if (
		actualKeys.length !== expectedKeys.length ||
		actualKeys.some((key, index) => key !== expectedKeys[index])
	)
		return false;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	return actualKeys.every((key) => {
		const descriptor = descriptors[key];
		return (
			descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
		);
	});
}

function plainDataArray(value: unknown, maximum: number): value is unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
		return false;
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
	const length = lengthDescriptor?.value;
	if (!Number.isSafeInteger(length) || length < 0 || length > maximum)
		return false;
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== length + 1) return false;
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, "value"))
			return false;
	}
	return true;
}

function positiveSafeInteger(value: unknown, maximum: number): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value > 0 &&
		value <= maximum
	);
}

function validIdentifier(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 512 &&
		IDENTIFIER_PATTERN.test(value)
	);
}

function validSignal(value: unknown): value is EvolutionFailureSignalV1 {
	if (
		value === "policy-violation" ||
		value === "replay-divergence" ||
		value === "unpaired-tool-call"
	)
		return true;
	if (typeof value !== "string" || !value.startsWith("diagnostic:"))
		return false;
	return validIdentifier(value.slice("diagnostic:".length));
}

function strictlyIncreasing(values: readonly string[]): boolean {
	let previous: string | undefined;
	for (const value of values) {
		if (previous !== undefined && ordinalCompare(previous, value) >= 0)
			return false;
		previous = value;
	}
	return true;
}

function parseVerifiedCohort(
	value: unknown,
): EvolutionFailureCohortV1 | undefined {
	if (
		!ownDataRecord(value, [
			"id",
			"signal",
			"runCount",
			"taskCount",
			"taskIds",
			"taskIdsTruncated",
		])
	)
		return undefined;
	if (!validSignal(value.signal) || value.id !== value.signal) return undefined;
	if (
		!positiveSafeInteger(value.runCount, MAX_BENCHMARK_RUNS) ||
		!positiveSafeInteger(value.taskCount, MAX_BENCHMARK_RUNS) ||
		value.taskCount > value.runCount
	)
		return undefined;
	if (!plainDataArray(value.taskIds, MAX_TASK_IDS)) return undefined;
	if (typeof value.taskIdsTruncated !== "boolean") return undefined;
	if (value.taskIds.length !== Math.min(value.taskCount, MAX_TASK_IDS))
		return undefined;
	if (value.taskIdsTruncated !== value.taskCount > MAX_TASK_IDS)
		return undefined;
	const taskIds: string[] = [];
	for (const taskId of value.taskIds) {
		if (!validIdentifier(taskId)) return undefined;
		taskIds.push(taskId);
	}
	if (!strictlyIncreasing(taskIds)) return undefined;
	return {
		id: value.signal,
		signal: value.signal,
		runCount: value.runCount,
		taskCount: value.taskCount,
		taskIds,
		taskIdsTruncated: value.taskIdsTruncated,
	};
}

export function diagnoseEvolutionBenchmarkFailures(
	snapshotInput: unknown,
	options: { generatedAt: string },
): EvolutionFailureCohortReportV1 {
	const snapshot = parseBenchmarkSnapshot(snapshotInput);
	if (!validTimestamp(options.generatedAt))
		throw new Error("generatedAt must be a valid timestamp");
	assertUniqueRunIdentities(snapshot.runs);

	const grouped = new Map<
		EvolutionFailureSignalV1,
		{ runCount: number; seenTaskIds: Set<string>; smallestTaskIds: string[] }
	>();
	for (const run of snapshot.runs) {
		if (run.success) continue;
		for (const signal of failureSignals(run)) {
			let cohort = grouped.get(signal);
			if (!cohort) {
				if (grouped.size >= MAX_COHORTS)
					throw new Error(
						`Failure cohort limit exceeds ${MAX_COHORTS} distinct signals`,
					);
				cohort = {
					runCount: 0,
					seenTaskIds: new Set<string>(),
					smallestTaskIds: [],
				};
				grouped.set(signal, cohort);
			}
			cohort.runCount += 1;
			if (!cohort.seenTaskIds.has(run.taskId)) {
				cohort.seenTaskIds.add(run.taskId);
				cohort.smallestTaskIds.push(run.taskId);
				cohort.smallestTaskIds.sort(ordinalCompare);
				if (cohort.smallestTaskIds.length > MAX_TASK_IDS)
					cohort.smallestTaskIds.pop();
			}
		}
	}

	const cohorts: EvolutionFailureCohortV1[] = [...grouped.entries()]
		.sort(([left], [right]) => ordinalCompare(left, right))
		.map(([signal, cohort]) => {
			return {
				id: signal,
				signal,
				runCount: cohort.runCount,
				taskCount: cohort.seenTaskIds.size,
				taskIds: cohort.smallestTaskIds,
				taskIdsTruncated: cohort.seenTaskIds.size > MAX_TASK_IDS,
			};
		});
	const content: Omit<EvolutionFailureCohortReportV1, "contentHash"> = {
		schemaVersion: 1,
		kind: REPORT_KIND,
		generatedAt: options.generatedAt,
		snapshotHash: digest(normalizedSnapshot(snapshot)),
		cohorts,
	};
	return { ...content, contentHash: digest(content) };
}

export function verifyEvolutionFailureCohortReport(
	value: unknown,
): value is EvolutionFailureCohortReportV1 {
	try {
		if (
			!ownDataRecord(value, [
				"schemaVersion",
				"kind",
				"generatedAt",
				"snapshotHash",
				"cohorts",
				"contentHash",
			])
		)
			return false;
		if (
			value.schemaVersion !== 1 ||
			value.kind !== REPORT_KIND ||
			!validTimestamp(value.generatedAt)
		)
			return false;
		if (
			typeof value.snapshotHash !== "string" ||
			!HASH_PATTERN.test(value.snapshotHash)
		)
			return false;
		if (
			typeof value.contentHash !== "string" ||
			!HASH_PATTERN.test(value.contentHash)
		)
			return false;
		if (!plainDataArray(value.cohorts, MAX_COHORTS)) return false;
		const cohorts: EvolutionFailureCohortV1[] = [];
		for (const cohortInput of value.cohorts) {
			const cohort = parseVerifiedCohort(cohortInput);
			if (!cohort) return false;
			cohorts.push(cohort);
		}
		if (!strictlyIncreasing(cohorts.map((cohort) => cohort.signal)))
			return false;
		const content = reportContent({
			schemaVersion: 1,
			kind: REPORT_KIND,
			generatedAt: value.generatedAt,
			snapshotHash: value.snapshotHash,
			cohorts,
		});
		return value.contentHash === digest(content);
	} catch {
		return false;
	}
}
