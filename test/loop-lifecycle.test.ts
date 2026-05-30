/**
 * [WHO]: Verifies loop extension scheduler lifecycle ownership and cleanup
 * [FROM]: Depends on node:test, node:assert, node:fs, node:os, node:path, extensions/builtin/loop
 * [TO]: Guards built-in extension metadata lifecycle contract for the default loop extension
 * [HERE]: test/loop-lifecycle.test.ts - focused session_start/session_shutdown coverage for loop timers
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "../core/extensions-host/types.js";
import loopExtension from "../extensions/builtin/loop/index.js";

function createApiHarness(agentDir: string) {
	const handlers = new Map<string, Array<(event?: unknown, ctx?: unknown) => unknown>>();
	const api = {
		cwd: process.cwd(),
		agentDir,
		events: {},
		registerTool: () => {},
		registerMessageRenderer: () => {},
		registerCommand: () => {},
		appendEntry: () => {},
		sendMessage: () => {},
		executeCommand: async () => false,
		isIdle: () => true,
		on: (event: string, handler: (event?: unknown, ctx?: unknown) => unknown) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
	} as unknown as ExtensionAPI;
	return { api, handlers };
}

test("loop clears owned scheduler timers on session shutdown", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "nanopencil-loop-lifecycle-"));
	mkdirSync(join(agentDir, ".nanopencil"), { recursive: true });

	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	const handles: unknown[] = [];
	const cleared = new Set<unknown>();

	globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
		const handle = { handler, timeout, args };
		handles.push(handle);
		return handle as unknown as ReturnType<typeof setInterval>;
	}) as typeof setInterval;
	globalThis.clearInterval = ((handle?: ReturnType<typeof setInterval>) => {
		cleared.add(handle);
	}) as typeof clearInterval;

	try {
		const { api, handlers } = createApiHarness(agentDir);
		await loopExtension(api);

		const start = handlers.get("session_start")?.[0];
		const shutdown = handlers.get("session_shutdown")?.[0];
		assert.ok(start, "Expected loop to register session_start.");
		assert.ok(shutdown, "Expected loop to register session_shutdown.");

		await start({ type: "session_start" }, {});
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(handles.length >= 1, "Expected loop session_start to create at least one timer.");

		await shutdown({ type: "session_shutdown" }, {});
		for (const handle of handles) {
			assert.ok(cleared.has(handle), "Expected loop session_shutdown to clear every interval it created.");
		}
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
		rmSync(agentDir, { recursive: true, force: true });
	}
});
