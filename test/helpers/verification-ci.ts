/**
 * [WHO]: One CI-workflow scanner shared by the parity assertions and their counterexamples
 * [FROM]: Depends on node fs/path and the repository root passed in
 * [TO]: Consumed by test/verification-contract.test.ts and test/verification-ci-parity-recheck.test.ts
 * [HERE]: test/helpers/verification-ci.ts - workflow scanning for the plan/CI parity contract
 *
 * Shared for the same reason the ordering predicate is: a counterexample that re-implements the scan
 * it is meant to falsify only proves the copy can be wrong. Both directions of the parity contract
 * run over this one scanner.
 *
 * Both extensions are scanned. The existing scanners filtered on ".yml" alone, which means a workflow
 * added as "foo.yaml" would be invisible to the whole contract — the tests would go green while CI
 * ran something the plan never described. A blind spot in a guard is worse than a missing guard,
 * because it reads as coverage.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `run: npm run <script>`, in file order, one entry per occurrence. */
export function ciNpmRuns(workflowDir: string): { file: string; command: string }[] {
	return workflowFileNames(workflowDir).flatMap((file) =>
		[...readFileSync(join(workflowDir, file), "utf8").matchAll(/run: npm run ([\w:-]+)/g)].map((match) => ({ file, command: `npm run ${match[1]}` })),
	);
}

/** Any `run: node --test` step, which bypasses the npm scripts the plan describes. */
export function ciRawTestRuns(workflowDir: string): { file: string; line: string }[] {
	return workflowFileNames(workflowDir).flatMap((file) =>
		[...readFileSync(join(workflowDir, file), "utf8").matchAll(/run: node --test[^\n]*/g)].map((match) => ({ file, line: match[0] })),
	);
}

function workflowFileNames(workflowDir: string): string[] {
	return readdirSync(workflowDir)
		.filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
		.sort();
}

/**
 * CI steps that are deliberately not plan commands.
 *
 * An entry here is a claim that CI needs something the plan does not describe, and each one carries
 * its reason. The list is the point: without it, a new off-plan CI step is indistinguishable from
 * these, and the parity contract cannot be enforced at all.
 */
export interface CiStepAllowance {
	command: string;
	reason: string;
}

export const CI_STEP_ALLOWANCES: readonly CiStepAllowance[] = [
	{
		command: "npm run build:deps",
		reason: "installs and prepares dependencies before any gate can run; it is a prerequisite, not a gate, and running it under a plan id would imply it is evidence on its own",
	},
	{
		command: "npm run test:source-evolution",
		reason: "an extra focused run of the source-side suite; the same files already run under test:harness-critical, which is the plan command that carries them",
	},
];

/**
 * `npm run` steps in CI that the plan does not describe and nobody has accounted for.
 *
 * Both the plan's own commands and the allowance list are subtracted. Subtracting only the
 * allowances would report every legitimate plan step as unaccounted for, which is how a guard gets
 * switched off rather than fixed.
 */
export function unaccountedCiSteps(
	workflowDir: string,
	planCommands: readonly string[],
	allowances: readonly CiStepAllowance[] = CI_STEP_ALLOWANCES,
): { file: string; command: string }[] {
	const described = new Set([...planCommands, ...allowances.map((allowance) => allowance.command)]);
	return ciNpmRuns(workflowDir).filter((run) => !described.has(run.command));
}

/** Allowance entries that no longer match anything in CI, so they cannot rot into free passes. */
export function staleAllowances(
	workflowDir: string,
	allowances: readonly CiStepAllowance[] = CI_STEP_ALLOWANCES,
): string[] {
	const present = new Set(ciNpmRuns(workflowDir).map((run) => run.command));
	return allowances.filter((allowance) => !present.has(allowance.command)).map((allowance) => allowance.command);
}
