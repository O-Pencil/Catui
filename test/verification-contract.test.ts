/**
 * [WHO]: Guards the one-verification-contract invariant between package.json and verification-plan.json
 * [FROM]: Depends on node:test/assert/fs, package.json, and .dev-docs/vibe-coding/verification-plan.json
 * [TO]: Consumed by npm run verify:contract, the full verification flow, and CI
 * [HERE]: test/verification-contract.test.ts - S02 plan/script drift and single-build guard
 *
 * Each test below fails when a real drift is introduced, not merely when a list looks different.
 * The mutation cases are spelled out in the assertion messages so a reviewer can reproduce them.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { orderingViolations, planStageScriptNames } from "./helpers/verification-order.js";
import { ciNpmRuns, ciRawTestRuns } from "./helpers/verification-ci.js";
import { testFileExecutions as walkTestFiles, withinStageDuplicates as withinStageFiles } from "./helpers/verification-test-graph.js";
import { join } from "node:path";

const ROOT = process.cwd();
const scripts = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
const plan = JSON.parse(readFileSync(join(ROOT, ".dev-docs", "vibe-coding", "verification-plan.json"), "utf8")) as {
	commands: Array<{ id: string; command: string; required: boolean; category: string }>;
};

/** The five mandatory gates from feature-workflow.md section 5. */
const MANDATORY_GATES = [
	{ id: "dip", script: "verify:dip" },
	{ id: "quality", script: "verify:quality" },
	{ id: "package-boundary", script: "verify:package-boundary" },
	{ id: "build", script: "build" },
	{ id: "typecheck", script: "typecheck" },
];

/**
 * Walk the `npm run` graph from `start`, counting every invocation rather than every distinct
 * script.
 *
 * Correctness rules, each of which has a counterexample test below:
 * - Cycle detection uses the current path stack, never a global "seen" set. A global set would
 *   silently truncate A -> B -> A instead of reporting it.
 * - There is no global memo that skips re-descending into a shared node. A shared node is
 *   visited once per path that reaches it, so everything beneath it is counted once per path.
 *   Skipping the second descent is the bug where `outer -> wrapper -> build` called twice
 *   reports one build instead of two.
 * - Termination comes from the path-stack cycle branch: a script cannot appear twice in one
 *   path without that branch firing. `EXPANSION_LIMIT` is a runaway backstop, not the guard.
 *
 * The counterexample tests call this same function with a synthetic graph, so the algorithm
 * under test is the one that validates package.json. There is deliberately no second copy.
 */
interface WalkResult {
	/** Distinct script names reached, in first-visit order. */
	names: string[];
	/** How many times each script's body is actually executed. */
	executions: Map<string, number>;
	/** Cycles found as `a -> b -> a` chains, without the repeated tail. */
	cycles: string[][];
	/** `npm run <x>` edges encountered, in encounter order, multiplicity preserved. */
	edges: Array<[string, string]>;
	/** True when the expansion hit EXPANSION_LIMIT and the result is partial. */
	truncated: boolean;
}

const EXPANSION_LIMIT = 100_000;

function walkIn(graph: Record<string, string>, start: string): WalkResult {
	const result: WalkResult = { names: [], executions: new Map(), cycles: [], edges: [], truncated: false };
	let steps = 0;

	const visit = (script: string, path: string[]): void => {
		if (!(script in graph)) return;
		if (path.includes(script)) {
			result.cycles.push([...path.slice(path.indexOf(script)), script]);
			return;
		}
		steps += 1;
		if (steps > EXPANSION_LIMIT) {
			result.truncated = true;
			return;
		}
		result.names.push(script);
		result.executions.set(script, (result.executions.get(script) ?? 0) + 1);
		const nextPath = [...path, script];
		for (const match of graph[script]!.matchAll(/npm run ([\w:-]+)/g)) {
			const child = match[1]!;
			result.edges.push([script, child]);
			visit(child, nextPath);
		}
	};

	visit(start, []);
	return result;
}

