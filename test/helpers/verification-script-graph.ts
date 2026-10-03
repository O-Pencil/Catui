/**
 * [WHO]: One npm-run graph traversal shared by the contract assertions and their counterexamples
 * [FROM]: No runtime dependencies; the graph is passed in
 * [TO]: Consumed by test/verification-contract.test.ts and test/verification-recursion-recheck.test.ts
 * [HERE]: test/helpers/verification-script-graph.ts - script reachability, execution counts, cycles
 *
 * Shared so a counterexample exercises the algorithm that validates package.json rather than a
 * copy of it. An earlier revision had two, and the copy diverged from the real walker, which is
 * exactly how a bug survived review.
 *
 * `dedupe` exists because the obvious alternative to a path stack is a global visited set, and that
 * alternative is wrong in a way that is easy to argue for and easy to ship. The strategy is a
 * parameter rather than a second implementation so the counterexamples can run *both* and show the
 * global variant reporting fewer executions than actually happen — the divergence is the
 * documentation.
 *
 *   - "path"  (default, correct): a script may appear more than once on different paths, and
 *     everything beneath it is counted once per path that reaches it. Cycles terminate on the
 *     current path.
 *   - "global": a script is expanded once ever. A shared sub-suite reached by two parents is
 *     counted once instead of twice, and a cycle is silently truncated rather than reported.
 *
 * The `EXPANSION_LIMIT` backstop is a runaway guard, not the termination mechanism; termination comes
 * from the path-stack branch.
 */

export const EXPANSION_LIMIT = 100_000;

export type DedupeStrategy = "path" | "global";

export interface WalkResult {
	/** Distinct script names reached, in first-visit order. */
	names: string[];
	/** How many times each script's body is actually executed. */
	executions: Map<string, number>;
	/** Cycles found as `a -> b -> a` chains, without the repeated tail. Empty under "global". */
	cycles: string[][];
	/** `npm run <x>` edges encountered, in encounter order, multiplicity preserved. */
	edges: Array<[string, string]>;
	/** True when the expansion hit EXPANSION_LIMIT and the result is partial. */
	truncated: boolean;
}

const SCRIPT_REF = /npm run ([\w:-]+)/g;

export function walkScriptGraph(graph: Record<string, string>, start: string, dedupe: DedupeStrategy = "path"): WalkResult {
	const result: WalkResult = { names: [], executions: new Map(), cycles: [], edges: [], truncated: false };
	const globallyExpanded = new Set<string>();
	let steps = 0;

	const visit = (script: string, path: string[]): void => {
		if (!(script in graph)) return;
		if (dedupe === "path" && path.includes(script)) {
			result.cycles.push([...path.slice(path.indexOf(script)), script]);
			return;
		}
		if (dedupe === "global" && globallyExpanded.has(script)) return;
		steps += 1;
		if (steps > EXPANSION_LIMIT) {
			result.truncated = true;
			return;
		}
		result.names.push(script);
		result.executions.set(script, (result.executions.get(script) ?? 0) + 1);
		if (dedupe === "global") globallyExpanded.add(script);
		const nextPath = [...path, script];
		for (const match of graph[script]!.matchAll(SCRIPT_REF)) {
			const child = match[1]!;
			result.edges.push([script, child]);
			visit(child, nextPath);
		}
	};

	visit(start, []);
	return result;
}

/**
 * Script names that perform a full compile.
 *
 * Named rather than matched by pattern because the pattern is a guess: `build` delegates through
 * `build:deps` and `tsc`, `build:release` delegates to `build`, and a future `rebuild:full` would
 * too. Anything whose whole body is a delegation to one of these is a full compile under another
 * name, and a guard that only knows two strings would not see it — so `unregisteredBuildAliases`
 * reports them instead of letting them accumulate silently.
 */
export const FULL_BUILD_ALIASES: readonly string[] = [
	"build",
	"build:release",
	// Found by the drift check below, not by inspection: `prepublishOnly` delegates straight to
	// `build:release` and so compiles as often as `build` does. It was absent from the two-name
	// list, so any count taken through it would have missed those compiles.
	"prepublishOnly",
];

/** Scripts that are nothing but a delegation to a full build, but are not named in the set above. */
export function unregisteredBuildAliases(graph: Record<string, string>): string[] {
	const known = new Set(FULL_BUILD_ALIASES);
	return Object.entries(graph)
		.filter(([name]) => !known.has(name))
		.filter(([, body]) => new RegExp(`^npm run (${[...known].join("|")})$`).test(body.trim()))
		.map(([name]) => name);
}

/** Distinct full-build script names reached from `start`, in first-visit order. */
export function fullBuildsIn(graph: Record<string, string>, start: string): string[] {
	return walkScriptGraph(graph, start).names.filter((name) => FULL_BUILD_ALIASES.includes(name));
}

/** How many full builds actually execute when `start` is invoked. */
export function fullBuildExecutions(graph: Record<string, string>, start: string): number {
	return walkScriptGraph(graph, start).executions.get("build") ?? 0;
}
