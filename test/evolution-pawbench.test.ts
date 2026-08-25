/**
 * [WHO]: Byte-bound PawBench evolution snapshot import contract tests
 * [FROM]: Depends on node:test/assert, crypto, and the optional-evolution importer and benchmark parser
 * [TO]: Verifies extensions/optional/evolution/pawbench-import.ts without granting runtime execution authority
 * [HERE]: test/evolution-pawbench.test.ts - held-out PawBench checkpoint and attestation-manifest boundary
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseBenchmarkSnapshot } from "../extensions/optional/evolution/benchmark-evidence.ts";
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