function walk(name: string): WalkResult {
	return walkIn(scripts, name);
}

/** Distinct reachable scripts, first-visit order. Invocation counts come from `executions`. */
function expandScript(name: string): string[] {
	return [...new Set(walk(name).names)];
}

/** Scripts that directly run a test runner, i.e. leaf suites rather than composite wrappers. */
function leafTestSuites(name: string): string[] {
	return expandScript(name).filter((entry) => /node --test/.test(scripts[entry] ?? ""));
}

function fullBuildsIn(name: string): string[] {
	return walk(name).names.filter((entry) => entry === "build" || entry === "build:release");
}

/** How many times a full compile actually runs. `build:release` delegates to `build`. */
function fullBuildExecutions(name: string): number {
	return walk(name).executions.get("build") ?? 0;
}

function planCommandIds(): string[] {
	return plan.commands.filter((command) => command.required).map((command) => command.id);
}

test("every plan command maps to a real npm script", () => {
	for (const command of plan.commands) {
		assert.match(
			command.command,
			/^npm run [\w:-]+$/,
			`Plan command ${command.id} must be a bare \`npm run <script>\` invocation so the plan and package.json cannot drift: ${command.command}`,
		);
		const script = command.command.replace("npm run ", "");
		assert.ok(script in scripts, `Plan command ${command.id} references missing script "${script}".`);
	}
});

test("all five mandatory gates are present and required in the plan", () => {
	for (const gate of MANDATORY_GATES) {
		const entry = plan.commands.find((command) => command.id === gate.id);
		assert.ok(entry, `Mandatory gate "${gate.id}" is missing from verification-plan.json.`);
		assert.equal(entry?.command, `npm run ${gate.script}`);
		assert.equal(entry?.required, true, `Mandatory gate "${gate.id}" must be required.`);
	}
});

test("the post-build dist package-boundary check is in the plan and runs after build", () => {
	const ids = plan.commands.map((command) => command.id);
	assert.ok(ids.includes("package-boundary-dist"), "The dist package-boundary check must be a plan member.");
	// The shared predicate, so the recheck's counterexample falsifies the rule this actually uses
	// rather than a copy of it that could drift.
	const stageScripts = planStageScriptNames(plan);
	const violations = orderingViolations(stageScripts);
	assert.deepEqual(
		violations,
		[],
		`the plan must keep its stage ordering: ${violations.join("; ")}`,
	);
});

test("artifact tests are build-free and reachable from a wrapper that builds first", () => {
	// Mutation to verify: adding `npm run build` to test:artifact breaks this assertion.
	assert.deepEqual(
		fullBuildsIn("test:artifact"),
		[],
		"test:artifact must not build. Building there is what made a full run compile twice.",
	);
	// Preserved documented behavior: direct `npm run test:release` still builds first.
	assert.deepEqual(
		fullBuildsIn("test:release"),
		["build"],
		"test:release must keep building before running artifact tests, so direct invocation still works.",
	);
});

/**
 * Every test file `npm test` ran at base SHA 3d1cce1, plus test/context-management.test.ts,
 * which base CI ran through a raw `node --test` step and which had no home in the script graph.
 * Splitting the build out of the release stage must not quietly drop any of them.
 */
