/**
 * [WHO]: Pins the stage order the verification plan declares and the order verify:full actually runs
 * [FROM]: Depends on node:test/assert/fs, package.json, and the shared ordering predicate
 * [TO]: Consumed by test:contract; rechecks S02 stage ordering under the current scripts
 * [HERE]: test/verification-stage-order-recheck.test.ts - stage ordering recheck for verify:full
 *
 * An earlier task added the plan-ordering assertion to the verification contract. This rechecks it
 * against the scripts as they stand now, and covers the half it never did: the *runtime* order of
 * `verify:full` itself. A plan can be perfectly ordered while the aggregate script that is supposed
 * to implement it runs its stages in a different order, and nothing in the plan file would notice.
 *
 * The counterexample calls the same predicate the live assertion does. A counterexample that
 * re-implements the rule it is meant to falsify only demonstrates that the copy can be wrong.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { orderingViolations, planStageScriptNames, VERIFICATION_ORDERING_RULES } from "./helpers/verification-order.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;
const plan = JSON.parse(readFileSync(join(ROOT, ".dev-docs", "vibe-coding", "verification-plan.json"), "utf8")) as {
	commands: { id: string; command: string; required?: boolean }[];
};

/** The top-level stages of a script, in the order the `&&` chain runs them. */
function stagesOf(name: string): string[] {
	const body = scripts[name];
	assert.ok(body, `no such npm script: ${name}`);
	return [...body.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]!);
}

test("the plan keeps its stage ordering", () => {
	const violations = orderingViolations(planStageScriptNames(plan));
	assert.deepEqual(violations, [], violations.join("; "));
});

test("verify:full runs its stages in the order the plan declares", () => {
	// The half the plan file cannot check. `verify:full` is what actually gates a release, and it
	// composes the stages itself rather than reading the plan, so a correctly ordered plan says
	// nothing about whether the aggregate honours it.
	const violations = orderingViolations(stagesOf("verify:full"));
	assert.deepEqual(violations, [], violations.join("; "));
});

test("the plan's stages, read as script names, satisfy the same rules", () => {
	// Precondition for the comparison above: the two name spaces line up, so a passing runtime check
	// is about the same rules and not about a coincidence of names.
	const stages = planStageScriptNames(plan);
	assert.deepEqual(orderingViolations(stages), [], "precondition: the two name spaces line up");
	assert.ok(stages.includes("verify:package-boundary:dist"));
	assert.ok(stages.includes("test:artifact"));
});

test("verify:full builds once, and the dist boundary check is downstream of it", () => {
	// Concrete restatement of the two rules, so a failure names the stage rather than a rule id.
	const stages = stagesOf("verify:full");
	assert.ok(stages.includes("build"), `verify:full must build; got ${stages.join(", ")}`);
	assert.ok(stages.includes("verify:package-boundary:dist"), `verify:full must check the dist boundary; got ${stages.join(", ")}`);
	assert.ok(stages.includes("test:artifact"), `verify:full must run the artifact tests; got ${stages.join(", ")}`);
	assert.ok(
		stages.indexOf("build") < stages.indexOf("verify:package-boundary:dist"),
		"the dist boundary check must see a dist that this run produced",
	);
	assert.ok(
		stages.indexOf("verify:package-boundary:dist") < stages.indexOf("test:artifact"),
		"artifact tests must run after the dist boundary check clears the output they consume",
	);
});

test("every ordering rule is about a stage the plan actually declares", () => {
	// A rule naming a stage that does not exist would pass vacuously against a list missing it only
	// because `orderingViolations` reports absence — verify the names are real to begin with.
	const stages = planStageScriptNames(plan);
	for (const rule of VERIFICATION_ORDERING_RULES) {
		assert.ok(stages.includes(rule.before), `plan is missing "${rule.before}" named by ${rule.id}`);
		assert.ok(stages.includes(rule.after), `plan is missing "${rule.after}" named by ${rule.id}`);
	}
});

test("counterexample: moving artifact tests before build is rejected", () => {
	// The mutation the rule exists to catch. Same predicate, scrambled input.
	const stages = planStageScriptNames(plan);
	const scrambled = [
		...stages.filter((stage) => stage === "test:artifact"),
		...stages.filter((stage) => stage !== "test:artifact"),
	];
	assert.deepEqual(orderingViolations(stages), [], "precondition: the real plan satisfies the rules");

	const violations = orderingViolations(scrambled);
	assert.ok(violations.length > 0, "moving artifact tests to the front must break the ordering");
	assert.ok(
		violations.some((violation) => violation.includes("dist-boundary-before-artifact-tests")),
		`expected the dist-boundary rule to fire, got ${JSON.stringify(violations)}`,
	);
});

test("counterexample: moving the dist boundary check before build is rejected", () => {
	const stages = planStageScriptNames(plan);
	const scrambled = [
		...stages.filter((stage) => stage === "verify:package-boundary:dist"),
		...stages.filter((stage) => stage !== "verify:package-boundary:dist"),
	];
	const violations = orderingViolations(scrambled);
	assert.ok(
		violations.some((violation) => violation.includes("build-before-dist-boundary")),
		`expected the build rule to fire, got ${JSON.stringify(violations)}`,
	);
});

test("counterexample: a rule whose stage is missing is reported, not silently satisfied", () => {
	// The failure mode that makes an ordering check decorative: a stage renamed away, leaving the
	// rule with nothing to compare and a green test.
	const stages = planStageScriptNames(plan);
	const withoutDist = stages.filter((stage) => stage !== "verify:package-boundary:dist");
	const violations = orderingViolations(withoutDist);

	assert.ok(violations.length > 0, "a rule about a missing stage must not pass quietly");
	assert.ok(
		violations.every((violation) => violation.includes("is not present")),
		`absence must be its own failure, got ${JSON.stringify(violations)}`,
	);
});

test("counterexample: the aggregate script, scrambled the same way, is rejected", () => {
	// The runtime half has to be falsifiable too, or the plan check above is the only one doing work.
	const stages = stagesOf("verify:full");
	const scrambled = [
		...stages.filter((stage) => stage === "test:artifact"),
		...stages.filter((stage) => stage !== "test:artifact"),
	];
	assert.ok(orderingViolations(scrambled).length > 0, "the same mutation must break the aggregate order too");
});
