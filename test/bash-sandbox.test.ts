/**
 * [WHO]: Verifies Bash sandbox write blocking, approved-path handling, complex syntax rejection, and timeout validation
 * [FROM]: Depends on node:test/assert/path and core/tools/bash
 * [TO]: Run by test:tools and full repository verification
 * [HERE]: test/bash-sandbox.test.ts - Bash sandbox regression coverage
 */

import assert from "node:assert/strict";
import { isAbsolute, relative, resolve } from "node:path";
import test from "node:test";
import { createBashTool, createSandboxHook } from "../core/tools/bash.js";

test("bash-sandbox: blocks common write operations", () => {
	const hook = createSandboxHook();

	const blockedCommands = [
		"rm -rf tmp",
		"git add .",
		"git commit -m 'x'",
		"mkdir output",
		"echo hi > file.txt",
		"tee result.txt",
	];

	for (const command of blockedCommands) {
		const result = hook({
			command,
			cwd: "/tmp/project",
			env: {},
		});
		assert.match(result.command, /Write operations are not allowed in sandbox mode/);
	}
});

test("bash-sandbox: allows read-oriented commands", () => {
	const hook = createSandboxHook();

	const allowedCommands = [
		"rg SubAgent src",
		"find . -name '*.ts'",
		"ls -la",
		"git status --short",
		"git diff --stat",
	];

	for (const command of allowedCommands) {
		const result = hook({
			command,
			cwd: "/tmp/project",
			env: {},
		});
		assert.equal(result.command, command);
	}
});

test("bash-sandbox: allows simple write commands only under approved paths", () => {
	const cwd = resolve("/tmp/project");
	const approvedRoot = resolve(cwd, "out");
	const hook = createSandboxHook({
		allowWritePath: (path) => {
			const relativePath = relative(approvedRoot, path);
			return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
		},
	});

	const allowed = [
		"mkdir out",
		"touch out/a.txt",
		"echo hi > out/a.txt",
		"cp src.txt out/copy.txt",
		"tee out/result.txt",
	];
	for (const command of allowed) {
		const result = hook({ command, cwd, env: {} });
		assert.equal(result.command, command);
	}

	const denied = [
		"mkdir ../outside",
		"touch /tmp/other.txt",
		"echo hi > ../outside.txt",
		"cp src.txt /tmp/other.txt",
	];
	for (const command of denied) {
		const result = hook({ command, cwd, env: {} });
		assert.match(result.command, /Write operations are not allowed in sandbox mode/);
	}
});

test("bash-sandbox: rejects complex write shell syntax even with path allowlist", () => {
	const hook = createSandboxHook({
		allowWritePath: () => true,
	});

	for (const command of ["echo hi > out/a.txt && echo done", "echo $(date) > out/a.txt"]) {
		const result = hook({ command, cwd: "/tmp/project", env: {} });
		assert.match(result.command, /Write operations are not allowed in sandbox mode/);
	}
});

test("bash tool rejects non-positive timeout before execution", async () => {
	let executed = false;
	const tool = createBashTool(process.cwd(), {
		operations: {
			exec: async () => {
				executed = true;
				return { exitCode: 0 };
			},
		},
	});

	await assert.rejects(
		() => tool.execute("bad-timeout", { command: "echo ok", timeout: 0 }),
		/timeout must be a positive number/,
	);
	assert.equal(executed, false);
});
