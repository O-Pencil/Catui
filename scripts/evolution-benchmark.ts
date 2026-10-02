/**
 * [WHO]: Offline paired benchmark evidence generator for evolution candidates
 * [FROM]: Reads versioned baseline and candidate snapshots, and the candidate record in the
 *        evolution store to learn the baseline the store captured for it
 * [TO]: Writes an integrity-bound private promotion report for the evolution gate
 * [HERE]: scripts/evolution-benchmark.ts - CLI boundary for real-task evidence
 *
 * The report is bound to the baseline revision the store captured when the candidate was
 * created, not to a value supplied on the command line. A flag would be caller-asserted; reading
 * the persisted record is the same trusted source the promotion gate checks against. If the
 * candidate cannot be found, the CLI fails rather than defaulting to `null`, because a missing
 * baseline and a genuine first candidate are different states and must not be conflated.
 *
 * Offline orchestration still grants no runtime execution authority: this tool only writes a
 * report file for the existing gate to verify.
 */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	compareEvolutionBenchmarks,
	DEFAULT_EVOLUTION_BENCHMARK_POLICY,
} from "../extensions/optional/evolution/benchmark-comparison.js";
import { getEvolutionScopeRoot, inspectEvolution } from "../extensions/optional/evolution/evolution-store.js";
import type { EvolutionScopeSelector } from "../extensions/optional/evolution/evolution-types.js";

interface EvolutionBenchmarkCliIo {
	stdout: (line: string) => void;
	stderr: (line: string) => void;
	checkedAt?: string;
}

function requiredArgumentsMessage(): string {
	return [
		"Required arguments:",
		"  --baseline <path>   versioned baseline benchmark snapshot",
		"  --candidate <path>  versioned candidate benchmark snapshot",
		"  --candidate-id <id> the candidate this evidence is for",
		"  --output <path>     where to write the promotion report",
		"  --agent-dir <path>  agent data root holding the evolution store",
		"  --scope <global|workspace|session> the candidate's evolution scope",
		"  --cwd <path>        required for --scope workspace",
		"  --session-id <id>   required for --scope session",
	].join("\n");
}

function parseCliArguments(args: readonly string[]): {
	baselinePath: string;
	candidatePath: string;
	candidateId: string;
	outputPath: string;
	agentDir: string;
	scope: EvolutionScopeSelector["scope"];
	cwd?: string;
	sessionId?: string;
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
			"agent-dir": { type: "string" },
			scope: { type: "string" },
			cwd: { type: "string" },
			"session-id": { type: "string" },
		},
	});
	const baselinePath = parsed.values.baseline?.trim();
	const candidatePath = parsed.values.candidate?.trim();
	const candidateId = parsed.values["candidate-id"]?.trim();
	const outputPath = parsed.values.output?.trim();
	const agentDir = parsed.values["agent-dir"]?.trim();
	const scope = parsed.values.scope?.trim();
	if (!baselinePath || !candidatePath || !candidateId || !outputPath || !agentDir || !scope) {
		throw new Error(requiredArgumentsMessage());
	}
	if (scope !== "global" && scope !== "workspace" && scope !== "session") {
		throw new Error(`--scope must be global, workspace, or session: ${scope}`);
	}
	const cwd = parsed.values.cwd?.trim();
	const sessionId = parsed.values["session-id"]?.trim();
	if (scope === "workspace" && !cwd) throw new Error("--scope workspace requires --cwd.");
	if (scope === "session" && !sessionId) throw new Error("--scope session requires --session-id.");
	return {
		baselinePath,
		candidatePath,
		candidateId,
		outputPath,
		agentDir,
		scope,
		...(cwd ? { cwd } : {}),
		...(sessionId ? { sessionId } : {}),
	};
}

/**
 * Read the baseline the store captured for this candidate. Throws when the candidate is absent
 * or predates baseline capture, because neither can be substituted with `null` without turning a
 * real gap into a passing one.
 */
function readCapturedBaseline(agentDir: string, scope: EvolutionScopeSelector, candidateId: string): string | null {
	const scopeRoot = getEvolutionScopeRoot(agentDir, scope);
	const inspection = inspectEvolution(scopeRoot);
	const candidate = inspection.candidates.find((entry) => entry.id === candidateId);
	if (!candidate) {
		throw new Error(`Evolution candidate not found in scope ${scopeRoot}: ${candidateId}`);
	}
	if (!("baselineRevisionId" in candidate)) {
		throw new Error(
			`Evolution candidate ${candidateId} predates baseline capture and cannot produce baseline-bound evidence.`,
		);
	}
	return candidate.baselineRevisionId ?? null;
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
		const baselineRevisionId = readCapturedBaseline(
			options.agentDir,
			{ scope: options.scope, cwd: options.cwd, sessionId: options.sessionId },
			options.candidateId,
		);
		const report = compareEvolutionBenchmarks(
			baseline,
			candidate,
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{ candidateId: options.candidateId, baselineRevisionId, checkedAt: io.checkedAt },
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
