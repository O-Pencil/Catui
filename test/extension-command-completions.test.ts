import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RegisteredCommand } from "../core/extensions/types.js";
import debugExtension from "../extensions/defaults/debug/index.js";
import loopExtension from "../extensions/defaults/loop/index.js";
import subagentExtension from "../extensions/defaults/subagent/index.js";
import tokenSaveExtension from "../extensions/defaults/token-save/index.js";

type CapturedCommand = Omit<RegisteredCommand, "name">;

function createExtensionHarness() {
	const commands = new Map<string, CapturedCommand>();
	const messages: Array<{ content: unknown; display?: boolean }> = [];
	const notifications: string[] = [];
	const statuses: string[] = [];
	const api = {
		cwd: process.cwd(),
		agentDir: process.cwd(),
		registerCommand: (name: string, options: CapturedCommand) => commands.set(name, options),
		registerMessageRenderer: () => {},
		registerTool: () => {},
		on: () => {},
		appendEntry: () => {},
		executeCommand: async () => false,
		isIdle: () => true,
		sendMessage: (message: { content: unknown; display?: boolean }) => messages.push(message),
		sendUserMessage: () => {},
		events: { on: () => {}, emit: () => {} },
	};
	const ctx = {
		cwd: process.cwd(),
		hasUI: true,
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus: (_key: string, text?: string) => statuses.push(text ?? ""),
		},
	};
	return { api, commands, ctx, messages, notifications, statuses };
}

test("debug command advertises and runs quick preference diagnostics", async () => {
	const previousMemoryDir = process.env.NANOMEM_MEMORY_DIR;
	const memoryDir = mkdtempSync(join(tmpdir(), "nanopencil-debug-prefs-"));
	mkdirSync(memoryDir, { recursive: true });
	process.env.NANOMEM_MEMORY_DIR = memoryDir;

	try {
		const harness = createExtensionHarness();
		await debugExtension(harness.api as never);

		const debug = harness.commands.get("debug");
		assert.ok(debug);
		assert.match(debug.description ?? "", /Check NanoPencil health/);
		assert.deepEqual(debug.getArgumentCompletions?.("pre")?.map((item) => item.value), ["preferences"]);

		await debug.handler("preferences", harness.ctx as never);
		assert.match(String(harness.messages.at(-1)?.content ?? ""), /Preferences/);

		const setLocale = harness.commands.get("set-locale");
		assert.ok(setLocale);
		assert.deepEqual(setLocale.getArgumentCompletions?.("z")?.map((item) => item.value), ["zh"]);
	} finally {
		if (previousMemoryDir === undefined) {
			delete process.env.NANOMEM_MEMORY_DIR;
		} else {
			process.env.NANOMEM_MEMORY_DIR = previousMemoryDir;
		}
		rmSync(memoryDir, { recursive: true, force: true });
	}
});

test("tokensave command exposes first-argument completions", () => {
	const harness = createExtensionHarness();
	tokenSaveExtension(harness.api as never);

	const tokensave = harness.commands.get("tokensave");
	assert.ok(tokensave);
	assert.match(tokensave.description ?? "", /shell output was shortened/);
	assert.deepEqual(tokensave.getArgumentCompletions?.("hi")?.map((item) => item.value), ["history"]);
	assert.deepEqual(tokensave.getArgumentCompletions?.("re")?.map((item) => item.value), ["reload"]);
});

test("loop command exposes scheduler subcommands and flags", async () => {
	const harness = createExtensionHarness();
	await loopExtension(harness.api as never);

	const loop = harness.commands.get("loop");
	assert.ok(loop);
	assert.deepEqual(loop.getArgumentCompletions?.("sta")?.map((item) => item.value), ["status"]);
	assert.deepEqual(loop.getArgumentCompletions?.("--q")?.map((item) => item.value), ["--quiet"]);
	assert.ok(loop.getArgumentCompletions?.("")?.some((item) => item.value === "every"));
});

test("subagent commands expose root actions and write flag completions", async () => {
	const harness = createExtensionHarness();
	await subagentExtension(harness.api as never);

	const subagent = harness.commands.get("subagent");
	assert.ok(subagent);
	assert.deepEqual(subagent.getArgumentCompletions?.("sta")?.map((item) => item.value), ["status"]);

	const run = harness.commands.get("subagent:run");
	assert.ok(run);
	assert.deepEqual(run.getArgumentCompletions?.("--w")?.map((item) => item.value), ["--write"]);
	assert.equal(harness.commands.get("subagent:status")?.getArgumentCompletions?.("sta"), null);
});
