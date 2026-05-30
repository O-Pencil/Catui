import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthStorage } from "../core/platform/config/auth-storage.js";
import { DefaultResourceLoader } from "../core/platform/config/resource-loader.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";
import { ModelRegistry } from "../core/model-registry.js";
import { createAgentSession } from "../core/runtime/sdk.js";
import { SessionManager } from "../core/session/session-manager.js";
import { createWorkspaceWriteGuard, isPathWithinRoot } from "../core/tools/index.js";

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

test("workspace write guard allows only paths inside the workspace root", () => {
	const cwd = "/tmp/nanopencil-project";

	assert.equal(isPathWithinRoot("/tmp/nanopencil-project/file.ts", cwd), true);
	assert.equal(isPathWithinRoot("/tmp/nanopencil-project/nested/file.ts", cwd), true);
	assert.equal(isPathWithinRoot("/tmp/nanopencil-project-other/file.ts", cwd), false);
	assert.equal(isPathWithinRoot("/tmp/outside/file.ts", cwd), false);

	const guard = createWorkspaceWriteGuard(cwd);
	assert.doesNotThrow(() => guard("/tmp/nanopencil-project/file.ts"));
	assert.throws(() => guard("/tmp/outside/file.ts"), /may only write inside the current workspace/);
});

test("agent-session default edit and write tools reject paths outside cwd", async () => {
	const cwd = createTempDir("nanopencil-workspace-");
	const agentDir = createTempDir("nanopencil-agent-");
	const outsideDir = createTempDir("nanopencil-outside-");

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