const REQUIRED_TEST_FILES = [
	"test/bash-sandbox.test.ts",
	"test/checkpoint-store.test.ts",
	"test/cli-output-disconnect.test.ts",
	"test/context-management.test.ts",
	"test/context-window.test.ts",
	"test/default-runtime-tools.test.ts",
	"test/dev-loop.test.ts",
	"test/evolution-automation.test.ts",
	"test/evolution-extension.test.ts",
	"test/evolution-runtime-capabilities.test.ts",
	"test/evolution-schema.test.ts",
	"test/evolution-store.test.ts",
	"test/evolution-workflow.test.ts",
	"test/extension-command-completions.test.ts",
	"test/goal-controller.test.ts",
	"test/goal-grub-lifecycle.test.ts",
	"test/grub-controller.test.ts",
	"test/harness-eval.test.ts",
	"test/interactive-memory-notify.test.ts",
	"test/interactive-slash-command-arguments.test.ts",
	"test/mcp-hint-injection.test.ts",
	"test/mcp-tool-description.test.ts",
	"test/persona-assets.test.ts",
	"test/read-tool.test.ts",
	"test/release-build.test.ts",
	"test/retry-coordinator.test.ts",
	"test/rpc-command-catalog.test.ts",
	"test/run-trace-jsonl.test.ts",
	"test/sal-terrain-budget.test.ts",
	"test/security-audit.test.ts",
	"test/session-listing-memory.test.ts",
	"test/session-manager-header.test.ts",
	"test/session-runtime-owners.test.ts",
	"test/slash-command-catalog.test.ts",
	"test/source-evolution-repair.test.ts",
	"test/source-evolution.test.ts",
	"test/stream-render-task-panel.test.ts",
	"test/system-prompt.test.ts",
	"test/task-status-panel.test.ts",
	"test/task-store-polling.test.ts",
	"test/team-parser.test.ts",
	"test/team-runtime.test.ts",
	"test/team-tools.test.ts",
	"test/tool-window-validation.test.ts",
	"test/typesafe-extension.test.ts",
	"test/workspace-write-guard.test.ts",
];

/** Every test file reachable from a script, transitively. */
function testFilesIn(name: string): string[] {
	return [...new Set(expandScript(name).flatMap((entry) =>
		[...(scripts[entry] ?? "").matchAll(/test\/[a-z0-9-]+\.test\.ts/g)].map((match) => match[0])))];
}

test("the default test chain still runs every file it ran at base, plus context-management", () => {
	const reachable = new Set(testFilesIn("test"));
	const missing = REQUIRED_TEST_FILES.filter((file) => !reachable.has(file));
	assert.deepEqual(
		missing,
		[],
		`These files are no longer reachable from \`npm test\`. Deduplicating the build must not reduce acceptance coverage. Missing: ${missing.join(", ")}`,
	);
});

test("direct test:release invocation still covers its original file set", () => {
	// Mutation to verify: dropping sal-terrain-budget or persona-assets from test:release-contracts
	// breaks this, because `npm run test:release` is the documented direct entry point.
	const reachable = new Set(testFilesIn("test:release"));
	const original = [
		"test/release-build.test.ts",
		"test/cli-output-disconnect.test.ts",
		"test/sal-terrain-budget.test.ts",
		"test/persona-assets.test.ts",
	];
	assert.deepEqual(
		original.filter((file) => !reachable.has(file)),
		[],
		"test:release must keep all four original files reachable for direct invocation.",
	);
});

test("only dist-dependent tests sit behind the build", () => {
	// cli-output-disconnect imports dist/cli/output-disconnect.js and cannot run before a build.
	// The other three release files read source or package.json, so they must not be gated on it.
	assert.deepEqual(testFilesIn("test:artifact"), ["test/cli-output-disconnect.test.ts"]);
	assert.deepEqual(testFilesIn("test:release-contracts"), [
		"test/release-build.test.ts",
		"test/sal-terrain-budget.test.ts",
		"test/persona-assets.test.ts",
	]);
	assert.equal(
		expandScript("test:release-contracts").some((entry) => fullBuildsIn(entry).length > 0),
		false,
		"test:release-contracts must stay build-free so verify:full can run it before building.",
	);
	assert.ok(
		REQUIRED_TEST_FILES.every((file) => existsSync(join(ROOT, file))),
		"a required test file listed here no longer exists on disk",
	);
});

test("a full verification run builds exactly once", () => {
	for (const entry of ["verify:full", "test"]) {
		const builds = fullBuildsIn(entry);
		assert.equal(
			fullBuildExecutions(entry),
			1,
			`${entry} must trigger exactly one full build, got: ${JSON.stringify(builds)}. Run \`npm run ${entry}\`, not \`npm run build && npm run ${entry}\`.`,
		);
		assert.equal(
			builds.includes("build:release"),
			false,
			`${entry} must not add a second build through build:release.`,
		);
	}
});

