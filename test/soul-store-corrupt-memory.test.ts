import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SoulStore } from "../packages/soul-core/src/store.js";
import { getSoulConfig } from "../packages/soul-core/src/config.js";
import { subscribeDiagnostics } from "../utils/diagnostics.js";
import type { DiagnosticEvent } from "../utils/diagnostics.js";

// When memory.json is corrupted (truncated, partial JSON, etc.) SoulStore must:
//   1. NOT throw — return empty memory and let the agent continue
//   2. NOT print to console — the warning previously leaked to the TUI via
//      `console.warn("Failed to load Soul memory:", error)`
//   3. Route the failure through the unified diagnostic bus so it auto-uploads
//      to pencil_issue_events and dev mode can see it
//
// This locks in the soul-core/src/store.ts fix: console.warn → reportDiagnostic
// across loadProfile / loadMemory / loadEvolutions.

test("SoulStore.loadMemory routes corrupted JSON through diagnostic bus, not console", async () => {
	// Force user runtime so reportDiagnostic skips its own console branch.
	// Otherwise the dist-heuristic fires "dev" and reportDiagnostic prints on
	// purpose — both behaviours are correct, the test specifically asserts the
	// user-runtime invariant: no leakage to console.
	const prev = process.env.NODE_ENV;
	process.env.NODE_ENV = "production";

	const dir = await mkdtemp(join(tmpdir(), "soul-store-corrupt-"));
	const config = getSoulConfig({ soulDir: dir });
	const store = new SoulStore(config);

	const fakeMemory = '{"successes":[{"id":"a","approach":"x"';
	await writeFile(join(dir, "memory.json"), fakeMemory, "utf-8");

	const captured: DiagnosticEvent[] = [];
	const unsubscribe = subscribeDiagnostics((event) => {
		if (event.source === "soul.store") captured.push(event);
	});

	const consoleWarnSpy: string[] = [];
	const originalWarn = console.warn;
	console.warn = (...args: unknown[]) => { consoleWarnSpy.push(args.map(String).join(" ")); };

	try {
		const memory = await store.loadMemory();
		assert.deepEqual(memory, { successes: [], failures: [], patterns: [], decisions: [] });
	} finally {
		console.warn = originalWarn;
		unsubscribe();
		if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
	}

	assert.equal(consoleWarnSpy.length, 0, `expected no console.warn in user mode, got: ${consoleWarnSpy.join(" | ")}`);

	assert.ok(captured.length > 0, "expected at least one diagnostic event from soul.store");
	const ev = captured[0];
	assert.equal(ev.severity, "warning");
	assert.equal(ev.category, "persistence");
	assert.equal(ev.fingerprint, "soul.store:loadMemory:parse");
	assert.match(ev.message, /Soul memory/);
});

test("SoulStore.loadProfile routes corrupted JSON through diagnostic bus", async () => {
	const dir = await mkdtemp(join(tmpdir(), "soul-store-corrupt-profile-"));
	const config = getSoulConfig({ soulDir: dir });
	const store = new SoulStore(config);

	await writeFile(join(dir, "profile.json"), '{"id":"x","version"', "utf-8");

	const captured: DiagnosticEvent[] = [];
	const unsubscribe = subscribeDiagnostics((event) => {
		if (event.source === "soul.store") captured.push(event);
	});

	try {
		const profile = await store.loadProfile();
		assert.equal(profile, null);
	} finally {
		unsubscribe();
	}

	const profileEvents = captured.filter((c) => c.fingerprint === "soul.store:loadProfile:parse");
	assert.equal(profileEvents.length, 1, "expected exactly one loadProfile parse diagnostic");
});
