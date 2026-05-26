/**
 * [WHO]: Simplify extension smoke tests for shell-safe git access and workspace guards
 * [FROM]: Depends on node:test, node:fs, node:child_process, extensions/optional/simplify
 * [TO]: Consumed by extension quality verification
 * [HERE]: test/simplify-extension.test.ts - optional simplify hardening coverage
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { __testUtils } from "../extensions/optional/simplify/index.js";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

test("simplify git diff handles shell metacharacters in filenames", () => {
	const cwd = mkdtempSync(join(tmpdir(), "nanopencil-simplify-"));
	try {
		git(cwd, ["init"]);
		git(cwd, ["config", "user.email", "test@example.com"]);
		git(cwd, ["config", "user.name", "Test"]);

		const fileName = "weird \"name; touch pwned.ts";
		writeFileSync(join(cwd, fileName), "const value = true;\n", "utf-8");
		git(cwd, ["add", fileName]);
		git(cwd, ["commit", "-m", "initial"]);

		writeFileSync(join(cwd, fileName), "const value = false;\n", "utf-8");
		const diff = __testUtils.getFileDiff(cwd, fileName);

		assert.match(diff, /const value = false/);
		assert.equal(existsSync(join(cwd, "pwned.ts")), false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("simplify refuses paths outside the workspace", () => {
	const cwd = mkdtempSync(join(tmpdir(), "nanopencil-simplify-path-"));
	try {
		assert.equal(__testUtils.resolveWorkspaceFile(cwd, "../outside.ts"), undefined);
		assert.equal(__testUtils.resolveWorkspaceFile(cwd, "/tmp/outside.ts"), undefined);
		assert.equal(__testUtils.resolveWorkspaceFile(cwd, "src/index.ts"), join(cwd, "src", "index.ts"));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("simplify test command detection uses argument arrays", () => {
	const cwd = mkdtempSync(join(tmpdir(), "nanopencil-simplify-tests-"));
	try {
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }), "utf-8");
		assert.deepEqual(__testUtils.detectTestCommand(cwd), {
			command: "npm",
			args: ["test"],
			label: "npm test",
		});

		rmSync(join(cwd, "package.json"), { force: true });
		mkdirSync(join(cwd, "pkg"), { recursive: true });
		assert.equal(__testUtils.runTests(join(cwd, "pkg")).success, true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