test("no verification script recursively invokes the aggregate flow", () => {
	// Mutation to verify: adding `npm run verify:full` to any plan command breaks this.
	for (const command of plan.commands) {
		const script = command.command.replace("npm run ", "");
		const reached = walk(script);
		assert.equal(
			reached.cycles.length,
			0,
			`Plan command ${command.id} has a script cycle: ${reached.cycles.map((c) => c.join(" -> ")).join("; ")}`,
		);
		assert.equal(
			reached.names.includes("verify:full"),
			false,
			`Plan command ${command.id} reaches verify:full, which would recurse: ${reached.names.join(" -> ")}`,
		);
	}
});

test("the aggregate flows are acyclic", () => {
	for (const name of ["verify:full", "test", "test:release", "test:pre"]) {
		const reached = walk(name);
		assert.deepEqual(
			reached.cycles,
			[],
			`${name} has a script cycle: ${reached.cycles.map((c) => c.join(" -> ")).join("; ")}`,
		);
	}
});

/**

/**
 * Counterexamples for the traversal itself, run against `walkIn` — the same function that
 * validates package.json. There is no second copy of the algorithm: an earlier revision had
 * one, and it diverged from the real walker, which is exactly how a bug survived.
 */
const T = (files: string) => "node --test --import tsx " + files;

test("traversal counts a direct duplicate build as two executions", () => {
	// `build && build` compiles twice at runtime and must not collapse into one.
	const reached = walkIn({ double: "npm run build && npm run build", build: "tsc" }, "double");
	assert.equal(reached.executions.get("build"), 2);
	assert.deepEqual(reached.cycles, []);
});

test("traversal counts an indirect duplicate build as two executions", () => {
	const graph = {
		outer: "npm run build && npm run build:release",
		"build:release": "npm run build",
		build: "tsc",
	};
	assert.equal(walkIn(graph, "outer").executions.get("build"), 2);
});

test("traversal counts work beneath a wrapper invoked twice", () => {
	// This is the case a global 'visited' set silently got wrong: `wrapper` is counted twice,
	// but skipping the second descent would report `build` once. The regression this guards is
	// precisely `outer -> wrapper -> build` plus `outer -> wrapper`.
	const graph = { outer: "npm run wrapper && npm run wrapper", wrapper: "npm run build", build: "tsc" };
	const reached = walkIn(graph, "outer");
	assert.equal(reached.executions.get("wrapper"), 2);
	assert.equal(reached.executions.get("build"), 2, "a second wrapper call must re-count what it calls");
});

test("traversal counts work beneath a diamond's shared node", () => {
	// `shared` runs twice, so its own children run twice as well.
	const graph = {
		top: "npm run left && npm run right",
		left: "npm run shared",
		right: "npm run shared",
		shared: "npm run build",
		build: "tsc",
	};
	const reached = walkIn(graph, "top");
	assert.equal(reached.executions.get("shared"), 2);
	assert.equal(reached.executions.get("build"), 2, "the shared node's child must be counted per path");
});

test("traversal counts a three-level shared tail per path", () => {
	const graph = {
		top: "npm run a && npm run b",
		a: "npm run shared",
		b: "npm run shared",
		shared: "npm run deep",
		deep: "npm run build",
		build: "tsc",
	};
	assert.equal(walkIn(graph, "top").executions.get("build"), 2);
});

test("traversal reports a self-cycle instead of truncating it", () => {
	const reached = walkIn({ loop: "npm run build && npm run loop", build: "tsc" }, "loop");
	assert.deepEqual(reached.cycles, [["loop", "loop"]]);
	assert.equal(reached.executions.get("build"), 1, "work alongside a cycle is still counted");
});

test("traversal reports a two-node cycle instead of truncating it", () => {
	assert.deepEqual(walkIn({ a: "npm run b", b: "npm run a" }, "a").cycles, [["a", "b", "a"]]);
});

