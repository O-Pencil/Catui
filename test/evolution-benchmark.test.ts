/**
 * [WHO]: Paired held-out evolution benchmark contract, statistics, and integrity regression tests
 * [FROM]: Depends on node:test/assert and optional evolution benchmark modules
 * [TO]: Guards frozen execution, statistical promotion, operational limits, and report binding
 * [HERE]: test/evolution-benchmark.test.ts - evidence-gated evolution benchmark coverage
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	compareEvolutionBenchmarks,
	DEFAULT_EVOLUTION_BENCHMARK_POLICY,
	verifyEvolutionBenchmarkReport,
} from "../extensions/optional/evolution/benchmark-comparison.ts";
import {
	parseBenchmarkSnapshot,
	validateBenchmarkPair,
} from "../extensions/optional/evolution/benchmark-evidence.ts";
import type {
	EvolutionBenchmarkRunV1,
	EvolutionBenchmarkSnapshotV1,
} from "../extensions/optional/evolution/benchmark-types.ts";
import { runEvolutionBenchmarkCli } from "../scripts/evolution-benchmark.ts";

const CANDIDATE_ID = "candidate-evidence-a";
const CANDIDATE_CONTENT_HASH = `sha256:${"c".repeat(64)}`;

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function rehashReport<T extends { contentHash: string }>(report: T): T {
	const { contentHash: _contentHash, ...content } = report;
	return { ...report, contentHash: `sha256:${createHash("sha256").update(canonical(content)).digest("hex")}` };
}

function runs(role: "baseline" | "candidate", taskCount = 40): EvolutionBenchmarkRunV1[] {
	const values: EvolutionBenchmarkRunV1[] = [];
	for (let task = 0; task < taskCount; task += 1) {
		for (let repetition = 1; repetition <= 3; repetition += 1) {
			const success = role === "baseline" ? task < 20 : task < 30;
			values.push({
				taskId: `task-${String(task).padStart(3, "0")}`,
				repetition,
				split: "heldout",
				slices: [task % 2 === 0 ? "coding" : "tool-use"],
				success,
				score: success ? 1 : 0,
				costUsd: 1,
				latencyMs: role === "baseline" ? 1_000 : 1_050,
				policyViolations: 0,
				replayDivergences: 0,
				unpairedToolCalls: 0,
			});
		}
	}
	return values;
}

function snapshot(role: "baseline" | "candidate", runValues = runs(role)): EvolutionBenchmarkSnapshotV1 {
	return {
		schemaVersion: 1,
		kind: "catui-evolution-benchmark-snapshot",
		role,
		...(role === "candidate" ? { candidateId: CANDIDATE_ID } : {}),
		...(role === "candidate" ? { candidateContentHash: CANDIDATE_CONTENT_HASH } : {}),
		createdAt: "2026-08-25T00:00:00.000Z",
		corpus: {
			id: "pawbench",
			version: "1.0",
			digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
		harness: {
			revisionId: role === "baseline" ? "champion-1" : "candidate-1",
			commitSha: role === "baseline" ? "a".repeat(40) : "b".repeat(40),
		},
		execution: {
			model: "dashscope/qwen3.6-plus",
			modelVersion: "2026-08-24",
			temperature: 0,
			maxTokens: 32_768,
			timeoutMs: 1_200_000,
			budgetUsd: 600,
		},
		runs: runValues,
	};
}

function withCandidateRuns(
	mutate: (run: EvolutionBenchmarkRunV1, index: number) => EvolutionBenchmarkRunV1,
): EvolutionBenchmarkSnapshotV1 {
	return snapshot("candidate", runs("candidate").map(mutate));
}

test("parses a complete versioned benchmark snapshot", () => {
	assert.deepEqual(parseBenchmarkSnapshot(snapshot("baseline")), snapshot("baseline"));
});

test("rejects unsupported schemas and out-of-range run metrics", () => {
	const unsupported = { ...snapshot("baseline"), schemaVersion: 2 };
	assert.throws(() => parseBenchmarkSnapshot(unsupported), /schema version/i);
	const invalidScore = snapshot("baseline");
	invalidScore.runs[0]!.score = 1.1;
	assert.throws(() => parseBenchmarkSnapshot(invalidScore), /score.*0.*1/i);
});

test("rejects candidate snapshots that change the frozen model", () => {
	const baseline = snapshot("baseline");
	const candidate = snapshot("candidate");
	candidate.execution.model = "another-model";
	assert.throws(
		() => validateBenchmarkPair(baseline, candidate, CANDIDATE_ID, DEFAULT_EVOLUTION_BENCHMARK_POLICY),
		/execution envelope/i,
	);
});

test("rejects candidate snapshots that change the corpus digest", () => {
	const baseline = snapshot("baseline");
	const candidate = snapshot("candidate");
	candidate.corpus.digest = "sha256:" + "c".repeat(64);
	assert.throws(
		() => validateBenchmarkPair(baseline, candidate, CANDIDATE_ID, DEFAULT_EVOLUTION_BENCHMARK_POLICY),
		/corpus/i,
	);
});

test("rejects duplicate held-out task repetitions", () => {
	const duplicated = runs("candidate");
	duplicated.push({ ...duplicated[0]! });
	assert.throws(
		() => validateBenchmarkPair(snapshot("baseline"), snapshot("candidate", duplicated), CANDIDATE_ID, DEFAULT_EVOLUTION_BENCHMARK_POLICY),
		/duplicate/i,
	);
});

test("rejects held-out tasks with fewer than three paired repetitions", () => {
	const candidateRuns = runs("candidate").filter((run) => !(run.taskId === "task-039" && run.repetition === 3));
	assert.throws(
		() => validateBenchmarkPair(snapshot("baseline"), snapshot("candidate", candidateRuns), CANDIDATE_ID, DEFAULT_EVOLUTION_BENCHMARK_POLICY),
		/paired|repetition/i,
	);
});

test("accepts a statistically clear held-out improvement and binds it to the candidate", () => {
	const report = compareEvolutionBenchmarks(
		snapshot("baseline"),
		snapshot("candidate"),
		DEFAULT_EVOLUTION_BENCHMARK_POLICY,
		{ candidateId: CANDIDATE_ID, checkedAt: "2026-08-25T01:00:00.000Z" },
	);
	assert.equal(report.passed, true);
	assert.equal(report.metrics.baselinePassRate, 0.5);
	assert.equal(report.metrics.candidatePassRate, 0.75);
	assert.equal(report.metrics.passRateGain, 0.25);
	assert.ok(report.metrics.confidenceLowerBound > 0);
	assert.equal(verifyEvolutionBenchmarkReport(report, CANDIDATE_ID, CANDIDATE_CONTENT_HASH), true);
	assert.deepEqual(
		report,
		compareEvolutionBenchmarks(
			snapshot("baseline"),
			snapshot("candidate"),
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{ candidateId: CANDIDATE_ID, checkedAt: "2026-08-25T01:00:00.000Z" },
		),
	);
});

test("fails promotion when absolute pass-rate gain is below five points", () => {
	const candidateRuns = runs("baseline").map((run) => ({
		...run,
		success: run.taskId === "task-020" ? true : run.success,
		score: run.taskId === "task-020" ? 1 : run.score,
	}));
	const report = compareEvolutionBenchmarks(snapshot("baseline"), snapshot("candidate", candidateRuns), DEFAULT_EVOLUTION_BENCHMARK_POLICY, {
		candidateId: CANDIDATE_ID,
		checkedAt: "2026-08-25T01:00:00.000Z",
	});
	assert.equal(report.passed, false);
	assert.equal(report.checks.find((check) => check.id === "minimum_pass_rate_gain")?.passed, false);
});

test("fails promotion when a five-point gain has a non-positive confidence lower bound", () => {
	const candidateRuns = runs("baseline").map((run) => {
		const improved = run.taskId === "task-020" || run.taskId === "task-021";
		return improved ? { ...run, success: true, score: 1 } : run;
	});
	const report = compareEvolutionBenchmarks(snapshot("baseline"), snapshot("candidate", candidateRuns), DEFAULT_EVOLUTION_BENCHMARK_POLICY, {
		candidateId: CANDIDATE_ID,
		checkedAt: "2026-08-25T01:00:00.000Z",
	});
	assert.equal(report.checks.find((check) => check.id === "minimum_pass_rate_gain")?.passed, true);
	assert.equal(report.checks.find((check) => check.id === "positive_confidence_lower_bound")?.passed, false);
});

test("fails promotion when a diagnostic slice regresses", () => {
	const candidate = withCandidateRuns((run) => {
		if (run.slices.includes("coding") && Number(run.taskId.slice(-3)) < 20) return { ...run, success: false, score: 0 };
		return run;
	});
	const report = compareEvolutionBenchmarks(snapshot("baseline"), candidate, DEFAULT_EVOLUTION_BENCHMARK_POLICY, {
		candidateId: CANDIDATE_ID,
		checkedAt: "2026-08-25T01:00:00.000Z",
	});
	assert.equal(report.passed, false);
	assert.equal(report.checks.find((check) => check.id === "maximum_slice_regression")?.passed, false);
});

test("fails promotion on any policy, replay, or tool-pair violation", () => {
	const candidate = withCandidateRuns((run, index) => index === 0
		? { ...run, policyViolations: 1, replayDivergences: 1, unpairedToolCalls: 1 }
		: run);
	const report = compareEvolutionBenchmarks(snapshot("baseline"), candidate, DEFAULT_EVOLUTION_BENCHMARK_POLICY, {
		candidateId: CANDIDATE_ID,
		checkedAt: "2026-08-25T01:00:00.000Z",
	});
	assert.equal(report.passed, false);
	assert.equal(report.checks.find((check) => check.id === "zero_policy_violations")?.passed, false);
	assert.equal(report.checks.find((check) => check.id === "zero_replay_divergences")?.passed, false);
	assert.equal(report.checks.find((check) => check.id === "zero_unpaired_tool_calls")?.passed, false);
});

test("fails promotion when cost per success exceeds the budget", () => {
	const candidate = withCandidateRuns((run) => ({ ...run, costUsd: 3 }));
	const report = compareEvolutionBenchmarks(snapshot("baseline"), candidate, DEFAULT_EVOLUTION_BENCHMARK_POLICY, {
		candidateId: CANDIDATE_ID,
		checkedAt: "2026-08-25T01:00:00.000Z",
	});
	assert.equal(report.checks.find((check) => check.id === "maximum_cost_per_success_regression")?.passed, false);
});

test("fails promotion when P95 latency exceeds the budget", () => {
	const candidate = withCandidateRuns((run) => ({ ...run, latencyMs: 1_300 }));
	const report = compareEvolutionBenchmarks(snapshot("baseline"), candidate, DEFAULT_EVOLUTION_BENCHMARK_POLICY, {
		candidateId: CANDIDATE_ID,
		checkedAt: "2026-08-25T01:00:00.000Z",
	});
	assert.equal(report.checks.find((check) => check.id === "maximum_p95_latency_regression")?.passed, false);
});

test("detects promotion report tampering", () => {
	const report = compareEvolutionBenchmarks(
		snapshot("baseline"),
		snapshot("candidate"),
		DEFAULT_EVOLUTION_BENCHMARK_POLICY,
		{ candidateId: CANDIDATE_ID, checkedAt: "2026-08-25T01:00:00.000Z" },
	);
	report.metrics.candidatePassRate = 1;
	assert.equal(verifyEvolutionBenchmarkReport(report, CANDIDATE_ID, CANDIDATE_CONTENT_HASH), false);
});

test("rejects structurally incomplete and content-mismatched promotion reports", () => {
	const report = compareEvolutionBenchmarks(
		snapshot("baseline"),
		snapshot("candidate"),
		DEFAULT_EVOLUTION_BENCHMARK_POLICY,
		{ candidateId: CANDIDATE_ID, checkedAt: "2026-08-25T01:00:00.000Z" },
	);
	assert.equal(verifyEvolutionBenchmarkReport(report, CANDIDATE_ID, `sha256:${"d".repeat(64)}`), false);
	const incomplete = rehashReport({ ...report, checks: [], passed: true });
	assert.equal(verifyEvolutionBenchmarkReport(incomplete, CANDIDATE_ID, CANDIDATE_CONTENT_HASH), false);
});

test("CLI writes a private passing report and prints only a compact verdict", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "catui-evolution-benchmark-"));
	t.after(async () => rm(directory, { recursive: true, force: true }));
	const baselinePath = join(directory, "baseline.json");
	const candidatePath = join(directory, "candidate.json");
	const outputPath = join(directory, "evidence", `${CANDIDATE_ID}.json`);
	await writeFile(baselinePath, JSON.stringify(snapshot("baseline")), "utf8");
	await writeFile(candidatePath, JSON.stringify(snapshot("candidate")), "utf8");
	const output: string[] = [];
	const errors: string[] = [];
	const exitCode = await runEvolutionBenchmarkCli(
		["--baseline", baselinePath, "--candidate", candidatePath, "--candidate-id", CANDIDATE_ID, "--output", outputPath],
		{
			stdout: (line) => output.push(line),
			stderr: (line) => errors.push(line),
			checkedAt: "2026-08-25T01:00:00.000Z",
		},
	);
	const report = JSON.parse(await readFile(outputPath, "utf8"));
	assert.equal(exitCode, 0);
	assert.equal(report.passed, true);
	assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
	assert.deepEqual(errors, []);
	assert.match(output.join("\n"), /PASS.*candidate-evidence-a/i);
	assert.doesNotMatch(output.join("\n"), /dashscope|task-000/i);
});

test("CLI persists failed evidence and returns a non-zero verdict", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "catui-evolution-benchmark-"));
	t.after(async () => rm(directory, { recursive: true, force: true }));
	const baselinePath = join(directory, "baseline.json");
	const candidatePath = join(directory, "candidate.json");
	const outputPath = join(directory, "evidence.json");
	const candidateRuns = runs("baseline").map((run) => ({ ...run }));
	await writeFile(baselinePath, JSON.stringify(snapshot("baseline")), "utf8");
	await writeFile(candidatePath, JSON.stringify(snapshot("candidate", candidateRuns)), "utf8");
	const output: string[] = [];
	const exitCode = await runEvolutionBenchmarkCli(
		["--baseline", baselinePath, "--candidate", candidatePath, "--candidate-id", CANDIDATE_ID, "--output", outputPath],
		{ stdout: (line) => output.push(line), stderr: () => undefined, checkedAt: "2026-08-25T01:00:00.000Z" },
	);
	const report = JSON.parse(await readFile(outputPath, "utf8"));
	assert.equal(exitCode, 1);
	assert.equal(report.passed, false);
	assert.match(output.join("\n"), /FAIL.*minimum_pass_rate_gain/i);
});

test("CLI rejects incomplete arguments without reading files", async () => {
	const errors: string[] = [];
	const exitCode = await runEvolutionBenchmarkCli([], {
		stdout: () => undefined,
		stderr: (line) => errors.push(line),
		checkedAt: "2026-08-25T01:00:00.000Z",
	});
	assert.equal(exitCode, 2);
	assert.match(errors.join("\n"), /--baseline.*--candidate.*--candidate-id.*--output/i);
});
