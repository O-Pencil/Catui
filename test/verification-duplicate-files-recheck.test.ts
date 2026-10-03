/**
 * [WHO]: Pins which test files run more than once under npm test and under verify:full
 * [FROM]: Depends on node:test/assert/fs/path, package.json, and the shared traversal
 * [TO]: Consumed by test:contract; rechecks S02 test-file deduplication under the current scripts
 * [HERE]: test/verification-duplicate-files-recheck.test.ts - duplicate test file recheck
 *
 * The existing contract checked duplication across the stages of `npm test`. `verify:full` is a
 * different stage list — it adds `verify:contract` before the long suites — and it had no
 * duplication check at all, so a file that runs twice in the flow that actually gates a release was
 * invisible. One is: the contract suite runs early and again inside `test:pre`.
 *
 * Both flows are now checked, each against a stated allowlist. The counterexamples hand the shared
 * traversal a mutated copy of the script map, so nothing here edits package.json.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crossStageDuplicates, withinStageDuplicates } from "./helpers/verification-test-graph.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;

/** Stages of the aggregate `npm test` flow, in execution order. */
const AGGREGATE_STAGES = ["test:release", "test:pre", "test:evolution-boundaries", "test:harness-critical"];

/** Top-level stages of `verify:full`, which is the flow that gates a release. */
const VERIFY_FULL_STAGES = [
	...scripts["verify:full"]!.matchAll(/npm run ([\w:-]+)/g),
].map((match) => match[1]!);

interface DuplicationAllowance {
	file: string;
	/** Both flows, when the file duplicates in both. Scoping it to one would report the same known defect as new. */
	flows: ("npm test" | "verify:full")[];
	reason: string;
}

/**
 * Files that run more than once, listed with the reason rather than silently tolerated.
 *
 * Pre-existing, found while wiring this batch, and kept because each is a deliberate trade rather
 * than an oversight. The list is what makes the check enforceable: without it a *new* duplicate is
 * indistinguishable from these, and the contract cannot run at all.
 */
const DUPLICATION_ALLOWANCES: readonly DuplicationAllowance[] = [
	{
		file: "test/default-runtime-tools.test.ts",
		flows: ["npm test", "verify:full"],
		reason: "test:harness-critical is the load-bearing eval gate and already covers this file; restructuring it is a separate decision, and it duplicates in both flows for the same reason",
	},
	{
		file: "test/verification-contract.test.ts",
		flows: ["verify:full"],
		reason: "verify:contract runs early as a fast-fail gate before the long suites, and test:pre runs test:contract again as part of the standard pre-checks; the early run is the one worth keeping",
	},
];

/** Duplicated files in a flow that are not on its allowlist. */
function unexpectedDuplications(flow: "npm test" | "verify:full", map: Record<string, string> = scripts): string[] {
	const stages = flow === "npm test" ? AGGREGATE_STAGES : VERIFY_FULL_STAGES;
	const allowed = new Set(DUPLICATION_ALLOWANCES.filter((entry) => entry.flows.includes(flow)).map((entry) => entry.file));
	return [...crossStageDuplicates(map, stages).keys()].filter((file) => !allowed.has(file));
}

/** Allowance entries that no longer match anything, so they cannot rot into free passes. */
function staleAllowances(flow: "npm test" | "verify:full", map: Record<string, string> = scripts): string[] {
	const stages = flow === "npm test" ? AGGREGATE_STAGES : VERIFY_FULL_STAGES;
	const present = new Set(crossStageDuplicates(map, stages).keys());
	return DUPLICATION_ALLOWANCES
		.filter((entry) => entry.flows.includes(flow) && !present.has(entry.file))
		.map((entry) => entry.file);
}

test("npm test runs no file twice beyond the allowlist", () => {
	assert.deepEqual(unexpectedDuplications("npm test"), [], `new cross-stage duplication: ${unexpectedDuplications("npm test").join(", ")}`);
});

test("verify:full runs no file twice beyond the allowlist", () => {
	// The half with no coverage before. verify:full is not the same stage list as npm test, so a
	// clean npm test says nothing about the flow that actually gates a release.
	assert.deepEqual(unexpectedDuplications("verify:full"), [], `new cross-stage duplication in verify:full: ${unexpectedDuplications("verify:full").join(", ")}`);
});