test("traversal reports a three-node cycle and still counts work outside it", () => {
	const graph = { a: "npm run b && npm run build", b: "npm run c", c: "npm run a", build: "tsc" };
	const reached = walkIn(graph, "a");
	assert.deepEqual(reached.cycles, [["a", "b", "c", "a"]]);
	assert.equal(reached.executions.get("build"), 1);
});

test("traversal terminates on a cycle and reports no truncation", () => {
	const reached = walkIn({ a: "npm run b", b: "npm run a" }, "a");
	assert.equal(reached.truncated, false, "cycle detection must terminate without hitting the limit");
});

test("the real graph is acyclic, untruncated, and builds once", () => {
	for (const name of ["verify:full", "test", "test:release", "test:pre"]) {
		const reached = walk(name);
		assert.equal(reached.truncated, false, `${name} expansion hit the safety limit`);
		assert.deepEqual(reached.cycles, [], `${name} has a cycle`);
	}
	assert.equal(fullBuildExecutions("verify:full"), 1);
	assert.equal(fullBuildExecutions("test"), 1);
});

test("a suite reached twice is still classified as one leaf suite", () => {
	const graph = { top: "npm run suite && npm run suite", suite: T("test/a.test.ts"), build: "tsc" };
	const reached = walkIn(graph, "top");
	assert.equal(reached.executions.get("suite"), 2);
	assert.deepEqual([...new Set(reached.names.filter((n) => graph[n].includes("node --test")))], ["suite"]);
});

test("verify:full covers every required plan command", () => {
	const reached = new Set(expandScript("verify:full"));
	const missing = plan.commands
		.filter((command) => command.required)
		.filter((command) => !reached.has(command.command.replace("npm run ", "")))
		.map((command) => command.id);
	assert.deepEqual(missing, [], `verify:full does not run required plan commands: ${missing.join(", ")}`);
});

/**
 * Suite names the aggregate runs directly, excluding composite stages whose children are
 * registered individually. A composite stage is one that only chains other `npm run` calls
 * without naming a test file itself.
 */
function directlyRunTestSuites(aggregate: string): string[] {
	return expandScript(aggregate)
		.filter((script) => /test:/.test(script))
		.filter((script) => /test\/[a-z0-9-]+\.test\.ts/.test(scripts[script] ?? ""))
		.map((script) => script.replace("npm run ", ""));
}

test("every suite the aggregate runs directly is registered as a required plan command", () => {
	// The coverage assertion above only asks "does verify:full run what the plan lists?". That
	// direction cannot catch a suite being added to the chain without registration, nor a gate
	// being quietly downgraded to required:false — both leave the plan self-consistent while the
	// gate stops being enforced. This asserts the opposite direction.
	const required = new Set(
		plan.commands.filter((command) => command.required).map((command) => command.command.replace("npm run ", "")),
	);
	const unregistered = directlyRunTestSuites("test").filter((suite) => !required.has(suite));
	assert.deepEqual(
		unregistered,
		[],
		`These suites run in the aggregate but are not required plan commands: ${unregistered.join(", ")}. Add them to verification-plan.json with required:true, or make them composite stages whose children are registered individually.`,
	);
});

test("a plan command cannot be silently downgraded out of the required set", () => {
	// Every test-running plan command must be required. An optional test gate is a gate nobody
	// enforces, which is indistinguishable from a deleted one once the runner only honors
	// required:false as non-blocking evidence.
	const optionalTests = plan.commands
		.filter((command) => !command.required && /test:/.test(command.command))
		.map((command) => command.id);
	assert.deepEqual(
		optionalTests,
		[],
		`Test suites in the plan must be required:true; optional ones do not block. Currently optional: ${optionalTests.join(", ")}`,
	);
});

