import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createAgentSession } from "../core/runtime/sdk.js";
import { DefaultResourceLoader } from "../core/config/resource-loader.js";
import { SettingsManager } from "../core/config/settings-manager.js";
import { SessionManager } from "../core/session/session-manager.js";
import { AuthStorage } from "../core/config/auth-storage.js";
import { ModelRegistry } from "../core/model-registry.js";
import { allTools } from "../core/tools/index.js";
import { setLocale, tValue } from "../core/i18n/index.js";
import { __testUtils } from "../extensions/defaults/presence/index.js";

function presenceExtensionPath(cwd: string): string {
	return join(cwd, "extensions", "defaults", "presence", "index.ts");
}

async function waitForPresenceMessage(messages: Array<{ customType: string; content: unknown }>) {
	const deadline = Date.now() + 1000;
	while (Date.now() < deadline) {
		const opening = messages.find((message) => message.customType === "presence");
		if (opening) return opening;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return messages.find((message) => message.customType === "presence");
}

test("presence-opening: emits an opening message after session_ready", async (t) => {
	const cwd = process.cwd();
	const agentDir = mkdtempSync(join(tmpdir(), "nanopencil-presence-"));
	const originalMemoryDir = process.env.NANOMEM_MEMORY_DIR;
	const originalDelay = process.env.NANOPENCIL_PRESENCE_OPENING_DELAY_MS;
	process.env.NANOMEM_MEMORY_DIR = join(agentDir, "memory");
	process.env.NANOPENCIL_PRESENCE_OPENING_DELAY_MS = "10";

	const settingsManager = SettingsManager.create(cwd, agentDir);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		additionalExtensionPaths: [presenceExtensionPath(cwd)],
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
	t.after(async () => {
		await session.extensionRunner?.emit({ type: "session_shutdown" });
		if (originalMemoryDir === undefined) {
			delete process.env.NANOMEM_MEMORY_DIR;
		} else {
			process.env.NANOMEM_MEMORY_DIR = originalMemoryDir;
		}
		if (originalDelay === undefined) {
			delete process.env.NANOPENCIL_PRESENCE_OPENING_DELAY_MS;
		} else {
			process.env.NANOPENCIL_PRESENCE_OPENING_DELAY_MS = originalDelay;
		}
	});

	const customMessages: Array<{ customType: string; content: unknown }> = [];
	session.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "custom") {
			customMessages.push({
				customType: event.message.customType,
				content: event.message.content,
			});
		}
	});

	await session.bindExtensions({
		uiContext: {
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify: () => {},
			onTerminalInput: () => () => {},
			setStatus: () => {},
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

	await session.extensionRunner?.emit({ type: "session_ready" });

	const opening = await waitForPresenceMessage(customMessages);
	assert.ok(opening);
	assert.equal(typeof opening.content, "string");
	assert.ok(String(opening.content).length > 0);
});

test("presence-i18n: reads array translations for zh fallback lines", () => {
	setLocale("zh");
	try {
		const opening = tValue<string[]>("msg.presence.opening");
		const idle = tValue<string[]>("msg.presence.idle");

		assert.ok(Array.isArray(opening));
		assert.ok(Array.isArray(idle));
		assert.ok((opening as string[]).includes("来了啊。"));
		assert.ok((idle as string[]).includes("还在，有需要随时说。"));
	} finally {
		setLocale("en");
	}
});

test("presence-runtime: resolves bundled packages from dist/packages", { concurrency: false }, async () => {
	const originalCwd = process.cwd();
	const tempRoot = mkdtempSync(join(tmpdir(), "nanopencil-presence-bundled-"));

	try {
		const memDir = join(tempRoot, "dist", "packages", "mem-core");
		const soulDir = join(tempRoot, "dist", "packages", "soul-core");
		mkdirSync(memDir, { recursive: true });
		mkdirSync(soulDir, { recursive: true });

		writeFileSync(
			join(memDir, "index.js"),
			[
				"export class NanoMemEngine {",
				"  constructor(config) { this.config = config; }",
				"}",
				"export function getConfig(overrides = {}) { return overrides; }",
				"",
			].join("\n"),
		);
		writeFileSync(
			join(soulDir, "index.js"),
			[
				"export class SoulManager {",
				"  constructor(options) { this.options = options; }",
				"  async initialize() {}",
				"}",
				"export function getSoulConfig() { return { tone: 'test' }; }",
				"",
			].join("\n"),
		);

		process.chdir(tempRoot);

		const memEntry = __testUtils.resolveBundledPackageEntry("mem-core");
		const soulEntry = __testUtils.resolveBundledPackageEntry("soul-core");
		assert.equal(memEntry, realpathSync(join(memDir, "index.js")));
		assert.equal(soulEntry, realpathSync(join(soulDir, "index.js")));

		const memModule = await __testUtils.importRuntimeModule<{
			NanoMemEngine: new (config: unknown) => { config: unknown };
			getConfig: (overrides?: Record<string, unknown>) => Record<string, unknown>;
		}>(["@pencil-agent/mem-core"], "mem-core");
		const soulModule = await __testUtils.importRuntimeModule<{
			SoulManager: new (options?: unknown) => { options?: unknown; initialize(): Promise<void> };
			getSoulConfig: () => Record<string, unknown>;
		}>(["@pencil-agent/soul-core"], "soul-core");

		assert.ok(memModule?.NanoMemEngine);
		assert.ok(soulModule?.SoulManager);
		assert.deepEqual(memModule?.getConfig({ locale: "zh" }), { locale: "zh" });
		assert.deepEqual(soulModule?.getSoulConfig(), { tone: "test" });
	} finally {
		process.chdir(originalCwd);
	}
});

test("presence-language: detects zh from memory preferences", async () => {
	const locale = await __testUtils.detectLanguageFromMemory({
		memEngine: {
			getAllEntries: async () => ({
				knowledge: [{
					type: "preference",
					tags: ["preference", "language"],
					summary: "用户偏好用中文交流",
				}],
				lessons: [],
			}),
			getAllEpisodes: async () => [],
			searchEntries: async () => [],
		},
	} as any);

	assert.equal(locale, "zh");
});

test("presence-language: detects en when memory says no Chinese", async () => {
	const locale = await __testUtils.detectLanguageFromMemory({
		memEngine: {
			getAllEntries: async () => ({
				knowledge: [{
					type: "preference",
					tags: ["preference", "language"],
					summary: "don't use Chinese, use English",
				}],
				lessons: [],
			}),
			getAllEpisodes: async () => [],
			searchEntries: async () => [],
		},
	} as any);

	assert.equal(locale, "en");
});
