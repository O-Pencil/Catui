/**
 * [WHO]: Provides selfDiagnosisCli() entrypoint for maintainer-invoked reflexive self-study runs
 * [FROM]: Depends on ./archetypes/* for task prompt construction, ./lib/eval-sink for insforge writes, node:child_process for pencil invocation
 * [TO]: Consumed by maintainers via `node --import tsx scripts/self-diagnosis/run.ts --archetype=<id>`; not imported by any extension or runtime
 * [HERE]: scripts/self-diagnosis/run.ts — orchestration shell; loads archetype, invokes pencil, captures output, writes one eval_metric_results row with variant='self-diagnosis'
 */

// SKELETON — implementation pending. See .dev-docs/self-awareness/charter.md §4 S2/S3.

import { parseArgs } from "node:util";

interface RunOptions {
	archetype: "A";
	dryRun: boolean;
}

/**
 * Parse CLI args. Currently only --archetype=A is supported.
 */
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
		archetype: values.archetype,
		dryRun: values["dry-run"] === true,
	};
}

/**
 * Main entry. Currently a stub: prints the resolved plan and exits.
 *
 * When implemented:
 *   1. Resolve archetype task prompt (from ./archetypes/<id>-*.ts)
 *   2. Write task.md to scripts/self-diagnosis/runs/<date>/
 *   3. Spawn `npx tsx cli.ts --print` with the task as stdin
 *   4. Capture stdout → output.md (stderr separately → run.log)
 *   5. Query eval_runs/eval_turns/eval_tool_traces for the new run_id
 *   6. Compute structured analysis (per archetype) → analysis.json
 *   7. Write one row to eval_metric_results with variant='self-diagnosis'
 */
export async function selfDiagnosisCli(argv: string[]): Promise<number> {
	const opts = parseRunArgs(argv);
	console.error(`[self-diagnosis] STUB — archetype=${opts.archetype} dryRun=${opts.dryRun}`);
	console.error(`[self-diagnosis] Implementation pending; see .dev-docs/self-awareness/charter.md §4`);
	return 0;
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
	selfDiagnosisCli(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			console.error(err);
			process.exit(1);
		},
	);
}
