/**
 * [WHO]: Rechecks the verification plan's contract by running its rules against mutated copies of it
 * [FROM]: Depends on node:test/assert/fs/path, package.json, the real plan, and the shared plan rules
 * [TO]: Consumed by test:contract; rechecks S02 plan coverage under the current plan
 * [HERE]: test/verification-plan-coverage-recheck.test.ts - plan coverage recheck
 *
 * The plan rules already exist in the contract. What they did not have was a counterexample, so
 * nothing showed any of them was load-bearing. The plan is a data file, and the rules used to be
 * written inline against the real one — which made counterexampleing them impossible without
 * editing the file the rules exist to protect. The rules now live in a shared helper, and every
 * counterexample here runs a mutated copy.
 *
 * One gap was found while doing it. Every rule is `find`-based, so a duplicated id or command is
 * unreachable by the gate check, the CI parity check, and the verify:full coverage check at once.
 * The current plan has neither, and now says so.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	duplicatedPlanKeys,
	gateViolations,
	MANDATORY_GATES,
	malformedInvocations,
	missingScripts,
	optionalTestGates,
	planStageScripts,
	type VerificationPlan,
} from "./helpers/verification-plan.js";
import { unaccountedCiSteps } from "./helpers/verification-ci.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;
const plan = JSON.parse(readFileSync(join(ROOT, ".dev-docs", "vibe-coding", "verification-plan.json"), "utf8")) as VerificationPlan;

/** A test-running plan command, judged by what it invokes rather than by its id. */
const runsTests = (command: string): boolean => {
	const script = command.replace("npm run ", "");
	const body = scripts[script] ?? "";
	return /test:/.test(script) || /node --test/.test(body);
};

function clone(commands: VerificationPlan["commands"]): VerificationPlan {
	return { commands: commands.map((command) => ({ ...command })) };
}

test("the current plan satisfies every rule the contract enforces", () => {
	assert.deepEqual(malformedInvocations(plan), [], "every plan command must be a bare npm invocation");
	assert.deepEqual(missingScripts(plan, scripts), [], "every plan command must name a real script");
	assert.deepEqual(gateViolations(plan), [], "the mandatory gates must be present, correct, and required");
	assert.deepEqual(optionalTestGates(plan, runsTests), [], "an optional test suite is a suite nobody waits for");
	assert.deepEqual(duplicatedPlanKeys(plan), { ids: [], commands: [] }, "no id or command may be declared twice");
});

test("counterexample: deleting a required command from the plan is caught", async () => {
	const withoutOne = clone(plan.commands.filter((command) => command.id !== "evolution-boundary-tests"));

	// The gate rules alone do not see this: it is not one of the five mandatory gates. What catches
	// it is that CI still runs a script the plan no longer describes.
	const offPlan = unaccountedCiSteps(join(ROOT, ".github", "workflows"), planStageScripts(withoutOne));
	assert.ok(
		offPlan.some((step) => step.command === "npm run test:evolution-boundaries"),
		`a command removed from the plan while CI still runs it must be reported: ${JSON.stringify(offPlan)}`,
	);
	assert.deepEqual(duplicatedPlanKeys(withoutOne), { ids: [], commands: [] }, "and the removal itself introduces no duplicate");
});

test("counterexample: demoting a mandatory gate to required:false is caught", () => {
	const demoted = clone(plan.commands);
	const dip = demoted.commands.find((command) => command.id === "dip")!;
	dip.required = false;

	assert.deepEqual(gateViolations(plan), [], "precondition: the real plan has all five required");
	const violations = gateViolations(demoted);
	assert.ok(violations.some((violation) => violation.startsWith("dip is required:false")), `expected the demotion to be reported, got ${JSON.stringify(violations)}`);
});

test("counterexample: a mandatory gate pointing at the wrong script is caught", () => {
	const redirected = clone(plan.commands);
	redirected.commands.find((command) => command.id === "build")!.command = "npm run build:release";

	const violations = gateViolations(redirected);
	assert.ok(violations.some((violation) => violation.startsWith("build runs ")), `expected the redirect to be reported, got ${JSON.stringify(violations)}`);
});

