import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createAgentSession } from "../core/runtime/sdk.js";
import { getBuiltinExtensionPaths } from "../builtin-extensions.js";
import { DefaultResourceLoader } from "../core/platform/config/resource-loader.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";
import { SessionManager } from "../core/session/session-manager.js";
import { AuthStorage } from "../core/platform/config/auth-storage.js";
import { ModelRegistry } from "../core/model-registry.js";
import { allTools } from "../core/tools/index.js";

test("extension-commands: mem-insights creates an HTML report and emits visible status", async () => {
	const cwd = process.cwd();
	const agentDir = mkdtempSync(join(tmpdir(), "nanopencil-ext-"));
	process.env.NANOMEM_MEMORY_DIR = join(agentDir, "memory");

	const settingsManager = SettingsManager.create(cwd, agentDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		additionalExtensionPaths: getBuiltinExtensionPaths(),
	});
	await resourceLoader.reload();

	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.json"));
	const sessionManager = SessionManager.create(cwd, agentDir);

	const { session } = await createAgentSession({
		cwd,
		agentDir,
		resourceLoader,
		settingsManager,
		sessionManager,
		authStorage,
		modelRegistry,
		tools: Object.values(allTools),
	});

	const uiEvents: Array<{ kind: "status" | "notify"; value: string }> = [];
	await session.bindExtensions({
		uiContext: {
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify: (message) => uiEvents.push({ kind: "notify", value: message }),
			onTerminalInput: () => () => {},
			setStatus: (_key, text) => uiEvents.push({ kind: "status", value: text ?? "" }),
			setWorkingMessage: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async () => undefined as never,
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			setEditorComponent: () => {},
			theme: {} as never,
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "not implemented" }),
		},
		commandContextActions: {
			waitForIdle: async () => {},
			newSession: async () => ({ cancelled: false }),
			fork: async () => ({ cancelled: false }),
			navigateTree: async () => ({ cancelled: false }),
			switchSession: async () => ({ cancelled: false }),
			reload: async () => {},
		},
		shutdownHandler: () => {},
		onError: (error) => {
			throw new Error(`${error.extensionPath}: ${error.error}`);
		},
	});

	const outputPath = join(agentDir, "nanomem-insights.html");
	await session.prompt(`/mem-insights ${outputPath}`);

	assert.equal(existsSync(outputPath), true);
	assert.ok(statSync(outputPath).size > 0);
	assert.ok(uiEvents.some((event) => event.kind === "status" && event.value.includes("Generating insights")));
	assert.ok(uiEvents.some((event) => event.kind === "notify" && event.value.includes("generating insights report")));
	assert.ok(uiEvents.some((event) => event.kind === "notify" && event.value.includes("insights report written")));
	await session.extensionRunner?.emit({ type: "session_shutdown" });
});
