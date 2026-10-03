/**
 * [WHO]: Pins that CI and the verification plan agree in both directions, and that neither scanner has a blind spot
 * [FROM]: Depends on node:test/assert/fs/os/path, the real workflow files, and the shared scanner
 * [TO]: Consumed by test:contract; rechecks S02 CI parity under the current workflows
 * [HERE]: test/verification-ci-parity-recheck.test.ts - CI/plan parity recheck
 *
 * The existing contract asserted one direction: every required plan command runs in CI. The other
 * direction — CI running something the plan never describes — was only checked for raw
 * `node --test` steps, so a CI step invoking an npm script outside the plan passed both. This
 * rechecks both directions and makes the exceptions explicit.
 *
 * There are real exceptions today. Listing them in one place with a reason each is what makes the
 * parity contract enforceable: a *new* off-plan step is then distinguishable from these, instead of
 * hiding among them.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CI_STEP_ALLOWANCES,
	ciNpmRuns,
	ciRawTestRuns,
	staleAllowances,
	unaccountedCiSteps,
} from "./helpers/verification-ci.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");
const plan = JSON.parse(readFileSync(join(ROOT, ".dev-docs", "vibe-coding", "verification-plan.json"), "utf8")) as {
	commands: { id: string; command: string; required?: boolean }[];
};

/** A throwaway workflow directory, so a counterexample never touches the real CI config. */
function withWorkflows(build: (file: string, name: string) => void, run: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "catui-verification-ci-"));
	try {
		build("", "ci.yml");
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function workflow(dir: string, name: string, body: string): void {
	writeFileSync(join(dir, name), body, "utf8");
}

test("CI runs every required plan command", () => {
	const inCI = new Set(ciNpmRuns(WORKFLOW_DIR).map((run) => run.command));
	const missing = plan.commands
		.filter((command) => command.required)
		.filter((command) => !inCI.has(command.command))
		.map((command) => `${command.id} (${command.command})`);
	assert.deepEqual(missing, [], `Required plan commands never run in CI: ${missing.join(", ")}`);
});

const PLAN_COMMANDS = plan.commands.map((command) => command.command);

test("every npm step CI runs is either a plan command or an accounted exception", () => {
	// The direction the existing contract did not check. A CI step outside the plan is either a step
	// the plan should describe, or a claim someone has to justify in one place.
	const unaccounted = unaccountedCiSteps(WORKFLOW_DIR, PLAN_COMMANDS);
	assert.deepEqual(
		unaccounted,
		[],
		`CI runs npm steps the plan does not describe and nobody has accounted for: ${JSON.stringify(unaccounted)}`,
	);
});

test("no CI step bypasses the npm scripts with a raw node --test", () => {
	const raw = ciRawTestRuns(WORKFLOW_DIR).map((run) => `${run.file}: ${run.line}`);
	assert.deepEqual(raw, [], `CI must invoke test suites through npm scripts: ${raw.join(", ")}`);
});

test("every exception on the allowance list still explains a step that exists", () => {
	// An allowance is a claim about CI. Once the step it describes is gone, the entry is a free pass
	// for anything anyone adds later with that name, so it is reported instead of left to rot.
	assert.deepEqual(
		staleAllowances(WORKFLOW_DIR),
		[],
		`allowance entries that match nothing in CI: ${staleAllowances(WORKFLOW_DIR).join(", ")}`,
	);
	for (const allowance of CI_STEP_ALLOWANCES) {
		assert.ok(allowance.reason.trim().length > 0, `${allowance.command} is on the allowance list with no reason`);
	}
});

test("the scanner sees every workflow file, not only .yml", () => {
	// The existing scanners filtered on ".yml" alone. A workflow added as ".yaml" would have been
	// invisible to the entire contract: the tests would pass while CI ran something undescribed.
	const files = readdirSync(WORKFLOW_DIR).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
	assert.ok(files.length > 0, "precondition: the repository has workflow files");

	const withYaml = mkdtempSync(join(tmpdir(), "catui-verification-yaml-"));
	try {
		workflow(withYaml, "extra.yaml", "jobs:\n  a:\n    steps:\n      - run: npm run build\n");
		const seen = ciNpmRuns(withYaml).map((run) => run.file);
		assert.deepEqual(seen, ["extra.yaml"], "a .yaml workflow must be scanned, not skipped");
	} finally {
		rmSync(withYaml, { recursive: true, force: true });
	}
});

test("counterexample: dropping the evolution boundary step from CI is caught", () => {
	// The specific removal the feature names. Same scanner, same check, one fewer step.
	withWorkflows(
		(_file, name) => {
			const before = [...readdirSync(WORKFLOW_DIR).filter((entry) => entry.endsWith(".yml"))].sort();
			assert.ok(before.includes(name), "precondition: ci.yml exists");
		},
		(dir) => {
			const evolutionStep = plan.commands.find((command) => command.id === "evolution-boundary-tests");
			assert.ok(evolutionStep, "precondition: the plan declares the evolution boundary stage");
			workflow(dir, "ci.yml", "jobs:\n  a:\n    steps:\n      - run: npm run verify:dip\n");
			workflow(dir, "quality.yml", "jobs:\n  a:\n    steps:\n      - run: npm run verify:quality\n");

			const inCI = new Set(ciNpmRuns(dir).map((run) => run.command));
			const missing = plan.commands
				.filter((command) => command.required)
				.filter((command) => !inCI.has(command.command))
				.map((command) => command.id);
			assert.ok(
				missing.includes("evolution-boundary-tests"),
				`removing that step must be reported, got ${JSON.stringify(missing.slice(0, 5))}`,
			);
		},
	);
});

test("counterexample: a raw node --test step in CI is caught", () => {
	withWorkflows(
		() => {},
		(dir) => {
			workflow(dir, "ci.yml", "jobs:\n  a:\n    steps:\n      - run: node --test test/foo.test.ts\n");
			const raw = ciRawTestRuns(dir);
			assert.equal(raw.length, 1);
			assert.match(raw[0]!.line, /node --test/);
		},
	);
});

test("counterexample: a CI step outside the plan that is not accounted for is caught", () => {
	// The gap the one-directional assertion had. A plan-valid CI config with an off-plan npm step
	// must fail, or the allowance list has no meaning.
	withWorkflows(
		() => {},
		(dir) => {
			workflow(dir, "ci.yml", plan.commands.map((command) => `      - run: ${command.command}`).join("\n"));
			assert.deepEqual(unaccountedCiSteps(dir, PLAN_COMMANDS), [], "precondition: a plan-complete CI config has nothing unaccounted for");

			workflow(dir, "rogue.yml", "jobs:\n  a:\n    steps:\n      - run: npm run test:undeclared\n");
			const unaccounted = unaccountedCiSteps(dir, PLAN_COMMANDS);
			assert.equal(unaccounted.length, 1);
			assert.equal(unaccounted[0]!.command, "npm run test:undeclared");
		},
	);
});

test("counterexample: a CI-only step cannot borrow a name from the allowance list to slip by", () => {
	withWorkflows(
		() => {},
		(dir) => {
			workflow(dir, "ci.yml", "jobs:\n  a:\n    steps:\n      - run: npm run build:deps\n");
			assert.deepEqual(
				unaccountedCiSteps(dir, PLAN_COMMANDS),
				[],
				"precondition: an accounted command is allowed no matter where it appears",
			);
		},
	);
});

test("counterexample: an allowance entry that matches nothing is reported as stale", () => {
	withWorkflows(
		() => {},
		(dir) => {
			workflow(dir, "ci.yml", "jobs:\n  a:\n    steps:\n      - run: npm run verify:dip\n");
			const stale = staleAllowances(dir, [
				{ command: "npm run test:source-evolution", reason: "no longer run in CI" },
			]);
			assert.deepEqual(stale, ["npm run test:source-evolution"], "a stale allowance is a standing free pass and must be reported");
		},
	);
});
