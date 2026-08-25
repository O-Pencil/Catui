/**
 * [WHO]: Byte-bound PawBench evolution snapshot import contract tests
 * [FROM]: Depends on node:test/assert, crypto, and the optional-evolution import, parser, and diagnosis contracts
 * [TO]: Verifies PawBench snapshot import and sanitized failure-cohort diagnosis without granting runtime execution authority
 * [HERE]: test/evolution-pawbench.test.ts - PawBench evidence and deterministic failure-cohort boundaries
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseBenchmarkSnapshot } from "../extensions/optional/evolution/benchmark-evidence.ts";
import {
	diagnoseEvolutionBenchmarkFailures,
	verifyEvolutionFailureCohortReport,
} from "../extensions/optional/evolution/benchmark-diagnosis.ts";
import { importPawBenchEvolutionSnapshot } from "../extensions/optional/evolution/pawbench-import.ts";

type PawBenchLabels = Partial<{
	scenario: string;
	capabilities: string[];
	complexity: string;
	modality: string | { type: string; channels: string[] };
	environment: string;
}>;

type PawBenchUsage = {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	estimated?: boolean;
};

type PawBenchResult = {
	task_id: string;
	task_name: string;
	score: number;
	max_score: number;
	passed: boolean;
	grading_type: string;
	breakdown: Record<string, number>;
	notes: string;
	execution_time: number;
	status: string;
	usage: PawBenchUsage;
	transcript_length: number;
	timed_out: boolean;
	error: string;
	anomaly: {
		has_error: boolean;
		reason?: string;
	};
	labels: PawBenchLabels;
};

type PawBenchCheckpoint = {
	benchmark: string;
	model: string;
	timestamp: string;
	summary: {
		total_runs: number;
		tasks_completed: number;
		passed: number;
		pass_rate: number;
		avg_score: number;
		runs_per_task: number;
		total_time: number;
		avg_execution_time: number;
		total_usage: PawBenchUsage;
		errors: {
			total: number;
			timed_out: number;
			failed: number;
		};
		by_label: Record<string, unknown>;
		"pass@2": number;
		"pass^2": number;
		"pass@2_count": number;
		"pass^2_count": number;
	};
	results: PawBenchResult[];
};

type TraceAudit = {
	policyViolations: number;
	replayDivergences: number;
	unpairedToolCalls: number;
};

type ManifestResultIndex = {
	repetition: number;
	split: "heldout";
	costUsd: number;
	traceAudit: TraceAudit;
	extraSlices?: string[];
};

type PawBenchManifest = {
	schemaVersion: 1;
	kind: "catui-pawbench-import-manifest";
	sourceSha256: string;
	role: "candidate";
	candidateId: string;
	candidateContentHash: string;
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
	resultIndex: Record<string, ManifestResultIndex>;
};

const checkpoint: PawBenchCheckpoint = {
	benchmark: "pawbench",
	model: "openai/gpt-5",
	timestamp: "2026-08-26T02:00:00.000Z",
	summary: {
		total_runs: 2,
		tasks_completed: 2,
		passed: 1,
		pass_rate: 0.5,
		avg_score: 0.55,
		runs_per_task: 1,
		total_time: 32.5,
		avg_execution_time: 16.25,
		total_usage: { prompt_tokens: 280, completion_tokens: 140, total_tokens: 420, estimated: true },
		errors: { total: 0, timed_out: 0, failed: 0 },
		by_label: {},
		"pass@2": 0.5,
		"pass^2": 0,
		"pass@2_count": 1,
		"pass^2_count": 0,
	},
	results: [
		{
			task_id: "task-001",
			task_name: "repair-config",
			score: 8,
			max_score: 10,
			passed: true,
			grading_type: "weighted",
			breakdown: { "grader.correctness": 1 },
			notes: "Completed with the frozen harness.",
			execution_time: 12.5,
			status: "success",
			usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200, estimated: false },
			transcript_length: 14,
			timed_out: false,
			error: "",
			anomaly: { has_error: false },
			labels: {
				scenario: "Coding",
				capabilities: ["Tool Use"],
				complexity: "Medium",
				modality: { type: "Text", channels: ["Terminal"] },
				environment: "Sandbox",
			},
		},
		{
			task_id: "task-002",
			task_name: "repair-tests",
			score: 3,
			max_score: 10,
			passed: false,
			grading_type: "weighted",
			breakdown: {
				"grader.correctness": 0.5,
				"failure detail": 0,
			},
			notes: "The grader reported a failing assertion.",
			execution_time: 20,
			status: "success",
			usage: {},
			transcript_length: 18,
			timed_out: false,
			error: "",
			anomaly: { has_error: false },
			labels: {},
		},
	],
};

function sourceText(value: PawBenchCheckpoint = checkpoint): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function manifestFor(source: string): PawBenchManifest {
	return {
		schemaVersion: 1,
		kind: "catui-pawbench-import-manifest",
		sourceSha256: sha256(source),
		role: "candidate",
		candidateId: "candidate-pawbench-a",
		candidateContentHash: `sha256:${"c".repeat(64)}`,
		createdAt: "2026-08-26T02:05:00.000Z",
		corpus: {
			id: "pawbench",
			version: "2026.08",
			digest: `sha256:${"a".repeat(64)}`,
		},
		harness: {
			revisionId: "pawbench-harness-r1",
			commitSha: "b".repeat(40),
		},
		execution: {
			model: "openai/gpt-5",
			modelVersion: "2026-08-25",
			temperature: 0,
			maxTokens: 32_768,
			timeoutMs: 1_200_000,
			budgetUsd: 10,
		},
		resultIndex: {
			"0": {
				repetition: 1,
				split: "heldout",
				costUsd: 0.12,
				traceAudit: { policyViolations: 0, replayDivergences: 0, unpairedToolCalls: 0 },
				extraSlices: ["Browser"],
			},
			"1": {
				repetition: 2,
				split: "heldout",
				costUsd: 0.14,
				traceAudit: { policyViolations: 1, replayDivergences: 0, unpairedToolCalls: 2 },
				extraSlices: ["Coding"],
			},
		},
	};
}

function importFixture(
	mutateCheckpoint: (value: PawBenchCheckpoint) => void = () => undefined,
	mutateManifest: (value: PawBenchManifest) => void = () => undefined,
): ReturnType<typeof importPawBenchEvolutionSnapshot> {
	const value = structuredClone(checkpoint);
	mutateCheckpoint(value);
	const source = sourceText(value);
	const manifest = manifestFor(source);
	mutateManifest(manifest);
	return importPawBenchEvolutionSnapshot(source, manifest);
}

test("imports an exact PawBench checkpoint into a parseable evidence snapshot", () => {
	const source = sourceText();
	const manifest = manifestFor(source);
	assert.equal(manifest.sourceSha256, sha256(source), "the manifest must attest the exact UTF-8 source bytes");

	const snapshot = importPawBenchEvolutionSnapshot(source, manifest);
	const parsed = parseBenchmarkSnapshot(snapshot);
	assert.equal(snapshot.role, "candidate");
	assert.equal(snapshot.candidateId, manifest.candidateId);
	assert.equal(snapshot.candidateContentHash, manifest.candidateContentHash);
	assert.deepEqual(snapshot.execution, manifest.execution);
	assert.deepEqual(snapshot.corpus, manifest.corpus);
	assert.deepEqual(snapshot.harness, manifest.harness);
	assert.equal(snapshot.runs.length, 2);

	assert.deepEqual(snapshot.runs[0], {
		taskId: "task-001",
		repetition: 1,
		split: "heldout",
		slices: ["browser", "coding", "medium", "sandbox", "terminal", "text", "tool-use"],
		success: true,
		score: 0.8,
		costUsd: 0.12,
		latencyMs: 12_500,
		policyViolations: 0,
		replayDivergences: 0,
		unpairedToolCalls: 0,
	});
	assert.deepEqual(snapshot.runs[1], {
		taskId: "task-002",
		repetition: 2,
		split: "heldout",
		slices: ["coding"],
		success: false,
		score: 0.3,
		costUsd: 0.14,
		latencyMs: 20_000,
		policyViolations: 1,
		replayDivergences: 0,
		unpairedToolCalls: 2,
		diagnostics: ["grader.correctness"],
	});
	assert.deepEqual(parsed.runs[1]!.diagnostics, ["grader.correctness"]);
});

test("adds bounded execution diagnostics only for non-success statuses and timeouts", () => {
	const snapshot = importFixture((value) => {
		value.results[1]!.status = "error";
		value.results[1]!.timed_out = true;
		value.results[1]!.error = "sensitive runner detail";
		value.summary.errors = { total: 1, timed_out: 1, failed: 1 };
	});
	assert.deepEqual(snapshot.runs[0]!.diagnostics, undefined);
	assert.deepEqual(snapshot.runs[1]!.diagnostics, ["grader.correctness", "status:error", "timeout"]);
	assert.doesNotMatch(JSON.stringify(snapshot), /sensitive runner detail|Completed with the frozen harness/);
});

test("rejects unsupported and contradictory PawBench result statuses", () => {
	assert.throws(
		() => importFixture((value) => {
			value.results[1]!.status = "completed";
		}),
		/status/i,
	);
	assert.throws(
		() => importFixture((value) => {
			value.results[1]!.status = "error";
			value.results[1]!.passed = true;
			value.summary.passed = 2;
			value.summary.pass_rate = 1;
			value.summary.errors = { total: 1, timed_out: 0, failed: 1 };
		}),
		/status|passed|success/i,
	);
	assert.throws(
		() => importFixture((value) => {
			value.results[1]!.timed_out = true;
		}),
		/status|timed_out|timeout/i,
	);
	assert.throws(
		() => importFixture((value) => {
			value.results[1]!.status = "timeout";
			value.results[1]!.timed_out = false;
		}),
		/status|timed_out|timeout/i,
	);
});

test("accepts sparse taxonomy labels without inventing missing evidence", () => {
	const snapshot = importFixture((value) => {
		value.results[0]!.labels = { scenario: "Code Review" };
	});
	assert.deepEqual(snapshot.runs[0]!.slices, ["browser", "code-review"]);
	assert.deepEqual(snapshot.runs[1]!.slices, ["coding"]);
});

test("rejects an empty taxonomy when the manifest supplies no additional slice", () => {
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			Reflect.deleteProperty(manifest.resultIndex["1"]!, "extraSlices");
		}),
		/slice|taxonomy|label/i,
	);
});

test("rejects malformed dynamic pass-k summary metrics", () => {
	assert.throws(
		() => importFixture((value) => {
			value.summary["pass@2"] = 1.5;
		}),
		/pass@2|summary/i,
	);
});

test("rejects a changed checkpoint source even when the manifest is otherwise complete", () => {
	const source = sourceText();
	const manifest = manifestFor(source);
	assert.throws(
		() => importPawBenchEvolutionSnapshot(`${source} `, manifest),
		/digest|bytes|source/i,
	);
});

test("rejects duplicate and missing exact result indexes", () => {
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			const replacement = manifest.resultIndex["0"]!;
			Reflect.deleteProperty(manifest.resultIndex, "0");
			manifest.resultIndex["00"] = replacement;
		}),
		/duplicate|index/i,
	);
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			const replacement = manifest.resultIndex["1"]!;
			Reflect.deleteProperty(manifest.resultIndex, "1");
			manifest.resultIndex["2"] = replacement;
		}),
		/index|result/i,
	);
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			Reflect.deleteProperty(manifest.resultIndex, "1");
		}),
		/missing|index|result/i,
	);
});

test("rejects inherited and accessor-based manifest evidence", () => {
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			const entry = manifest.resultIndex["1"]!;
			Reflect.deleteProperty(entry, "costUsd");
			Object.setPrototypeOf(entry, { costUsd: 0.14 });
		}),
		/plain|prototype|cost|own/i,
	);
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			const audit = manifest.resultIndex["1"]!.traceAudit;
			Reflect.deleteProperty(audit, "replayDivergences");
			Object.setPrototypeOf(audit, { replayDivergences: 0 });
		}),
		/plain|prototype|audit|replayDivergences|own/i,
	);
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			Object.setPrototypeOf(manifest.resultIndex, { inherited: true });
		}),
		/plain|prototype|index/i,
	);
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			Object.defineProperty(manifest.resultIndex["1"]!, "costUsd", {
				enumerable: true,
				get: () => 0.14,
			});
		}),
		/data property|accessor|cost|own/i,
	);
});

test("accepts a null-prototype exact result index", () => {
	const snapshot = importFixture(undefined, (manifest) => {
		Object.setPrototypeOf(manifest.resultIndex, null);
	});
	assert.equal(snapshot.runs.length, 2);
});

test("rejects a manifest whose frozen model differs from PawBench output", () => {
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			manifest.execution.model = "another-provider/another-model";
		}),
		/model/i,
	);
});

test("rejects runs outside the frozen timeout and total cost budget", () => {
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			manifest.execution.timeoutMs = 10_000;
		}),
		/latency|timeout/i,
	);
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			manifest.execution.budgetUsd = 0.25;
		}),
		/budget|cost/i,
	);
});

test("accepts a 10,000-run compensated cost sum exactly equal to budget", () => {
	const runCount = 10_000;
	const value = structuredClone(checkpoint);
	const results: PawBenchResult[] = [];
	for (let index = 0; index < runCount; index += 1) {
		results.push({
			task_id: `bulk-${index}`,
			task_name: "bulk-budget-check",
			score: 1,
			max_score: 1,
			passed: true,
			grading_type: "weighted",
			breakdown: {},
			notes: "",
			execution_time: 0,
			status: "success",
			usage: {},
			transcript_length: 0,
			timed_out: false,
			error: "",
			anomaly: { has_error: false },
			labels: {},
		});
	}
	value.results = results;
	value.summary = {
		total_runs: runCount,
		tasks_completed: runCount,
		passed: runCount,
		pass_rate: 1,
		avg_score: 1,
		runs_per_task: 1,
		total_time: 0,
		avg_execution_time: 0,
		total_usage: {},
		errors: { total: 0, timed_out: 0, failed: 0 },
		by_label: {},
		"pass@2": 1,
		"pass^2": 1,
		"pass@2_count": runCount,
		"pass^2_count": runCount,
	};
	const source = sourceText(value);
	const manifest = manifestFor(source);
	manifest.execution.budgetUsd = 3;
	const resultIndex: PawBenchManifest["resultIndex"] = {};
	for (let index = 0; index < runCount; index += 1) {
		resultIndex[String(index)] = {
			repetition: index + 1,
			split: "heldout",
			costUsd: 0.0003,
			traceAudit: { policyViolations: 0, replayDivergences: 0, unpairedToolCalls: 0 },
			extraSlices: ["bulk"],
		};
	}
	manifest.resultIndex = resultIndex;

	const snapshot = importPawBenchEvolutionSnapshot(source, manifest);
	assert.equal(snapshot.runs.length, runCount);
});

test("rejects PawBench anomaly evidence instead of treating it as a benchmark failure", () => {
	assert.throws(
		() => importFixture((value) => {
			value.results[1]!.anomaly = { has_error: true, reason: "runner crashed" };
		}),
		/anomaly|has_error|error/i,
	);
});

test("rejects a result index without explicit cost evidence", () => {
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			Reflect.deleteProperty(manifest.resultIndex["1"]!, "costUsd");
		}),
		/cost/i,
	);
});

test("rejects a result index without explicit trace-audit counters", () => {
	assert.throws(
		() => importFixture(undefined, (manifest) => {
			Reflect.deleteProperty(manifest.resultIndex["1"]!.traceAudit, "replayDivergences");
		}),
		/audit|replayDivergences|counter/i,
	);
});

function ordinalCompare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => ordinalCompare(left, right));
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function canonicalHash(value: unknown): string {
	return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

function rehashFailureReport<T extends { contentHash: string }>(report: T): T {
	const { contentHash: _contentHash, ...content } = report;
	return { ...report, contentHash: canonicalHash(content) };
}

function normalizedSnapshotForHash(snapshot: ReturnType<typeof importPawBenchEvolutionSnapshot>) {
	const parsed = parseBenchmarkSnapshot(snapshot);
	return {
		...parsed,
		runs: [...parsed.runs].sort((left, right) => {
			const leftKey = `${left.split}\u0000${left.taskId}\u0000${left.repetition}`;
			const rightKey = `${right.split}\u0000${right.taskId}\u0000${right.repetition}`;
			return ordinalCompare(leftKey, rightKey);
		}),
	};
}

function diagnosisSignalFixture(): ReturnType<typeof importPawBenchEvolutionSnapshot> {
	const snapshot = importFixture();
	const failedRun = snapshot.runs[1]!;
	const run = (taskId: string, overrides: Partial<typeof failedRun> = {}): typeof failedRun => ({
		...failedRun,
		taskId,
		repetition: 1,
		success: false,
		diagnostics: undefined,
		policyViolations: 0,
		replayDivergences: 0,
		unpairedToolCalls: 0,
		...overrides,
	});
	snapshot.runs = [
		{
			...run("task-success", {
				success: true,
				diagnostics: ["ignored-success-signal"],
				policyViolations: 9,
				replayDivergences: 9,
				unpairedToolCalls: 9,
			}),
		},
		run("task-diagnostic", { diagnostics: ["diagnostic-sentinel"] }),
		run("task-diagnostic", { repetition: 2, diagnostics: ["diagnostic-sentinel"] }),
		run("task-error", { diagnostics: ["status:error"] }),
		run("task-timeout", { diagnostics: ["timeout"] }),
		run("task-policy", { policyViolations: 1 }),
		run("task-replay", { replayDivergences: 1 }),
		run("task-unpaired", { unpairedToolCalls: 1 }),
	];
	return snapshot;
}

function assertExactReportShape(report: ReturnType<typeof diagnoseEvolutionBenchmarkFailures>): void {
	assert.deepEqual(Object.keys(report).sort(), [
		"contentHash",
		"cohorts",
		"generatedAt",
		"kind",
		"schemaVersion",
		"snapshotHash",
	].sort());
	for (const cohort of report.cohorts) {
		assert.deepEqual(Object.keys(cohort).sort(), [
			"id",
			"runCount",
			"signal",
			"taskCount",
			"taskIds",
			"taskIdsTruncated",
		].sort());
	}
}

test("extracts each independent signal only from failed runs", () => {
	const snapshot = diagnosisSignalFixture();
	const report = diagnoseEvolutionBenchmarkFailures(snapshot, {
		generatedAt: "2026-08-26T03:00:00.000Z",
	});

	assert.deepEqual(report.cohorts, [
		{
			id: "diagnostic:diagnostic-sentinel",
			signal: "diagnostic:diagnostic-sentinel",
			runCount: 2,
			taskCount: 1,
			taskIds: ["task-diagnostic"],
			taskIdsTruncated: false,
		},
		{
			id: "diagnostic:status:error",
			signal: "diagnostic:status:error",
			runCount: 1,
			taskCount: 1,
			taskIds: ["task-error"],
			taskIdsTruncated: false,
		},
		{
			id: "diagnostic:timeout",
			signal: "diagnostic:timeout",
			runCount: 1,
			taskCount: 1,
			taskIds: ["task-timeout"],
			taskIdsTruncated: false,
		},
		{
			id: "policy-violation",
			signal: "policy-violation",
			runCount: 1,
			taskCount: 1,
			taskIds: ["task-policy"],
			taskIdsTruncated: false,
		},
		{
			id: "replay-divergence",
			signal: "replay-divergence",
			runCount: 1,
			taskCount: 1,
			taskIds: ["task-replay"],
			taskIdsTruncated: false,
		},
		{
			id: "unpaired-tool-call",
			signal: "unpaired-tool-call",
			runCount: 1,
			taskCount: 1,
			taskIds: ["task-unpaired"],
			taskIdsTruncated: false,
		},
	]);
	assertExactReportShape(report);
	for (const cohort of report.cohorts) {
		assert.deepEqual(cohort.taskIds, [...new Set(cohort.taskIds)].sort());
		assert.equal(cohort.taskCount, cohort.taskIds.length);
		assert.equal(cohort.taskIdsTruncated, false);
	}
	assert.equal(report.schemaVersion, 1);
	assert.equal(report.kind, "catui-evolution-failure-cohort-report");
	assert.equal(report.generatedAt, "2026-08-26T03:00:00.000Z");
	assert.equal(report.snapshotHash, canonicalHash(normalizedSnapshotForHash(snapshot)));
	assert.equal(report.contentHash, canonicalHash({
		schemaVersion: report.schemaVersion,
		kind: report.kind,
		generatedAt: report.generatedAt,
		snapshotHash: report.snapshotHash,
		cohorts: report.cohorts,
	}));
	assert.doesNotMatch(JSON.stringify(report), /"(?:notes|error|transcript|prompt|artifact)"/);
});

test("strips unknown raw values through snapshot parsing before diagnosis", () => {
	const cleanSnapshot = diagnosisSignalFixture();
	const options = { generatedAt: "2026-08-26T03:00:00.000Z" };
	const cleanReport = diagnoseEvolutionBenchmarkFailures(cleanSnapshot, options);
	const taintedSnapshot = {
		...cleanSnapshot,
		rawNotes: "raw-notes-sentinel",
		rawError: "raw-error-sentinel",
		runs: cleanSnapshot.runs.map((run) => ({
			...run,
			rawNotes: "run-raw-notes-sentinel",
			rawError: "run-raw-error-sentinel",
		})),
	};

	const taintedReport = diagnoseEvolutionBenchmarkFailures(taintedSnapshot, options);
	assert.deepEqual(taintedReport, cleanReport);
	assert.doesNotMatch(JSON.stringify(taintedReport), /raw-(?:notes|error)-sentinel/);
});

test("attributes every independent signal from one failed run", () => {
	const snapshot = importFixture();
	snapshot.runs = [
		{
			...snapshot.runs[0]!,
			taskId: "task-success-control",
			success: true,
			diagnostics: ["ignored-success-signal"],
			policyViolations: 9,
			replayDivergences: 9,
			unpairedToolCalls: 9,
		},
		{
			...snapshot.runs[1]!,
			taskId: "task-multi-signal",
			repetition: 1,
			diagnostics: ["diagnostic-alpha", "diagnostic-beta"],
			policyViolations: 2,
			replayDivergences: 3,
			unpairedToolCalls: 4,
		},
	];
	const report = diagnoseEvolutionBenchmarkFailures(snapshot, {
		generatedAt: "2026-08-26T03:00:00.000Z",
	});

	for (const signal of [
		"diagnostic:diagnostic-alpha",
		"diagnostic:diagnostic-beta",
		"policy-violation",
		"replay-divergence",
		"unpaired-tool-call",
	]) {
		const cohort = report.cohorts.find((item) => item.signal === signal);
		assert.deepEqual(cohort, {
			id: signal,
			signal,
			runCount: 1,
			taskCount: 1,
			taskIds: ["task-multi-signal"],
			taskIdsTruncated: false,
		});
	}
});

test("failure cohort IDs and hashes are stable across run order", () => {
	const snapshot = diagnosisSignalFixture();
	const report = diagnoseEvolutionBenchmarkFailures(snapshot, {
		generatedAt: "2026-08-26T03:00:00.000Z",
	});
	const reorderedSnapshot = { ...snapshot, runs: [...snapshot.runs].reverse() };
	const reorderedReport = diagnoseEvolutionBenchmarkFailures(reorderedSnapshot, {
		generatedAt: "2026-08-26T03:00:00.000Z",
	});

	assert.deepEqual(reorderedReport, report);
});

test("uses locale-independent ordinal ordering for case-sensitive ASCII IDs and hashes", () => {
	const snapshot = diagnosisSignalFixture();
	const failedRun = snapshot.runs[1]!;
	snapshot.runs = [
		{
			...failedRun,
			taskId: "i-task",
			repetition: 1,
			diagnostics: ["i-signal", "shared"],
		},
		{
			...failedRun,
			taskId: "I-task",
			repetition: 1,
			diagnostics: ["I-signal", "shared"],
		},
	];
	const report = diagnoseEvolutionBenchmarkFailures(snapshot, {
		generatedAt: "2026-08-26T03:00:00.000Z",
	});

	assert.deepEqual(report.cohorts.map((cohort) => cohort.signal), [
		"diagnostic:I-signal",
		"diagnostic:i-signal",
		"diagnostic:shared",
	]);
	assert.deepEqual(report.cohorts[2]!.taskIds, ["I-task", "i-task"]);
	assert.equal(report.snapshotHash, canonicalHash(normalizedSnapshotForHash(snapshot)));
	assert.equal(report.contentHash, canonicalHash({
		schemaVersion: report.schemaVersion,
		kind: report.kind,
		generatedAt: report.generatedAt,
		snapshotHash: report.snapshotHash,
		cohorts: report.cohorts,
	}));
});

test("bounds each cohort to 100 sorted task IDs while preserving counts", () => {
	const snapshot = diagnosisSignalFixture();
	const diagnosticRun = snapshot.runs[1]!;
	for (let index = 0; index < 105; index += 1) {
		snapshot.runs.push({
			...diagnosticRun,
			taskId: `task-bulk-${String(105 - index).padStart(3, "0")}`,
			repetition: index + 10,
		});
	}
	const report = diagnoseEvolutionBenchmarkFailures(snapshot, {
		generatedAt: "2026-08-26T03:00:00.000Z",
	});
	const cohort = report.cohorts.find((item) => item.signal === "diagnostic:diagnostic-sentinel");
	assert.ok(cohort);
	const expectedTaskIds = ["task-diagnostic", ...Array.from({ length: 105 }, (_, index) => `task-bulk-${String(index + 1).padStart(3, "0")}`)].sort();
	assert.equal(cohort.runCount, 107);
	assert.equal(cohort.taskCount, expectedTaskIds.length);
	assert.deepEqual(cohort.taskIds, expectedTaskIds.slice(0, 100));
	assert.equal(cohort.taskIdsTruncated, true);
	assert.equal(new Set(cohort.taskIds).size, cohort.taskIds.length);
});

test("binds a canonical snapshot and detects any cohort-report tampering", () => {
	const report = diagnoseEvolutionBenchmarkFailures(diagnosisSignalFixture(), {
		generatedAt: "2026-08-26T03:00:00.000Z",
	});
	assert.equal(verifyEvolutionFailureCohortReport(report), true);

	const tampered = structuredClone(report);
	tampered.cohorts[0]!.taskIds = ["task-001"];
	assert.equal(verifyEvolutionFailureCohortReport(tampered), false);

	const tamperedGeneratedAt = { ...report, generatedAt: "2026-08-26T03:01:00.000Z" };
	assert.equal(verifyEvolutionFailureCohortReport(tamperedGeneratedAt), false);

	const tamperedHash = { ...report, snapshotHash: `sha256:${"0".repeat(64)}` };
	assert.equal(verifyEvolutionFailureCohortReport(tamperedHash), false);
});

test("rejects duplicate benchmark run identities before cohorting", () => {
	const snapshot = diagnosisSignalFixture();
	snapshot.runs.push({
		...snapshot.runs[0]!,
		success: false,
		diagnostics: ["duplicate-identity"],
	});
	assert.throws(
		() => diagnoseEvolutionBenchmarkFailures(snapshot, {
			generatedAt: "2026-08-26T03:00:00.000Z",
		}),
		/duplicate|task repetition|identity/i,
	);
});

test("rejects an invalid snapshot through the existing benchmark parser", () => {
	assert.throws(
		() => diagnoseEvolutionBenchmarkFailures({ ...diagnosisSignalFixture(), runs: [] }, {
			generatedAt: "2026-08-26T03:00:00.000Z",
		}),
		/Benchmark snapshot runs must be non-empty/,
	);
	assert.throws(
		() => diagnoseEvolutionBenchmarkFailures({ not: "a snapshot" }, {
			generatedAt: "2026-08-26T03:00:00.000Z",
		}),
		/Unsupported benchmark snapshot schema version/,
	);
});

test("bounds diagnosis runs and distinct failure cohorts", () => {
	const tooManyRuns = diagnosisSignalFixture();
	const run = tooManyRuns.runs[0]!;
	tooManyRuns.runs = Array.from({ length: 10_001 }, (_, index) => ({
		...run,
		taskId: `bounded-run-${index}`,
		repetition: 1,
	}));
	assert.throws(
		() => diagnoseEvolutionBenchmarkFailures(tooManyRuns, { generatedAt: "2026-08-26T03:00:00.000Z" }),
		/runs|10.?000|maximum|limit/i,
	);

	const tooManyCohorts = diagnosisSignalFixture();
	const failedRun = tooManyCohorts.runs[1]!;
	tooManyCohorts.runs = Array.from({ length: 129 }, (_, runIndex) => ({
		...failedRun,
		taskId: `cohort-run-${runIndex}`,
		repetition: 1,
		diagnostics: Array.from({ length: 32 }, (_, signalIndex) => `signal-${runIndex}-${signalIndex}`),
	}));
	assert.throws(
		() => diagnoseEvolutionBenchmarkFailures(tooManyCohorts, { generatedAt: "2026-08-26T03:00:00.000Z" }),
		/cohort|signal|4.?096|maximum|limit/i,
	);
});

test("requires canonical millisecond RFC3339 UTC diagnosis timestamps", () => {
	assert.throws(
		() => diagnoseEvolutionBenchmarkFailures(diagnosisSignalFixture(), { generatedAt: "0" }),
		/generatedAt|timestamp|RFC3339|UTC/i,
	);
	const report = diagnoseEvolutionBenchmarkFailures(diagnosisSignalFixture(), {
		generatedAt: "2026-08-26T03:00:00.000Z",
	});
	assert.equal(verifyEvolutionFailureCohortReport(rehashFailureReport({ ...report, generatedAt: "0" })), false);
});

test("rejects adversarial failure report objects without invoking getters", () => {
	const report = diagnoseEvolutionBenchmarkFailures(diagnosisSignalFixture(), {
		generatedAt: "2026-08-26T03:00:00.000Z",
	});
	assert.equal(verifyEvolutionFailureCohortReport(rehashFailureReport({ ...report, unknown: true })), false);

	const customPrototype = structuredClone(report);
	Object.setPrototypeOf(customPrototype, { inherited: true });
	assert.equal(verifyEvolutionFailureCohortReport(customPrototype), false);

	let getterCalls = 0;
	const accessor = structuredClone(report);
	Object.defineProperty(accessor.cohorts[0]!, "signal", {
		enumerable: true,
		get: () => {
			getterCalls += 1;
			return accessor.cohorts[0]!.id;
		},
	});
	assert.equal(verifyEvolutionFailureCohortReport(accessor), false);
	assert.equal(getterCalls, 0);

	const sparseCohorts = structuredClone(report);
	sparseCohorts.cohorts = new Array(1);
	assert.equal(verifyEvolutionFailureCohortReport(sparseCohorts), false);

	const sparseTaskIds = structuredClone(report);
	sparseTaskIds.cohorts[0]!.taskIds = new Array(1);
	assert.equal(verifyEvolutionFailureCohortReport(sparseTaskIds), false);

	const decoratedTaskIds = structuredClone(report);
	(decoratedTaskIds.cohorts[0]!.taskIds as string[] & { extra?: string }).extra = "raw";
	assert.equal(verifyEvolutionFailureCohortReport(decoratedTaskIds), false);
});

test("rejects failure report ordering, duplicate, count, truncation, and array-bound violations", () => {
	const report = diagnoseEvolutionBenchmarkFailures(diagnosisSignalFixture(), {
		generatedAt: "2026-08-26T03:00:00.000Z",
	});

	const cohortOrder = structuredClone(report);
	cohortOrder.cohorts.reverse();
	assert.equal(verifyEvolutionFailureCohortReport(rehashFailureReport(cohortOrder)), false);

	const duplicateCohort = structuredClone(report);
	duplicateCohort.cohorts.splice(1, 0, structuredClone(duplicateCohort.cohorts[0]!));
	assert.equal(verifyEvolutionFailureCohortReport(rehashFailureReport(duplicateCohort)), false);

	const taskOrder = structuredClone(report);
	taskOrder.cohorts[0]!.taskIds = ["z-task", "a-task"];
	taskOrder.cohorts[0]!.taskCount = 2;
	taskOrder.cohorts[0]!.runCount = 2;
	assert.equal(verifyEvolutionFailureCohortReport(rehashFailureReport(taskOrder)), false);

	const duplicateTask = structuredClone(report);
	duplicateTask.cohorts[0]!.taskIds = ["same-task", "same-task"];
	duplicateTask.cohorts[0]!.taskCount = 2;
	duplicateTask.cohorts[0]!.runCount = 2;
	assert.equal(verifyEvolutionFailureCohortReport(rehashFailureReport(duplicateTask)), false);

	for (const mutation of [
		(cohort: typeof report.cohorts[number]) => { cohort.taskCount = cohort.runCount + 1; },
		(cohort: typeof report.cohorts[number]) => { cohort.taskCount = 101; cohort.runCount = 101; cohort.taskIdsTruncated = false; },
		(cohort: typeof report.cohorts[number]) => { cohort.taskCount = 1; cohort.taskIdsTruncated = true; },
	]) {
		const inconsistent = structuredClone(report);
		mutation(inconsistent.cohorts[0]!);
		assert.equal(verifyEvolutionFailureCohortReport(rehashFailureReport(inconsistent)), false);
	}

	const excessiveCohorts = structuredClone(report);
	excessiveCohorts.cohorts = [];
	excessiveCohorts.cohorts.length = 4_097;
	assert.equal(verifyEvolutionFailureCohortReport(excessiveCohorts), false);

	const excessiveTaskIds = structuredClone(report);
	excessiveTaskIds.cohorts[0]!.taskIds = Array.from({ length: 101 }, (_, index) => `task-${index}`);
	assert.equal(verifyEvolutionFailureCohortReport(excessiveTaskIds), false);

	const hugeSparseCohorts = structuredClone(report);
	hugeSparseCohorts.cohorts = [];
	hugeSparseCohorts.cohorts.length = 1_000_000_000;
	assert.equal(verifyEvolutionFailureCohortReport(hugeSparseCohorts), false);

	const hugeSparseTaskIds = structuredClone(report);
	hugeSparseTaskIds.cohorts[0]!.taskIds = [];
	hugeSparseTaskIds.cohorts[0]!.taskIds.length = 1_000_000_000;
	assert.equal(verifyEvolutionFailureCohortReport(hugeSparseTaskIds), false);
});
