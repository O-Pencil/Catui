/**
 * [WHO]: Deterministic task-cluster bootstrap comparison and integrity-bound promotion reports
 * [FROM]: Depends on node crypto plus benchmark contracts and fail-closed pair validation
 * [TO]: Consumed by the offline benchmark CLI, evolution gate, store, and tests
 * [HERE]: extensions/optional/evolution/benchmark-comparison.ts - real-task effectiveness authority
 */

import { createHash } from "node:crypto";
import { validateBenchmarkPair } from "./benchmark-evidence.js";
import type {
	EvolutionBenchmarkCheckV1,
	EvolutionBenchmarkMetricsV1,
	EvolutionBenchmarkPolicyV1,
	EvolutionBenchmarkPromotionReportV1,
	EvolutionBenchmarkRunV1,
} from "./benchmark-types.js";

export const DEFAULT_EVOLUTION_BENCHMARK_POLICY: EvolutionBenchmarkPolicyV1 = {
	schemaVersion: 1,
	minimumRepetitions: 3,
	minimumPassRateGain: 0.05,
	confidenceLevel: 0.95,
	bootstrapIterations: 10_000,
	maximumSliceRegression: 0.02,
	maximumCostPerSuccessRegression: 0.1,
	maximumP95LatencyRegression: 0.15,
};

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function digest(value: unknown): string {
	return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export function evolutionCandidateContentHash(artifacts: unknown): string {
	return digest(artifacts);
}

function round(value: number): number {
	return Number(value.toFixed(12));
}

function taskRates(runs: readonly EvolutionBenchmarkRunV1[]): Map<string, { rate: number; slices: string[] }> {
	const grouped = new Map<string, { successes: number; count: number; slices: Set<string> }>();
	for (const run of runs) {
		const current = grouped.get(run.taskId) ?? { successes: 0, count: 0, slices: new Set<string>() };
		current.successes += run.success ? 1 : 0;
		current.count += 1;
		for (const slice of run.slices) current.slices.add(slice);
		grouped.set(run.taskId, current);
	}
	return new Map([...grouped.entries()].map(([taskId, value]) => [taskId, {
		rate: value.successes / value.count,
		slices: [...value.slices].sort(),
	}]));
}

function mean(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mulberry32(seed: number): () => number {
	let value = seed >>> 0;
	return () => {
		value += 0x6d2b79f5;
		let result = value;
		result = Math.imul(result ^ (result >>> 15), result | 1);
		result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
		return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function lowerConfidenceBound(deltas: readonly number[], policy: EvolutionBenchmarkPolicyV1, seedText: string): number {
	const seed = Number.parseInt(createHash("sha256").update(seedText).digest("hex").slice(0, 8), 16);
	const random = mulberry32(seed);
	const samples = new Array<number>(policy.bootstrapIterations);
	for (let iteration = 0; iteration < policy.bootstrapIterations; iteration += 1) {
		let total = 0;
		for (let index = 0; index < deltas.length; index += 1) total += deltas[Math.floor(random() * deltas.length)]!;
		samples[iteration] = total / deltas.length;
	}
	samples.sort((left, right) => left - right);
	const percentile = 1 - policy.confidenceLevel;
	return samples[Math.max(0, Math.ceil(percentile * samples.length) - 1)]!;
}

function p95(values: readonly number[]): number {
	const ordered = [...values].sort((left, right) => left - right);
	return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)]!;
}

function regression(baseline: number, candidate: number): number {
	if (baseline === 0) return candidate === 0 ? 0 : 1_000_000_000;
	return (candidate - baseline) / baseline;
}

function costPerSuccess(runs: readonly EvolutionBenchmarkRunV1[]): number {
	const successes = runs.filter((run) => run.success).length;
	if (successes === 0) return 1_000_000_000;
	return runs.reduce((sum, run) => sum + run.costUsd, 0) / successes;
}

function total(runs: readonly EvolutionBenchmarkRunV1[], field: "policyViolations" | "replayDivergences" | "unpairedToolCalls"): number {
	return runs.reduce((sum, run) => sum + run[field], 0);
}

function check(
	id: EvolutionBenchmarkCheckV1["id"],
	passed: boolean,
	actual: number,
	threshold: number,
	summary: string,
): EvolutionBenchmarkCheckV1 {
	return { id, passed, actual: round(actual), threshold, summary };
}

function withoutHash(report: EvolutionBenchmarkPromotionReportV1): Omit<EvolutionBenchmarkPromotionReportV1, "contentHash"> {
	const { contentHash: _contentHash, ...content } = report;
	return content;
}

function benchmarkChecks(metrics: EvolutionBenchmarkMetricsV1, policy: EvolutionBenchmarkPolicyV1): EvolutionBenchmarkCheckV1[] {
	return [
		check("minimum_pass_rate_gain", metrics.passRateGain >= policy.minimumPassRateGain, metrics.passRateGain, policy.minimumPassRateGain, "Held-out pass-rate gain meets the minimum."),
		check("positive_confidence_lower_bound", metrics.confidenceLowerBound > 0, metrics.confidenceLowerBound, 0, "The task-cluster bootstrap lower bound is positive."),
		check("maximum_slice_regression", metrics.maximumSliceRegression >= -policy.maximumSliceRegression, metrics.maximumSliceRegression, -policy.maximumSliceRegression, "No diagnostic slice exceeds the regression budget."),
		check("zero_policy_violations", metrics.policyViolations === 0, metrics.policyViolations, 0, "Candidate has zero policy violations."),
		check("zero_replay_divergences", metrics.replayDivergences === 0, metrics.replayDivergences, 0, "Candidate has zero replay divergences."),
		check("zero_unpaired_tool_calls", metrics.unpairedToolCalls === 0, metrics.unpairedToolCalls, 0, "Candidate has zero unpaired tool calls."),
		check("maximum_cost_per_success_regression", metrics.costPerSuccessRegression <= policy.maximumCostPerSuccessRegression, metrics.costPerSuccessRegression, policy.maximumCostPerSuccessRegression, "Cost per success stays within budget."),
		check("maximum_p95_latency_regression", metrics.p95LatencyRegression <= policy.maximumP95LatencyRegression, metrics.p95LatencyRegression, policy.maximumP95LatencyRegression, "P95 latency stays within budget."),
	];
}

export function compareEvolutionBenchmarks(
	baselineInput: unknown,
	candidateInput: unknown,
	policy: EvolutionBenchmarkPolicyV1,
	options: { candidateId: string; checkedAt?: string },
): EvolutionBenchmarkPromotionReportV1 {
	const pair = validateBenchmarkPair(baselineInput, candidateInput, options.candidateId, policy);
	const baselineTasks = taskRates(pair.baselineHeldout);
	const candidateTasks = taskRates(pair.candidateHeldout);
	const taskIds = [...baselineTasks.keys()].sort();
	const deltas = taskIds.map((taskId) => candidateTasks.get(taskId)!.rate - baselineTasks.get(taskId)!.rate);
	const baselinePassRate = mean(taskIds.map((taskId) => baselineTasks.get(taskId)!.rate));
	const candidatePassRate = mean(taskIds.map((taskId) => candidateTasks.get(taskId)!.rate));
	const sliceDeltas: Record<string, number> = {};
	const sliceNames = [...new Set(taskIds.flatMap((taskId) => baselineTasks.get(taskId)!.slices))].sort();
	for (const slice of sliceNames) {
		const sliceTaskIds = taskIds.filter((taskId) => baselineTasks.get(taskId)!.slices.includes(slice));
		sliceDeltas[slice] = round(mean(sliceTaskIds.map((taskId) => candidateTasks.get(taskId)!.rate - baselineTasks.get(taskId)!.rate)));
	}
	const maximumSliceRegression = Math.min(...Object.values(sliceDeltas));
	const baselineCostPerSuccess = costPerSuccess(pair.baselineHeldout);
	const candidateCostPerSuccess = costPerSuccess(pair.candidateHeldout);
	const baselineP95LatencyMs = p95(pair.baselineHeldout.map((run) => run.latencyMs));
	const candidateP95LatencyMs = p95(pair.candidateHeldout.map((run) => run.latencyMs));
	const metrics: EvolutionBenchmarkMetricsV1 = {
		heldoutTasks: taskIds.length,
		pairedRuns: pair.baselineHeldout.length,
		baselinePassRate: round(baselinePassRate),
		candidatePassRate: round(candidatePassRate),
		passRateGain: round(candidatePassRate - baselinePassRate),
		confidenceLowerBound: round(lowerConfidenceBound(deltas, policy, `${pair.baseline.corpus.digest}:${options.candidateId}`)),
		sliceDeltas,
		maximumSliceRegression: round(maximumSliceRegression),
		policyViolations: total(pair.candidateHeldout, "policyViolations"),
		replayDivergences: total(pair.candidateHeldout, "replayDivergences"),
		unpairedToolCalls: total(pair.candidateHeldout, "unpairedToolCalls"),
		baselineCostPerSuccess: round(baselineCostPerSuccess),
		candidateCostPerSuccess: round(candidateCostPerSuccess),
		costPerSuccessRegression: round(regression(baselineCostPerSuccess, candidateCostPerSuccess)),
		baselineP95LatencyMs: round(baselineP95LatencyMs),
		candidateP95LatencyMs: round(candidateP95LatencyMs),
		p95LatencyRegression: round(regression(baselineP95LatencyMs, candidateP95LatencyMs)),
	};
	const checks = benchmarkChecks(metrics, policy);
	const content: Omit<EvolutionBenchmarkPromotionReportV1, "contentHash"> = {
		schemaVersion: 1,
		kind: "catui-evolution-benchmark-promotion-report",
		candidateId: options.candidateId,
		candidateContentHash: pair.candidate.candidateContentHash!,
		checkedAt: options.checkedAt ?? new Date().toISOString(),
		corpus: pair.baseline.corpus,
		baselineSnapshotHash: digest(pair.baseline),
		candidateSnapshotHash: digest(pair.candidate),
		policy,
		metrics,
		checks,
		passed: checks.every((item) => item.passed),
	};
	return { ...content, contentHash: digest(content) };
}

export function verifyEvolutionBenchmarkReport(
	value: unknown,
	candidateId: string,
	candidateContentHash: string,
): value is EvolutionBenchmarkPromotionReportV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const report = value as Partial<EvolutionBenchmarkPromotionReportV1>;
	if (report.schemaVersion !== 1
		|| report.kind !== "catui-evolution-benchmark-promotion-report"
		|| report.candidateId !== candidateId
		|| report.candidateContentHash !== candidateContentHash
		|| typeof report.passed !== "boolean"
		|| typeof report.contentHash !== "string"
		|| !Array.isArray(report.checks)
		|| typeof report.metrics !== "object" || report.metrics === null
		|| typeof report.policy !== "object" || report.policy === null) {
		return false;
	}
	try {
		const typed = report as EvolutionBenchmarkPromotionReportV1;
		const expectedChecks = benchmarkChecks(typed.metrics, typed.policy);
		return canonical(typed.policy) === canonical(DEFAULT_EVOLUTION_BENCHMARK_POLICY)
			&& canonical(typed.checks) === canonical(expectedChecks)
			&& typed.passed === expectedChecks.every((item) => item.passed)
			&& typed.contentHash === digest(withoutHash(typed));
	} catch {
		return false;
	}
}