test("counterexample: removing a mandatory gate entirely is caught", () => {
	const removed = clone(plan.commands.filter((command) => command.id !== "typecheck"));
	const violations = gateViolations(removed);
	assert.ok(violations.includes("missing gate typecheck"), `expected the absence to be reported, got ${JSON.stringify(violations)}`);
});

test("counterexample: making a test suite optional is caught", () => {
	const optional = clone(plan.commands);
	optional.commands.find((command) => command.id === "evolution-boundary-tests")!.required = false;

	assert.deepEqual(optionalTestGates(plan, runsTests), [], "precondition: no suite is optional today");
	const listed = optionalTestGates(optional, runsTests);
	assert.ok(
		listed.some((entry) => entry.startsWith("evolution-boundary-tests")),
		`expected the demotion to be reported, got ${JSON.stringify(listed)}`,
	);
});

test("counterexample: a plan command naming a script that does not exist is caught", () => {
	const phantom = clone(plan.commands);
	phantom.commands.push({ id: "phantom", command: "npm run verify:nothing", required: true });

	assert.deepEqual(missingScripts(plan, scripts), [], "precondition: every real command names a real script");
	const missing = missingScripts(phantom, scripts);
	assert.ok(missing.some((entry) => entry.startsWith("phantom")), `expected the phantom to be reported, got ${JSON.stringify(missing)}`);
});

test("counterexample: a command that is not a bare npm invocation is caught", () => {
	const chained = clone(plan.commands);
	chained.commands.push({ id: "chained", command: "npm run verify:dip && echo done", required: true });

	const malformed = malformedInvocations(chained);
	assert.ok(malformed.some((entry) => entry.startsWith("chained")), `expected the chain to be reported, got ${JSON.stringify(malformed)}`);
});

test("counterexample: a duplicated id is reported, because every lookup is find-based", () => {
	// The shape of a shadowed declaration: the file still reads as correct, and every `find` above
	// returns the first match, so the second entry is invisible to the gate, CI parity, and
	// verify:full coverage checks simultaneously.
	const shadowed = clone(plan.commands);
	const dip = shadowed.commands.find((command) => command.id === "dip")!;
	shadowed.commands.push({ ...dip, command: "npm run verify:quality" });

	const duplicated = duplicatedPlanKeys(shadowed);
	assert.ok(duplicated.ids.includes("dip"), `expected the shadowed id to be reported, got ${JSON.stringify(duplicated.ids)}`);
	assert.ok(duplicated.commands.includes("npm run verify:quality"), `and the shadowed command too, got ${JSON.stringify(duplicated.commands)}`);
	// The gate rule cannot see this shadow: it reads the first matching id, which is the correct
	// entry, and reports a satisfied gate while a wrong one sits behind it. That is precisely why
	// the duplicate rule is a separate check rather than a detail of the gate rule.
});

test("counterexample: a duplicated command under a new id is reported", () => {
	const twin = clone(plan.commands);
	twin.commands.push({ id: "twin", command: "npm run build", required: true });

	const duplicated = duplicatedPlanKeys(twin);
	assert.ok(
		duplicated.commands.includes("npm run build"),
		`the same command listed twice would run twice in the documented flow: ${JSON.stringify(duplicated.commands)}`,
	);
});

test("the mandatory gate list is the one the plan is actually judged against", () => {
	// A guard that named a different set than the assertions use would pass while checking nothing.
	assert.deepEqual([...MANDATORY_GATES].map((gate) => gate.id).sort(), ["build", "dip", "package-boundary", "quality", "typecheck"]);
	for (const gate of MANDATORY_GATES) {
		assert.ok(planStageScripts(plan).includes(gate.script), `${gate.id} must run a script that exists: ${gate.script}`);
	}
});
