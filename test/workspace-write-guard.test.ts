import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthStorage } from "../core/platform/config/auth-storage.js";
import { DefaultResourceLoader } from "../core/platform/config/resource-loader.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";
import { ModelRegistry } from "../core/model-registry.js";
import { createAgentSession } from "../core/runtime/sdk.js";
import { SessionManager } from "../core/session/session-manager.js";
import { createWorkspaceWriteGuard, createWriteTool, isPathWithinRoot } from "../core/tools/index.js";

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

test("workspace write guard allows only paths inside the workspace root", async () => {
	const cwd = "/tmp/catui-project";

	assert.equal(isPathWithinRoot("/tmp/catui-project/file.ts", cwd), true);
	assert.equal(isPathWithinRoot("/tmp/catui-project/nested/file.ts", cwd), true);
	assert.equal(isPathWithinRoot("/tmp/catui-project-other/file.ts", cwd), false);
	assert.equal(isPathWithinRoot("/tmp/outside/file.ts", cwd), false);

	const realCwd = createTempDir("catui-write-guard-");
	try {
		const guard = createWorkspaceWriteGuard(realCwd);
		await assert.doesNotReject(() => guard(join(realCwd, "file.ts")));
		await assert.rejects(() => guard("/tmp/outside/file.ts"), /may only write inside the current workspace/);
	} finally {
		rmSync(realCwd, { recursive: true, force: true });
	}
});

test("workspace write guard rejects writes through a directory symlink", async () => {
	const cwd = createTempDir("catui-symlink-workspace-");
	const outsideDir = createTempDir("catui-symlink-outside-");

	try {
		mkdirSync(join(cwd, "nested"));
		symlinkSync(outsideDir, join(cwd, "nested", "escape"), process.platform === "win32" ? "junction" : "dir");
		const writeTool = createWriteTool(cwd, { beforeWrite: createWorkspaceWriteGuard(cwd) });

		await assert.rejects(
			() => writeTool.execute("symlink-escape", { path: "nested/escape/outside.txt", content: "escaped\n" }),
			/symbolic links/,
		);
		assert.equal(existsSync(join(outsideDir, "outside.txt")), false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(outsideDir, { recursive: true, force: true });
	}
});

test("workspace write guard rejects overwriting a file symlink", async () => {
	const cwd = createTempDir("catui-file-link-workspace-");
	const outsideDir = createTempDir("catui-file-link-outside-");
	const outsidePath = join(outsideDir, "outside.txt");

	try {
		writeFileSync(outsidePath, "original\n", "utf-8");
		symlinkSync(outsidePath, join(cwd, "linked.txt"), "file");
		const writeTool = createWriteTool(cwd, { beforeWrite: createWorkspaceWriteGuard(cwd) });

		await assert.rejects(
			() => writeTool.execute("file-symlink-escape", { path: "linked.txt", content: "changed\n" }),
			/symbolic links/,
		);
		assert.equal(readFileSync(outsidePath, "utf-8"), "original\n");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(outsideDir, { recursive: true, force: true });
	}
});

test("agent-session default edit and write tools reject paths outside cwd", async () => {
	const cwd = createTempDir("catui-workspace-");
	const agentDir = createTempDir("nanocatui-agent-");
	const outsideDir = createTempDir("catui-outside-");

	try {
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const resourceLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
		});
		await resourceLoader.reload();

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			settingsManager,
			resourceLoader,
			sessionManager: SessionManager.create(cwd, agentDir),
			authStorage: AuthStorage.create(join(agentDir, "auth.json")),
			modelRegistry: new ModelRegistry(AuthStorage.create(join(agentDir, "auth.json")), join(agentDir, "models.json")),
		});

		const writeTool = session.state.tools.find((tool) => tool.name === "write");
		const editTool = session.state.tools.find((tool) => tool.name === "edit");
		assert.ok(writeTool);
		assert.ok(editTool);

		await writeTool.execute("inside-write", { path: "inside.txt", content: "inside\n" });
		assert.equal(readFileSync(join(cwd, "inside.txt"), "utf-8"), "inside\n");

		await assert.rejects(
			() => writeTool.execute("outside-write", { path: join(outsideDir, "outside.txt"), content: "outside\n" }),
			/may only write inside the current workspace/,
		);
		assert.equal(existsSync(join(outsideDir, "outside.txt")), false);

		const outsideEditPath = join(outsideDir, "edit.txt");
		writeFileSync(outsideEditPath, "before\n", "utf-8");
		await assert.rejects(
			() => editTool.execute("outside-edit", { path: outsideEditPath, oldText: "before", newText: "after" }),
			/may only write inside the current workspace/,
		);
		assert.equal(readFileSync(outsideEditPath, "utf-8"), "before\n");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(outsideDir, { recursive: true, force: true });
	}
});
