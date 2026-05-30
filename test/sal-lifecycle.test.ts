/**
 * [WHO]: SAL extension lifecycle tests for process listener cleanup
 * [FROM]: Depends on node:test and extensions/builtin/sal
 * [TO]: Consumed by extension quality verification
 * [HERE]: test/sal-lifecycle.test.ts - guards default extension reload/shutdown behavior
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "../core/extensions-host/types.js";
import salExtension from "../extensions/builtin/sal/index.js";

test("sal removes emergency process listeners on session shutdown", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "nanopencil-sal-lifecycle-"));
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
	const beforeExitBefore = process.listenerCount("beforeExit");
	const sighupBefore = process.listenerCount("SIGHUP");
	const sigtermBefore = process.listenerCount("SIGTERM");
	const originalEvalEnabled = process.env.NANOPENCIL_EVAL_ENABLED;
	process.env.NANOPENCIL_EVAL_ENABLED = "0";

	const api = {
		cwd,
		registerFlag: () => {},
		getFlag: () => false,
		registerCommand: () => {},
		on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		events: { emit: () => {} },
	} as unknown as ExtensionAPI;

	try {
		await salExtension(api);
		assert.equal(process.listenerCount("beforeExit"), beforeExitBefore + 1);
		assert.equal(process.listenerCount("SIGHUP"), sighupBefore + 1);
		assert.equal(process.listenerCount("SIGTERM"), sigtermBefore + 1);

		const ctx = {} as ExtensionContext;
		for (const handler of handlers.get("session_shutdown") ?? []) {
			await handler({ type: "session_shutdown" }, ctx);
		}

		assert.equal(process.listenerCount("beforeExit"), beforeExitBefore);
		assert.equal(process.listenerCount("SIGHUP"), sighupBefore);
		assert.equal(process.listenerCount("SIGTERM"), sigtermBefore);
	} finally {
		if (originalEvalEnabled === undefined) {
			delete process.env.NANOPENCIL_EVAL_ENABLED;
		} else {
			process.env.NANOPENCIL_EVAL_ENABLED = originalEvalEnabled;
		}
		rmSync(cwd, { recursive: true, force: true });
	}
});