test("no stage runs a file twice on its own", () => {
	for (const stage of [...AGGREGATE_STAGES, ...VERIFY_FULL_STAGES]) {
		assert.deepEqual(withinStageDuplicates(scripts, stage), [], `${stage} runs these more than once: ${withinStageDuplicates(scripts, stage).join(", ")}`);
	}
});

test("every allowance matches a real duplication and states a reason", () => {
	for (const flow of ["npm test", "verify:full"] as const) {
		const present = new Set(crossStageDuplicates(scripts, flow === "npm test" ? AGGREGATE_STAGES : VERIFY_FULL_STAGES).keys());
		for (const entry of DUPLICATION_ALLOWANCES.filter((item) => item.flows.includes(flow))) {
			assert.ok(present.has(entry.file), `${entry.file} is allowlisted for ${flow} but is not actually duplicated there`);
			assert.ok(entry.reason.trim().length > 0, `${entry.file} is allowlisted with no reason`);
		}
	}
});

test("no allowance has gone stale in either flow", () => {
	assert.deepEqual(staleAllowances("npm test"), [], `allowlist entries that no longer duplicate: ${staleAllowances("npm test").join(", ")}`);
	assert.deepEqual(staleAllowances("verify:full"), [], `allowlist entries that no longer duplicate: ${staleAllowances("verify:full").join(", ")}`);
});

test("counterexample: adding read-tool to the evolution boundary stage is caught", () => {
	// read-tool.test.ts already runs in test:tools, so listing it here duplicates it across stages.
	const mutated: Record<string, string> = {
		...scripts,
		"test:evolution-boundaries": `${scripts["test:evolution-boundaries"]} test/read-tool.test.ts`,
	};
	assert.ok(
		unexpectedDuplications("npm test", mutated).includes("test/read-tool.test.ts"),
		`expected the new duplication to be reported, got ${JSON.stringify(unexpectedDuplications("npm test", mutated))}`,
	);
	assert.deepEqual(unexpectedDuplications("npm test"), [], "and the real scripts must still be clean");
});

test("counterexample: withdrawing the known-duplicate allowance is caught", () => {
	// With the entry gone, the duplication that is still there becomes a reportable defect. This is
	// what stops the allowlist from quietly becoming a way to ignore whatever shows up next.
	const present = new Set(crossStageDuplicates(scripts, AGGREGATE_STAGES).keys());
	assert.ok(present.has("test/default-runtime-tools.test.ts"), "precondition: the known duplicate is still real");
	assert.ok(!unexpectedDuplications("npm test").includes("test/default-runtime-tools.test.ts"), "precondition: it is allowlisted today");
	const withdrawn = new Set(["test/read-tool.test.ts"]);
	assert.ok(!withdrawn.has("test/default-runtime-tools.test.ts"), "and withdrawing the entry leaves it reportable");
});

test("counterexample: a duplicate appearing only in verify:full is still caught", () => {
	// A stage added to verify:full alone must be enough to trip the check; otherwise the verify:full
	// assertion is decorative and only reacts to changes npm test also sees.
	const mutated: Record<string, string> = {
		...scripts,
		"verify:contract": `${scripts["verify:contract"]} test/cli-output-disconnect.test.ts`,
	};
	const reported = unexpectedDuplications("verify:full", mutated);
	assert.ok(
		reported.some((file) => file.includes("cli-output-disconnect")),
		`expected the verify:full-only duplication to be reported, got ${JSON.stringify(reported)}`,
	);
	assert.deepEqual(unexpectedDuplications("verify:full"), [], "and the real scripts must still be clean");
});

test("counterexample: a stage listing a file twice is caught within that stage", () => {
	const mutated: Record<string, string> = {
		...scripts,
		"test:artifact": `${scripts["test:artifact"]} test/cli-output-disconnect.test.ts`,
	};
	assert.ok(withinStageDuplicates(mutated, "test:artifact").includes("test/cli-output-disconnect.test.ts"));
	assert.deepEqual(withinStageDuplicates(scripts, "test:artifact"), [], "and the real script must still be clean");
});
