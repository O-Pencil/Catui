import assert from "node:assert/strict";
import test from "node:test";
import { createSandboxHook } from "../core/tools/bash.js";

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
	const hook = createSandboxHook({
		allowWritePath: (path) => path.startsWith("/tmp/project/out"),
	});

	const allowed = [
		"mkdir out",
		"touch out/a.txt",
		"echo hi > out/a.txt",
		"cp src.txt out/copy.txt",
		"tee out/result.txt",
	];
	for (const command of allowed) {
		const result = hook({ command, cwd: "/tmp/project", env: {} });
		assert.equal(result.command, command);
	}

	const denied = [
		"mkdir ../outside",
		"touch /tmp/other.txt",
		"echo hi > ../outside.txt",
		"cp src.txt /tmp/other.txt",
	];
	for (const command of denied) {
		const result = hook({ command, cwd: "/tmp/project", env: {} });
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
