/**
 * [WHO]: Rechecks that the npm-run graph traversal still terminates, reports cycles, and counts work per path
 * [FROM]: Depends on node:test/assert/fs/path, package.json, and the shared graph traversal
 * [TO]: Consumed by test:contract; rechecks S02 script-graph traversal under the current scripts
 * [HERE]: test/verification-recursion-recheck.test.ts - traversal and cycle-detection recheck
 *
 * The six counterexample classes for the traversal already exist in the contract. Two things were
 * missing, and both are the kind of gap that reads as coverage:
 *
 *  - `truncated` was never asserted. A runaway expansion that hit the backstop would have reported
 *    a partial result, and every "no cycle" assertion above it would have passed on that partial
 *    answer. A guard that can silently return less than it promised is not a guard.
 *  - Nobody had actually run the wrong traversal. The counterexamples assert what the correct one
 *    does, which is evidence the property holds but not evidence it is load-bearing. The previous
 *    round recorded a global-visited mutation as failing nothing, because it had been applied to
 *    the wrong helper — the test-file walk, not this one. This file runs both strategies through the
 *    same implementation and shows where they diverge, so the property is shown to be load-bearing
 *    rather than merely true.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkScriptGraph } from "./helpers/verification-script-graph.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;

const AGGREGATE_ENTRIES = ["verify:full", "test", "test:release", "test:pre"];

test("the four aggregate entries are acyclic", () => {
	for (const name of AGGREGATE_ENTRIES) {
		const reached = walkScriptGraph(scripts, name);
		assert.deepEqual(reached.cycles, [], `${name} has a script cycle: ${reached.cycles.map((cycle) => cycle.join(" -> ")).join("; ")}`);
	}
});

test("the four aggregate entries expand completely, not into a truncated partial result", () => {
	// The gap. A truncated walk reports "no cycles found" just as happily as a complete one, and
	// every acyclicity assertion above would have passed on a result that saw nothing.
	for (const name of AGGREGATE_ENTRIES) {
		const reached = walkScriptGraph(scripts, name);
		assert.equal(reached.truncated, false, `${name} hit the expansion backstop, so its cycle result is partial`);
		assert.ok(reached.names.length > 0, `${name} must reach at least one script`);
	}
});

test("a runaway expansion is reported as truncated rather than returned as complete", () => {
	// And the backstop is proven to work, so the assertion above is a real check rather than a
	// property that happens to hold because the limit is unreachable.
	// Each level calls the next one twice, so the expansion doubles per level: 2^40 paths from a
	// forty-node graph. A chain would not do, because a chain terminates and reports no cycles.
	const runaway: Record<string, string> = { start: "npm run n0" };
	for (let level = 0; level < 40; level += 1) {
		runaway[`n${level}`] = `npm run n${level + 1} && npm run n${level + 1}`;
	}
	runaway.n40 = "tsc";

	const walked = walkScriptGraph(runaway, "start");
	assert.equal(walked.truncated, true, "a runaway must not look like a clean answer");
	assert.ok(walked.names.length < 200_000, `the backstop must actually bound the walk, got ${walked.names.length} scripts`);
});

/** The six shapes the counterexamples depend on, kept here so both strategies can be run over them. */
const SHAPES: { name: string; graph: Record<string, string>; start: string; expect: Record<string, number>; cycles: string[][] }[] = [
	{ name: "direct duplicate", graph: { double: "npm run build && npm run build", build: "tsc" }, start: "double", expect: { build: 2 }, cycles: [] },
	{
		name: "indirect duplicate",
		graph: { outer: "npm run build && npm run build:release", "build:release": "npm run build", build: "tsc" },
		start: "outer",
		expect: { build: 2 },
		cycles: [],
	},
	{
		name: "shared node beneath a wrapper called twice",
		graph: { outer: "npm run wrapper && npm run wrapper", wrapper: "npm run build", build: "tsc" },
		start: "outer",
		expect: { wrapper: 2, build: 2 },
		cycles: [],
	},
	{
		name: "diamond shared node",
		graph: { top: "npm run left && npm run right", left: "npm run shared", right: "npm run shared", shared: "npm run build", build: "tsc" },
		start: "top",
		expect: { shared: 2, build: 2 },
		cycles: [],
	},
	{
		name: "self cycle",
		graph: { loop: "npm run build && npm run loop", build: "tsc" },
		start: "loop",
		expect: { build: 1 },
		cycles: [["loop", "loop"]],
	},
	{ name: "two-node cycle", graph: { a: "npm run b", b: "npm run a" }, start: "a", expect: {}, cycles: [["a", "b", "a"]] },
	{
		name: "three-node cycle with work outside it",
		graph: { a: "npm run b && npm run build", b: "npm run c", c: "npm run a", build: "tsc" },
		start: "a",
		expect: { build: 1 },
		cycles: [["a", "b", "c", "a"]],
	},
];

test("the path stack reports the execution counts and cycles each shape requires", () => {
	for (const shape of SHAPES) {
		const reached = walkScriptGraph(shape.graph, shape.start, "path");
		for (const [script, count] of Object.entries(shape.expect)) {
			assert.equal(reached.executions.get(script), count, `${shape.name}: ${script} must execute ${count} times`);
		}
		assert.deepEqual(reached.cycles, shape.cycles, `${shape.name} must report its cycles`);
	}
});

test("a global visited set is wrong, and this is where it diverges", () => {
	// The proof the property is load-bearing. Reintroducing the global set does not fail some
	// unrelated assertion: it makes the traversal under-count real executions and silently drop
	// cycles, on exactly the shapes where work is shared.
	const divergences: string[] = [];
	for (const shape of SHAPES) {
		const correct = walkScriptGraph(shape.graph, shape.start, "path");
		const global = walkScriptGraph(shape.graph, shape.start, "global");
		const underCounted = [...correct.executions].filter(([script, count]) => (global.executions.get(script) ?? 0) !== count);
		const cyclesDropped = correct.cycles.length > 0 && global.cycles.length === 0;
		if (underCounted.length > 0 || cyclesDropped) {
			divergences.push(`${shape.name}${underCounted.length > 0 ? ` (under-counts ${underCounted.map(([s]) => s).join(", ")})` : ""}${cyclesDropped ? " (drops the cycle)" : ""}`);
		}
	}
	assert.ok(
		divergences.length >= 3,
		`reintroducing a global visited set must break at least three counterexamples, it broke ${divergences.length}: ${divergences.join("; ")}`,
	);
});

test("the divergences are the ones that hide real work and real cycles", () => {
	// Not "at least three" and stop. The specific failures are named, so a future change that made
	// the global variant wrong for some *other* reason would not satisfy this.
	const correct = walkScriptGraph(SHAPES[2]!.graph, SHAPES[2]!.start, "path");
	const global = walkScriptGraph(SHAPES[2]!.graph, SHAPES[2]!.start, "global");
	assert.equal(correct.executions.get("build"), 2, "the correct traversal re-counts what a second wrapper call reaches");
	assert.equal(global.executions.get("build"), 1, "a global set would report one build where two happen");

	const cycleShape = SHAPES[4]!;
	assert.equal(walkScriptGraph(cycleShape.graph, cycleShape.start, "path").cycles.length, 1);
	assert.deepEqual(walkScriptGraph(cycleShape.graph, cycleShape.start, "global").cycles, [], "a global set truncates the cycle instead of reporting it");
});
