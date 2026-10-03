/**
 * [WHO]: Rechecks that a full verification run compiles once, and that the build vocabulary has not outgrown its guard
 * [FROM]: Depends on node:test/assert/fs/path, package.json, and the shared graph traversal
 * [TO]: Consumed by test:contract; rechecks S02 single-build under the current scripts
 * [HERE]: test/verification-single-build-recheck.test.ts - single-build recheck
 *
 * The "builds exactly once" assertion already exists in the contract. What it did not have is a
 * counterexample, so nothing showed the assertion was load-bearing rather than merely true.
 *
 * The second gap is narrower and easy to miss. The assertion recognises a full compile by name —
 * `build` and `build:release` — because deciding it by pattern is a guess: `build` delegates through
 * `build:deps` and `tsc`, and a future `rebuild:full` delegating straight to `build` would compile
 * twice while a name-based guard watched neither. Rather than widen the pattern on a guess, the
 * vocabulary is checked against the scripts: anything that is nothing but a delegation to a known
 * build is reported until it is named, so the list cannot drift past the graph unnoticed.
 *
 * Every counterexample hands the shared traversal a copy of the script map. Nothing here edits
 * package.json.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	FULL_BUILD_ALIASES,
	fullBuildExecutions,
	fullBuildsIn,
	unregisteredBuildAliases,
} from "./helpers/verification-script-graph.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;

/** The same property the contract asserts, as a function, so a counterexample can run it. */
function singleBuild(map: Record<string, string>, entry: string): boolean {
	return fullBuildExecutions(map, entry) === 1 && !fullBuildsIn(map, entry).includes("build:release");
}

test("a full verification run builds exactly once, under the current scripts", () => {
	for (const entry of ["verify:full", "test"]) {
		assert.equal(fullBuildExecutions(scripts, entry), 1, `${entry} must compile exactly once`);
		assert.equal(
			fullBuildsIn(scripts, entry).includes("build:release"),
			false,
			`${entry} must not add a second compile through build:release`,
		);
	}
});

test("the artifact stage still builds nothing of its own", () => {
	// The other half of the guarantee: a stage that builds is what made a full run compile twice.
	assert.deepEqual(fullBuildsIn(scripts, "test:artifact"), [], "test:artifact must not build");
	assert.deepEqual(
		fullBuildsIn(scripts, "test:release-contracts"),
		[],
		"the release contract stage must not build either; test:release does it once for both",
	);
});

test("the vocabulary is the one the build guard actually reports by", () => {
	// Emptying the list cannot change the compile count, which comes from the `build` node itself,
	// so nothing else would notice — it would only quietly stop the guard saying *which* scripts
	// contributed, and the assertions that mention `build:release` by name would go vacuous.
	assert.ok(FULL_BUILD_ALIASES.includes("build"), "the compile itself must be in the vocabulary");
	assert.ok(FULL_BUILD_ALIASES.includes("build:release"), "its delegating alias must be too");
	// One entry per path that reaches the script, not one per distinct name: `build` is reported
	// twice here because two routes reach it. Collapsing that would hide the very doubling the
	// single-build assertion exists to catch.
	assert.deepEqual(
		fullBuildsIn({ outer: "npm run build && npm run build:release", build: "tsc", "build:release": "npm run build" }, "outer"),
		["build", "build:release", "build"],
		"a flow reaching both the alias and the compile must report every route, not every name once",
	);
});

test("every script that is nothing but a delegation to a build is named in the vocabulary", () => {
	// The drift check. A new alias compiles as often as `build` does, so the count above would not
	// see it; this reports it instead of letting the list quietly fall behind the graph.
	assert.deepEqual(
		unregisteredBuildAliases(scripts),
		[],
		`these scripts delegate straight to a full build but are not named as builds: ${unregisteredBuildAliases(scripts).join(", ")}`,
	);
});

test("counterexample: prepending a build to verify:full breaks the guarantee", () => {
	const mutated: Record<string, string> = { ...scripts, "verify:full": `npm run build && ${scripts["verify:full"]}` };

	assert.equal(fullBuildExecutions(scripts, "verify:full"), 1, "precondition: one build today");
	assert.equal(singleBuild(mutated, "verify:full"), false, "two builds must fail the same property");
	assert.equal(fullBuildExecutions(mutated, "verify:full"), 2);
	assert.deepEqual(fullBuildsIn(mutated, "verify:full"), ["build", "build"], "and the walk must see both");
});

test("counterexample: prepending a build to the test flow breaks it the same way", () => {
	const mutated: Record<string, string> = { ...scripts, test: `npm run build && ${scripts["test"]}` };
	assert.equal(singleBuild(mutated, "test"), false);
});

test("counterexample: building through an alias the guard does not know is reported", () => {
	// The narrowness the vocabulary check exists for. The counter-count is not fooled — two
	// delegations really are two compiles — but the *detection* would not have flagged the name.
	const mutated: Record<string, string> = {
		...scripts,
		"rebuild:full": "npm run build",
		"verify:full": `npm run rebuild:full && npm run rebuild:full && ${scripts["verify:full"]}`,
	};
	assert.deepEqual(unregisteredBuildAliases(mutated), ["rebuild:full"], "the unnamed alias must be reported");
	assert.equal(singleBuild(mutated, "verify:full"), false, "and two delegations are two compiles");
});

test("counterexample: removing the build from verify:full is reported too", () => {
	// The property is "exactly once", not "at least once". A guard that only rejected doubling would
	// pass a flow that stopped compiling, and then silently ship a stale dist to the gates below it.
	const mutated: Record<string, string> = { ...scripts, "verify:full": scripts["verify:full"]!.replace("npm run build && ", "") };
	assert.equal(fullBuildExecutions(mutated, "verify:full"), 0);
	assert.equal(singleBuild(mutated, "verify:full"), false, "zero builds must fail as loudly as two");
});

test("a delegation to something that is not a build is not treated as one", () => {
	// A self-contained graph, so the answer is about the rule rather than about whatever the real
	// package.json happens to contain. Overriding a real script would leave its other entries in
	// place, and the assertion would then be about those rather than about the rule.
	const graph: Record<string, string> = {
		"pre": "npm run suite",
		suite: "npm run leaf",
		leaf: "node --test test/a.test.ts",
		mixed: "npm run build && npm run suite",
	};
	assert.deepEqual(unregisteredBuildAliases(graph), [], "delegating to a test suite is not delegating to a build");
	assert.deepEqual(unregisteredBuildAliases({ ...graph, alias: "npm run build" }), ["alias"], "but delegating to a build is");
	assert.deepEqual(
		unregisteredBuildAliases({ ...graph, "build:deps": "node scripts/build-deps.js" }),
		[],
		"a script that happens to be named build:* but does not delegate is not a full build",
	);
});