test("the plan covers every suite the test chain runs", () => {
	// Leaf suites only: test:release and test:pre are composites that must not appear as plan
	// members, or the plan would double-count the same suite.
	const inChain = new Set(leafTestSuites("test"));
	const plannedSuites = new Set(
		plan.commands
			.filter((command) => command.command.startsWith("npm run test"))
			.map((command) => command.command.replace("npm run ", "")),
	);
	for (const suite of plannedSuites) {
		assert.ok(inChain.has(suite), `Plan lists ${suite}, but the test chain never runs it.`);
	}
	for (const suite of inChain) {
		assert.ok(
			plannedSuites.has(suite),
			`The test chain runs ${suite}, but verification-plan.json does not list it.`,
		);
	}
	assert.deepEqual(
		[...plannedSuites].filter((suite) => !/^(test:artifact|test:harness-critical)$/.test(suite)),
		[...plannedSuites].filter((suite) => inChain.has(suite)).filter((suite) => !/^(test:artifact|test:harness-critical)$/.test(suite)),
		"Every planned suite must be a real leaf suite.",
	);
});

test("release packaging and prepublish verification are retained", () => {
	assert.equal(scripts["build:release"], "npm run build", "prepublish must still build the release artifact.");
	assert.equal(scripts.prepublishOnly, "npm run build:release");
	assert.equal(
		fullBuildExecutions("prepublishOnly"),
		1,
		"prepublishOnly must still perform exactly one build.",
	);
});

test("typecheck covers the product program and the scripts program", () => {
	// scripts/ was outside the main tsconfig include list, so a required-parameter break in
	// scripts/evolution-benchmark.ts was invisible to `tsc --noEmit` and reached runtime.
	assert.equal(scripts["typecheck:scripts"], "tsc --noEmit -p tsconfig.scripts.json");
	assert.match(scripts.typecheck, /tsc --noEmit/);
	assert.match(scripts.typecheck, /typecheck:scripts/, "the scripts program must be part of the canonical typecheck");
	const scriptsConfig = JSON.parse(readFileSync(join(ROOT, "tsconfig.scripts.json"), "utf8")) as { include?: string[]; extends?: string };
	assert.ok(scriptsConfig.include?.includes("scripts/**/*.ts"), "tsconfig.scripts.json must include scripts/");
	assert.equal(scriptsConfig.extends, "./tsconfig.json", "the scripts config must inherit the project options");
	assert.equal(
		plan.commands.find((command) => command.id === "typecheck")?.command,
		"npm run typecheck",
		"The plan must use the canonical script so a typecheck change is a one-line edit.",
	);
});

/** Stages of the aggregate `npm test` flow, in execution order. */
const AGGREGATE_STAGES = ["test:release", "test:pre", "test:evolution-boundaries", "test:harness-critical"];

/**
 * The traversal lives in a shared helper, parameterized by the script map, so the recheck's
 * counterexamples can hand it a mutated copy and watch the same algorithm react. The reasoning for
 * counting executions rather than distinct files is recorded there.
 */
function testFileExecutions(name: string): Map<string, number> {
	return walkTestFiles(scripts, name);
}

function withinStageDuplicates(stage: string): string[] {
	return withinStageFiles(scripts, stage);
}

/** Regression files added by this batch, per owner. Reachability is asserted, not assumed. */
const BATCH_REGRESSION_FILES = [
	// S01 registry
	"test/builtin-extension-registry.test.ts",
	// S02 verification contract itself
	"test/verification-contract.test.ts",
	// S03 bootstraps
	"test/bootstrap-routing.test.ts",
	// S04 Presence
	"test/presence-soul-cleanup.test.ts",
	// Batch 2 evolution boundaries
	"test/evolution-baseline-binding.test.ts",
	"test/evolution-benchmark-cli-binding.test.ts",
	"test/evolution-refiner-redaction.test.ts",
	"test/evolution-rollback-discovery.test.ts",
];

test("every regression test added by this batch is reachable from npm test", () => {
	const reachable = new Set(testFilesIn("test"));
	const missing = BATCH_REGRESSION_FILES.filter((file) => !reachable.has(file));
	assert.deepEqual(
		missing,
		[],
		`These batch regression tests only run when invoked by hand, which is how the missing CLI baseline survived. Unreachable: ${missing.join(", ")}`,
	);
});

