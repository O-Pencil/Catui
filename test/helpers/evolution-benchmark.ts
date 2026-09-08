/**
 * [WHO]: Test-only builders for integrity-valid evolution benchmark evidence
 * [FROM]: Depends on the production comparator and benchmark contracts
 * [TO]: Keeps unrelated evolution regression tests explicit about the new promotion prerequisite
 * [HERE]: test/helpers/evolution-benchmark.ts - compact evidence fixtures
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	compareEvolutionBenchmarks,
	DEFAULT_EVOLUTION_BENCHMARK_POLICY,
} from "../../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionGateReport } from "../../extensions/optional/evolution/evolution-types.js";

function runs(role: "baseline" | "candidate"): EvolutionBenchmarkRunV1[] {
	return Array.from({ length: 40 }, (_, task) => Array.from({ length: 3 }, (_, repetition) => {
		const success = task < (role === "baseline" ? 20 : 30);
		return {
			taskId: `task-${task}`,
			repetition: repetition + 1,
			split: "heldout" as const,
			slices: [task % 2 === 0 ? "coding" : "tool-use"],
			success,
			score: success ? 1 : 0,
			costUsd: 1,
			latencyMs: role === "baseline" ? 1_000 : 1_050,
			policyViolations: 0,
			replayDivergences: 0,
			unpairedToolCalls: 0,
		};
	})).flat();
}

function snapshot(role: "baseline" | "candidate", candidateId: string, candidateContentHash: string): EvolutionBenchmarkSnapshotV1 {
	return {
		schemaVersion: 1,
		kind: "catui-evolution-benchmark-snapshot",
		role,
		...(role === "candidate" ? { candidateId } : {}),
		...(role === "candidate" ? { candidateContentHash } : {}),
		createdAt: "2026-08-25T00:00:00.000Z",
		corpus: { id: "pawbench-test", version: "1", digest: `sha256:${"a".repeat(64)}` },
		harness: { revisionId: role, commitSha: role === "baseline" ? "a".repeat(40) : "b".repeat(40) },
		execution: { model: "frozen-test-model", modelVersion: "v1", temperature: 0, maxTokens: 32_768, timeoutMs: 60_000, budgetUsd: 100 },
		runs: runs(role),
	};
}

export function passingEvolutionGate(
	candidateId: string,
	candidateContentHash: string,
	overrides: Partial<Omit<EvolutionGateReport, "benchmark">> = {},
): EvolutionGateReport {
	return {
		name: "test-harness-eval+heldout-benchmark",
		passed: true,
		checkedAt: "2026-08-25T01:00:00.000Z",
		metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
		...overrides,
		benchmark: compareEvolutionBenchmarks(
			snapshot("baseline", candidateId, candidateContentHash),
			snapshot("candidate", candidateId, candidateContentHash),
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{ candidateId, checkedAt: "2026-08-25T01:00:00.000Z" },
		),
	};
}

export function writePassingEvolutionBenchmark(cwd: string, candidateId: string, candidateContentHash: string): string {
	const directory = join(cwd, ".catui", "evolution", "benchmarks");
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `${candidateId}.json`);
	writeFileSync(path, `${JSON.stringify(passingEvolutionGate(candidateId, candidateContentHash).benchmark, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	return path;
}
