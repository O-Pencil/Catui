/**
 * [WHO]: Versioned real-task benchmark snapshot, policy, metric, check, and promotion-report contracts
 * [FROM]: No runtime dependencies
 * [TO]: Consumed by evolution benchmark validation, comparison, CLI, gate, and store
 * [HERE]: extensions/optional/evolution/benchmark-types.ts - private evolution evidence protocol
 */

export type EvolutionBenchmarkRole = "baseline" | "candidate";
export type EvolutionBenchmarkSplit = "train" | "validation" | "heldout";

export interface EvolutionBenchmarkRunV1 {
	taskId: string;
	repetition: number;
	split: EvolutionBenchmarkSplit;
	slices: string[];
	diagnostics?: string[];
	success: boolean;
	score: number;
	costUsd: number;
	latencyMs: number;
	policyViolations: number;
	replayDivergences: number;
	unpairedToolCalls: number;
}

export interface EvolutionBenchmarkSnapshotV1 {
	schemaVersion: 1;
	kind: "catui-evolution-benchmark-snapshot";
	role: EvolutionBenchmarkRole;
	candidateId?: string;
	candidateContentHash?: string;
	createdAt: string;
	corpus: {
		id: string;
		version: string;
		digest: string;
	};
	harness: {
		revisionId: string;
		commitSha: string;
	};
	execution: {
		model: string;
		modelVersion: string;
		temperature: number;
		maxTokens: number;
		timeoutMs: number;
		budgetUsd: number;
	};
	runs: EvolutionBenchmarkRunV1[];
}

export interface EvolutionBenchmarkPolicyV1 {
	schemaVersion: 1;
	minimumRepetitions: number;
	minimumPassRateGain: number;
	confidenceLevel: number;
	bootstrapIterations: number;
	maximumSliceRegression: number;
	maximumCostPerSuccessRegression: number;
	maximumP95LatencyRegression: number;
}

export type EvolutionBenchmarkCheckId =
	| "minimum_pass_rate_gain"
	| "positive_confidence_lower_bound"
	| "maximum_slice_regression"
	| "zero_policy_violations"
	| "zero_replay_divergences"
	| "zero_unpaired_tool_calls"
	| "maximum_cost_per_success_regression"
	| "maximum_p95_latency_regression";

export interface EvolutionBenchmarkCheckV1 {
	id: EvolutionBenchmarkCheckId;
	passed: boolean;
	actual: number;
	threshold: number;
	summary: string;
}

export interface EvolutionBenchmarkMetricsV1 {
	heldoutTasks: number;
	pairedRuns: number;
	baselinePassRate: number;
	candidatePassRate: number;
	passRateGain: number;
	confidenceLowerBound: number;
	sliceDeltas: Record<string, number>;
	maximumSliceRegression: number;
	policyViolations: number;
	replayDivergences: number;
	unpairedToolCalls: number;
	baselineCostPerSuccess: number;
	candidateCostPerSuccess: number;
	costPerSuccessRegression: number;
	baselineP95LatencyMs: number;
	candidateP95LatencyMs: number;
	p95LatencyRegression: number;
}

export interface EvolutionBenchmarkPromotionReportV1 {
	schemaVersion: 1;
	kind: "catui-evolution-benchmark-promotion-report";
	candidateId: string;
	candidateContentHash: string;
	checkedAt: string;
	corpus: EvolutionBenchmarkSnapshotV1["corpus"];
	baselineSnapshotHash: string;
	candidateSnapshotHash: string;
	policy: EvolutionBenchmarkPolicyV1;
	metrics: EvolutionBenchmarkMetricsV1;
	checks: EvolutionBenchmarkCheckV1[];
	passed: boolean;
	contentHash: string;
}

export interface ValidatedEvolutionBenchmarkPair {
	baseline: EvolutionBenchmarkSnapshotV1;
	candidate: EvolutionBenchmarkSnapshotV1;
	baselineHeldout: EvolutionBenchmarkRunV1[];
	candidateHeldout: EvolutionBenchmarkRunV1[];
}