test("the evolution boundary suite runs only files the aggregate does not already run", () => {
	// Adding test:evolution wholesale would re-run the six files test:harness-critical covers.
	const elsewhere = new Set(AGGREGATE_STAGES.filter((stage) => stage !== "test:evolution-boundaries").flatMap((stage) => testFilesIn(stage)));
	const duplicated = testFilesIn("test:evolution-boundaries").filter((file) => elsewhere.has(file));
	assert.deepEqual(duplicated, [], `These evolution files would execute twice in one aggregate run: ${duplicated.join(", ")}`);
});

/**
 * Pre-existing cross-stage duplication found while wiring this batch in. It is listed rather than
 * silently removed: test:harness-critical is the load-bearing eval gate, and restructuring it is a
 * separate decision. This allowlist makes the duplication visible and prevents it from growing.
 */
const KNOWN_DUPLICATE_STAGE_FILES = ["test/default-runtime-tools.test.ts"];

test("no test file runs twice inside a single stage", () => {
	// Catches both a file listed twice in one script and a shared sub-suite reached twice.
	// The previous check used the deduplicated testFilesIn, so neither was visible.
	for (const stage of AGGREGATE_STAGES) {
		assert.deepEqual(
			withinStageDuplicates(stage),
			[],
			`${stage} runs these files more than once: ${withinStageDuplicates(stage).join(", ")}`,
		);
	}
});

test("no test file executes more than once in the aggregate flow beyond the known set", () => {
	// Count runtime executions rather than distinct files: a suite listed in two stages runs twice.
	const counts = new Map<string, number>();
	for (const stage of AGGREGATE_STAGES) {
		for (const [file, count] of testFileExecutions(stage)) counts.set(file, (counts.get(file) ?? 0) + count);
	}
	const duplicated = [...counts.entries()].filter(([, count]) => count > 1).map(([file]) => file);
	assert.deepEqual(
		duplicated.sort(),
		[...KNOWN_DUPLICATE_STAGE_FILES].sort(),
		`Cross-stage duplication changed. Either remove it or record why it is acceptable. Currently: ${duplicated.join(", ") || "none"}`,
	);
});

const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

/** Every `run: npm run <script>` across all workflows, via the shared scanner. */
function ciScriptRuns(): string[] {
	return ciNpmRuns(WORKFLOW_DIR).map((run) => run.command);
}

test("CI runs every required plan command", () => {
	// Mutation to verify: removing the release-contract step from ci.yml breaks this.
	// Static quality and the static package-boundary check live in quality.yml, so all
	// workflows are scanned together.
	const inCI = new Set(ciScriptRuns());
	const missing = plan.commands
		.filter((command) => command.required)
		.filter((command) => !inCI.has(command.command))
		.map((command) => `${command.id} (${command.command})`);
	assert.deepEqual(missing, [], `Required plan commands never run in CI: ${missing.join(", ")}`);
});

test("CI does not run tests outside the plan", () => {
	// A raw `node --test` step in CI is how context-management.test.ts lost its home at base.
	const raw = ciRawTestRuns(WORKFLOW_DIR).map((run) => `${run.file}: ${run.line}`);
	assert.deepEqual(raw, [], "CI must invoke test suites through npm scripts so the plan stays accurate.");
});

test("the release stage and context-management coverage are present in CI", () => {
	const inCI = new Set(ciScriptRuns());
	assert.ok(inCI.has("npm run test:release-contracts"), "release packaging contract tests must run in CI");
	assert.ok(inCI.has("npm run test:artifact"), "post-build artifact tests must run in CI");
	// context-management runs inside test:runtime-owners, which replaced a raw node --test step.
	assert.ok(
		new Set(testFilesIn("test:runtime-owners")).has("test/context-management.test.ts"),
		"context-management must stay reachable from a CI-invoked script.",
	);
});
