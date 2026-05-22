/**
 * [WHO]: Provides selfDiagnosisCli() entrypoint for maintainer-invoked reflexive self-study runs
 * [FROM]: Depends on ./lib/eval-sink for the metric writer + VARIANT constant, node:child_process for pencil invocation, node:fs / node:path / node:util built-ins
 * [TO]: Consumed by maintainers via `npx tsx scripts/self-diagnosis/run.ts --archetype=<id>`; not imported by any extension or runtime
 * [HERE]: scripts/self-diagnosis/run.ts — orchestration shell. Variant tagging on eval_runs happens at child run_start via the NANOPENCIL_EVAL_VARIANT env var (read by extensions/defaults/sal/index.ts:755); no post-exit PATCH is performed.
 */

import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { VARIANT } from "./lib/eval-sink.js";

interface RunOptions {
	archetype: "A";
	dryRun: boolean;
}

const SENTINEL = "SELF-STUDY COMPLETE";
const MAX_POST_SENTINEL_TURNS = 2; // Allow some slack after sentinel

/**
 * Framework noise that pencil emits to stdout (where the model output also goes).
 * Lines matching these prefixes are stripped from output.md so the markdown stays
 * a clean record of the model's answer. The original noise is still preserved in
 * run.log (stderr) AND visible in `run.log` via the same regex applied externally.
 * Patterns are line-anchored — only entire lines starting with the prefix are removed.
 */
const STDOUT_NOISE_PATTERNS = /^(MCP tools loaded:.*|\[Cron-Scheduler\].*|\[sal\].*)\r?\n/gm;

export function parseRunArgs(argv: string[]): RunOptions {
	const { values } = parseArgs({
		args: argv,
		options: {
			archetype: { type: "string", default: "A" },
			"dry-run": { type: "boolean", default: false },
		},
		strict: true,
	});
	if (values.archetype !== "A") {
		throw new Error(`Unknown archetype: ${values.archetype}. Supported: A.`);
	}
	return {
		archetype: values.archetype as "A",
		dryRun: values["dry-run"] === true,
	};
}

export async function selfDiagnosisCli(argv: string[]): Promise<number> {
	const opts = parseRunArgs(argv);
	const date = new Date().toISOString().split("T")[0];
	const runDir = join("scripts/self-diagnosis/runs", date);
	if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });

	const runId = `sd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	const taskFile = join(runDir, "task.md");
	const outputFile = join(runDir, "output.md");
	const logFile = join(runDir, "run.log");

	// Archetype A prompt (placeholder logic - would eventually load from ./archetypes/A-*.ts)
	const taskPrompt = `Perform Archetype A: Reflexive Self-Trace.
Read your own eval_tool_traces for the last 100 turns. 
Pick 3 turns that show interesting patterns.
When done, write your report and finish with verbatim: ${SENTINEL}`;

	writeFileSync(taskFile, taskPrompt, "utf-8");

	if (opts.dryRun) {
		console.log(`[self-diagnosis] Dry run — Task written to ${taskFile}`);
		return 0;
	}

	console.error(`[self-diagnosis] Starting run ${runId} with archetype ${opts.archetype}...`);

	const child = spawn("npx", ["tsx", "cli.ts", "--print"], {
		env: {
			...process.env,
			NANOPENCIL_EVAL_RUN_ID: runId,
			NANOPENCIL_EVAL_VARIANT: VARIANT,
			NANOPENCIL_EVAL_ENABLED: "true",
		},
		stdio: ["pipe", "pipe", "pipe"],
		// shell: true is required on Windows so spawn finds npx.cmd via PATH
		// resolution; harmless on Linux/Mac (the args here are static strings
		// and the user prompt flows through stdin, not argv, so no injection
		// surface).
		shell: true,
	});

	let outputData = "";
	let logData = "";
	let sentinelFound = false;
	let turnsSinceSentinel = 0;

	// Instruction Interceptor: monitor stdout for sentinel
	child.stdout.on("data", (chunk) => {
		const text = chunk.toString();
		outputData += text;
		if (text.includes(SENTINEL)) {
			console.error(`[self-diagnosis] Sentinel detected! Initiating graceful shutdown...`);
			sentinelFound = true;
		}
	});

	child.stderr.on("data", (chunk) => {
		const text = chunk.toString();
		logData += text;
		// Count turns via [sal][eval] route_turn_anchor log markers if present
		if (text.includes("route_turn_anchor")) {
			if (sentinelFound) {
				turnsSinceSentinel++;
				if (turnsSinceSentinel >= MAX_POST_SENTINEL_TURNS) {
					console.error(`[self-diagnosis] Runaway guard triggered! Killing child...`);
					child.kill("SIGTERM");
				}
			}
		}
	});

	child.stdin.write(taskPrompt);
	child.stdin.end();

	return new Promise((resolve) => {
		child.on("exit", (code) => {
			const cleanedOutput = outputData.replace(STDOUT_NOISE_PATTERNS, "");
			writeFileSync(outputFile, cleanedOutput, "utf-8");
			writeFileSync(logFile, logData, "utf-8");
			const strippedBytes = outputData.length - cleanedOutput.length;
			console.error(`[self-diagnosis] Child exited with code ${code}. Stripped ${strippedBytes} bytes of framework noise from output.md. Variant tagging owned by SAL at run_start; no post-exit PATCH performed.`);
			resolve(code ?? 0);
		});

		// Emergency cleanup for the orchestrator itself
		process.on("SIGINT", () => child.kill("SIGINT"));
		process.on("SIGTERM", () => child.kill("SIGTERM"));
		process.on("exit", () => {
			if (!child.killed) child.kill("SIGTERM");
		});
	});
}

// Cross-platform entry-point check. On Windows `process.argv[1]` is a backslash
// path like `D:\...\run.ts` while `import.meta.url` is `file:///D:/.../run.ts`;
// a naive string concat won't match. `pathToFileURL` normalises both ends.
const isDirectInvocation =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectInvocation) {
	selfDiagnosisCli(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			console.error(err);
			process.exit(1);
		},
	);
}
