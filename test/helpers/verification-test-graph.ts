/**
 * [WHO]: One test-file traversal shared by the duplication assertions and their counterexamples
 * [FROM]: No runtime dependencies; the script map is passed in
 * [TO]: Consumed by test/verification-contract.test.ts and test/verification-duplicate-files-recheck.test.ts
 * [HERE]: test/helpers/verification-test-graph.ts - which test files run, and how often
 *
 * Parameterized by the script map so a counterexample can mutate a copy and see the same algorithm
 * react, instead of editing package.json and hoping the restore happens. A counterexample that
 * re-implements the traversal only proves the copy can be wrong.
 *
 * Counting is by *execution*, not by distinct file name. Deduplicating hides two distinct defects:
 * a file listed twice inside one stage, and a shared sub-suite reached through two parents inside
 * one stage. Both run the file twice at runtime, and both were invisible to the earlier check.
 *
 * Two rules keep the walk honest:
 * - Cycles terminate on the current path stack, never on a global "seen" set. A global set would
 *   silently truncate A -> B -> A instead of reporting it.
 * - No global memo skips re-descending into a shared node, so a sub-suite is counted once per path
 *   that reaches it. Skipping the second descent is the bug where `outer -> wrapper -> build`
 *   reports one build instead of two.
 */

const TEST_FILE = /test\/[a-z0-9-]+\.test\.ts/g;
const SCRIPT_REF = /npm run ([\w:-]+)/g;

/** How many times each test file actually runs when `name` is invoked. */
export function testFileExecutions(scripts: Record<string, string>, name: string): Map<string, number> {
	const counts = new Map<string, number>();
	const expanded = new Set<string>();
	const visit = (script: string, path: string[]): void => {
		if (!(script in scripts)) return;
		if (path.includes(script)) return;
		for (const match of scripts[script]!.matchAll(TEST_FILE)) {
			counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
		}
		if (expanded.has(script)) return;
		expanded.add(script);
		for (const match of scripts[script]!.matchAll(SCRIPT_REF)) visit(match[1]!, path.concat(script));
	};
	visit(name, []);
	return counts;
}

/** Files that run more than once inside a single stage. */
export function withinStageDuplicates(scripts: Record<string, string>, stage: string): string[] {
	return [...testFileExecutions(scripts, stage).entries()]
		.filter(([, count]) => count > 1)
		.map(([file]) => file)
		.sort();
}

/** Files run more than once across a whole stage list, with the total execution count for each. */
export function crossStageDuplicates(
	scripts: Record<string, string>,
	stages: readonly string[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const stage of stages) {
		for (const [file, count] of testFileExecutions(scripts, stage)) {
			counts.set(file, (counts.get(file) ?? 0) + count);
		}
	}
	return new Map([...counts.entries()].filter(([, count]) => count > 1).sort(([a], [b]) => a.localeCompare(b)));
}
