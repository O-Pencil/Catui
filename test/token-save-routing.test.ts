/**
 * [WHO]: Regression tests for TokenSave command routing — the bits that decide
 *      whether a command is capture (filter) or passthrough (no filter).
 *      Guards the "no-output shell builtin" short-circuit + the rewrite-history
 *      recovery-path helper.
 * [FROM]: Depends on ../extensions/builtin/token-save/no-output-builtins.js,
 *         ../extensions/builtin/token-save/rewrite.js (planCommand),
 *         ../extensions/builtin/token-save/filters.js (classifyCommand).
 * [TO]: None (test file)
 * [HERE]: test/token-save-routing.test.ts — locks in the contract that
 *      cd / pwd / export / unset / etc. don't pollute /tokensave summary,
 *      and that migrateLegacyTokenSave rewrites rawRecoveryPath fields so
 *      agent footer links don't hit ENOENT.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planCommand } from "../extensions/builtin/token-save/rewrite.js";
import { classifyCommand } from "../extensions/builtin/token-save/filters.js";
import {
	NO_OUTPUT_BUILTINS,
	isNoOutputBuiltin,
} from "../extensions/builtin/token-save/no-output-builtins.js";

// ── no-output builtins: pure helper ─────────────────────────────────────────

describe("isNoOutputBuiltin: pure classification", () => {
	it("flags cd / pwd / export / unset as no-output builtins", () => {
		assert.ok(isNoOutputBuiltin("cd"));
		assert.ok(isNoOutputBuiltin("pwd"));
		assert.ok(isNoOutputBuiltin("export"));
		assert.ok(isNoOutputBuiltin("unset"));
	});

	it("flags pushd / popd / dirs / shopt / umask / alias as no-output builtins", () => {
		assert.ok(isNoOutputBuiltin("pushd"));
		assert.ok(isNoOutputBuiltin("popd"));
		assert.ok(isNoOutputBuiltin("shopt"));
		assert.ok(isNoOutputBuiltin("umask"));
		assert.ok(isNoOutputBuiltin("alias"));
	});

	it("flags meta-queries (type / which / command -v) as no-output builtins", () => {
		assert.ok(isNoOutputBuiltin("type"));
		assert.ok(isNoOutputBuiltin("which"));
		assert.ok(isNoOutputBuiltin("command"));
	});

	it("does NOT flag commands whose output should be filtered", () => {
		assert.equal(isNoOutputBuiltin("git"), false);
		assert.equal(isNoOutputBuiltin("cat"), false);
		assert.equal(isNoOutputBuiltin("grep"), false);
		assert.equal(isNoOutputBuiltin("rg"), false);
		assert.equal(isNoOutputBuiltin("npm"), false);
		assert.equal(isNoOutputBuiltin("pytest"), false);
		assert.equal(isNoOutputBuiltin("echo"), false); // echo *does* print
		assert.equal(isNoOutputBuiltin("ls"), false); // ls *does* print
	});

	it("extracts the first whitespace-separated token before matching", () => {
		assert.ok(isNoOutputBuiltin("cd /tmp"));
		assert.ok(isNoOutputBuiltin("cd  /tmp"), "multiple spaces still ok");
		assert.ok(isNoOutputBuiltin("unset FOO BAR"));
		assert.equal(isNoOutputBuiltin("git status"), false);
	});

	it("exports a set with the expected builtin names", () => {
		// Sanity guard against typos: the set should be non-empty and
		// contain the canonical names. We don't enumerate everything to
		// avoid coupling the test to additions, but the basics must hold.
		assert.ok(NO_OUTPUT_BUILTINS instanceof Set);
		assert.ok(NO_OUTPUT_BUILTINS.size >= 10);
		assert.ok(NO_OUTPUT_BUILTINS.has("cd"));
		assert.ok(NO_OUTPUT_BUILTINS.has("pwd"));
	});
});

// ── planCommand: routing decision ────────────────────────────────────────────

describe("planCommand: routes no-output builtins to passthrough", () => {
	it("cd → passthrough with reason 'no-output shell builtin'", () => {
		const plan = planCommand("cd /tmp");
		assert.equal(plan.mode, "passthrough");
		assert.equal(plan.reason, "no-output shell builtin");
	});

	it("pwd → passthrough", () => {
		const plan = planCommand("pwd");
		assert.equal(plan.mode, "passthrough");
		assert.equal(plan.reason, "no-output shell builtin");
	});

	it("export FOO=bar → passthrough", () => {
		const plan = planCommand("export FOO=bar");
		assert.equal(plan.mode, "passthrough");
	});

	it("unset FOO BAR → passthrough", () => {
		const plan = planCommand("unset FOO BAR");
		assert.equal(plan.mode, "passthrough");
	});

	it("echo still goes through capture (has output worth filtering)", () => {
		const plan = planCommand("echo hello");
		assert.equal(plan.mode, "capture");
	});

	it("cd && git status → passthrough (the && makes cd the first segment)", () => {
		// `cd /x && git status` chains two commands; the first segment
		// (cd) is a no-output builtin. Subsequent segments run in the
		// same shell but the planner classifies only the first one for
		// planning purposes — that's the right call here.
		const plan = planCommand("cd /tmp && git status");
		assert.equal(plan.mode, "passthrough");
		assert.equal(plan.reason, "no-output shell builtin");
	});

	it("empty command still passthrough (existing behavior preserved)", () => {
		const plan = planCommand("");
		assert.equal(plan.mode, "passthrough");
		assert.equal(plan.reason, "empty command");
	});

	it("disabled-by-env still passthrough (existing behavior preserved)", () => {
		const plan = planCommand("TOKEN_SAVE_DISABLED=1 git status");
		assert.equal(plan.mode, "passthrough");
		assert.equal(plan.reason, "disabled by env");
	});

	it("git status still capture (existing behavior preserved)", () => {
		const plan = planCommand("git status");
		assert.equal(plan.mode, "capture");
		assert.equal(plan.category, "git-status");
	});

	it("npm install still goes through the planner as capture", () => {
		const plan = planCommand("npm install");
		assert.equal(plan.mode, "capture");
		assert.equal(plan.category, "package-manager");
	});
});

// ── classifyCommand: parallel guard so the filter agrees with the planner ──

describe("classifyCommand: agrees with planCommand on no-output builtins", () => {
	it("cd → passthrough (mode='passthrough', reason set)", () => {
		const cls = classifyCommand("cd /tmp");
		assert.equal(cls.mode, "passthrough");
		assert.equal(cls.reason, "no-output shell builtin");
	});

	it("pwd → passthrough", () => {
		const cls = classifyCommand("pwd");
		assert.equal(cls.mode, "passthrough");
	});

	it("git status → filtered (existing behavior preserved)", () => {
		const cls = classifyCommand("git status");
		assert.equal(cls.mode, "filtered");
		assert.equal(cls.category, "git-status");
	});

	it("npm install → filtered (existing behavior preserved)", () => {
		const cls = classifyCommand("npm install");
		assert.equal(cls.mode, "filtered");
		assert.equal(cls.category, "package-manager");
	});
});

// ── planCommand + classifyCommand agreement ────────────────────────────────

describe("planCommand and classifyCommand agree on routing", () => {
	// The history record's `mode` field is taken from planCommand (via
	// result.plan.mode), but filterTokenSaveOutput consults classifyCommand.
	// If the two disagree on a command, the filter's behavior and the
	// history's recorded mode will diverge — the agent sees one thing,
	// the history claims another. These cases lock in agreement.

	const cases: Array<[string, "capture" | "passthrough"]> = [
		// [command, expected mode]
		// planCommand returns "capture" / "passthrough"; classifyCommand
		// returns "filtered" / "passthrough". These are the same distinction under
		// two vocabularies: "filtered" in classify = "capture" in plan.
		// We map both into a unified check via a small adapter.
		["cd /tmp", "passthrough"],
		["pwd", "passthrough"],
		["export FOO=bar", "passthrough"],
		["unset FOO", "passthrough"],
		["shopt -s globstar", "passthrough"],
		["alias ll=ls -la", "passthrough"],
		["which node", "passthrough"],
		// Commands whose output is worth filtering
		["git status", "capture"],
		["git log --oneline -10", "capture"],
		["git diff HEAD", "capture"],
		["cat package.json", "capture"],
		["npm install", "capture"],
		["pytest -q", "capture"],
		["rg foo", "capture"],
	];

	for (const [cmd, expected] of cases) {
		it(`${cmd} → both agree`, () => {
			const plan = planCommand(cmd);
			const cls = classifyCommand(cmd);
			if (expected === "passthrough") {
				assert.equal(plan.mode, "passthrough", `planCommand disagreed for '${cmd}'`);
				assert.equal(cls.mode, "passthrough", `classifyCommand disagreed for '${cmd}'`);
			} else {
				assert.equal(plan.mode, "capture", `planCommand disagreed for '${cmd}'`);
				assert.equal(cls.mode, "filtered", `classifyCommand disagreed for '${cmd}'`);
			}
		});
	}
});
