/**
 * [WHO]: Offline paired benchmark evidence generator for evolution candidates
 * [FROM]: Reads versioned baseline and candidate snapshots from explicit JSON paths
 * [TO]: Writes an integrity-bound private promotion report for the evolution gate
 * [HERE]: scripts/evolution-benchmark.ts - CLI boundary for real-task evidence
 */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	compareEvolutionBenchmarks,
	DEFAULT_EVOLUTION_BENCHMARK_POLICY,
} from "../extensions/optional/evolution/benchmark-comparison.js";

interface EvolutionBenchmarkCliIo {
	stdout: (line: string) => void;
	stderr: (line: string) => void;
	checkedAt?: string;
}

function requiredArgumentsMessage(): string {
	return "Required arguments: --baseline <path> --candidate <path> --candidate-id <id> --output <path>";
}

function parseCliArguments(args: readonly string[]): {
	baselinePath: string;
	candidatePath: string;
	candidateId: string;
	outputPath: string;
} {
	const parsed = parseArgs({
		args: [...args],
		allowPositionals: false,
		strict: true,
		options: {
			baseline: { type: "string" },
			candidate: { type: "string" },
			"candidate-id": { type: "string" },
			output: { type: "string", short: "o" },
		},
	});
	const baselinePath = parsed.values.baseline?.trim();
	const candidatePath = parsed.values.candidate?.trim();
	const candidateId = parsed.values["candidate-id"]?.trim();
	const outputPath = parsed.values.output?.trim();
	if (!baselinePath || !candidatePath || !candidateId || !outputPath) {
		throw new Error(requiredArgumentsMessage());
	}
	return { baselinePath, candidatePath, candidateId, outputPath };
}

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

export async function runEvolutionBenchmarkCli(
	args: readonly string[],
	io: EvolutionBenchmarkCliIo = {
		stdout: (line) => process.stdout.write(`${line}\n`),
		stderr: (line) => process.stderr.write(`${line}\n`),
	},
): Promise<number> {
	try {
		const options = parseCliArguments(args);
		const [baseline, candidate] = await Promise.all([
			readJson(options.baselinePath),
			readJson(options.candidatePath),
		]);
		const report = compareEvolutionBenchmarks(
			baseline,
			candidate,
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{ candidateId: options.candidateId, checkedAt: io.checkedAt },
		);
		const absoluteOutputPath = resolve(options.outputPath);
		await mkdir(dirname(absoluteOutputPath), { recursive: true });
		await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		await chmod(absoluteOutputPath, 0o600);
		const failures = report.checks.filter((check) => !check.passed).map((check) => check.id);
		io.stdout(report.passed
			? `PASS ${report.candidateId}`
			: `FAIL ${report.candidateId}: ${failures.join(", ")}`);
		return report.passed ? 0 : 1;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		io.stderr(`Evolution benchmark error: ${message}`);
		return 2;
	}
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPath) {
	process.exitCode = await runEvolutionBenchmarkCli(process.argv.slice(2));
}
