/**
 * [WHO]: Verifies S04 Soul-hint removal from live Presence paths and the awakening candidate switch
 * [FROM]: Depends on node:test/assert/fs/os/path, the presence extension module, and a temp memory root
 * [TO]: Consumed by test:runtime-owners; establishes structural and behavioral evidence for S04
 * [HERE]: test/presence-soul-cleanup.test.ts - Presence suspended-Soul and awakening-candidate coverage
 *
 * Isolation contract: every test points NANOMEM_MEMORY_DIR at a per-test temp directory and clears
 * NANO_PERSONA_DIR, so no run reads or writes the developer's live ~/.catui data. Every harness that
 * starts the presence loop is torn down through session_shutdown, so the 15s idle interval and the
 * retrying opening timeout never outlive a test.
 *
 * Scope limit: this file proves the removed Soul read, the candidate's absent model call, and the
 * candidate's absent prompt injection. It does not compare greeting quality between variants; that
 * requires the S09 paired provider experiments and remains unrun.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import presenceExtension, { __testUtils } from "../extensions/builtin/presence/index.js";
import type { ExtensionAPI, ExtensionContext } from "../core/extensions-host/types.js";

type Bootstrap = { appendSystemPrompt?: string };

/** Generous upper bound. The positive case below proves this bound is actually sufficient. */
const SETTLE_MS = 3_000;

const SOURCE = readFileSync(join(process.cwd(), "extensions", "builtin", "presence", "index.ts"), "utf8");

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until the predicate returns a truthy value or the bound elapses. */
async function waitUntil<T>(produce: () => T | undefined | false, boundMs = SETTLE_MS): Promise<T | undefined> {
	const deadline = Date.now() + boundMs;
	for (;;) {
		const value = produce();
		if (value) return value;
		if (Date.now() >= deadline) return undefined;
		await sleep(10);
	}
}

/**
 * Give each test its own memory root and clear persona inheritance, then restore the ambient
 * environment afterwards. Presence would otherwise resolve ~/.catui/agent/memory.
 */
function useIsolatedMemoryRoot(t: TestContext): { memoryDir: string } {
	const previousMemoryDir = process.env.NANOMEM_MEMORY_DIR;
	const previousPersonaDir = process.env.NANO_PERSONA_DIR;
	const previousAwakening = process.env.CATUI_PRESENCE_AWAKENING;
	const root = mkdtempSync(join(tmpdir(), "catui-presence-s04-"));
	process.env.NANOMEM_MEMORY_DIR = join(root, "memory");
	delete process.env.NANO_PERSONA_DIR;
	t.after(() => {
		restoreEnv("NANOMEM_MEMORY_DIR", previousMemoryDir);
		restoreEnv("NANO_PERSONA_DIR", previousPersonaDir);
		restoreEnv("CATUI_PRESENCE_AWAKENING", previousAwakening);
		rmSync(root, { recursive: true, force: true });
	});
	return { memoryDir: process.env.NANOMEM_MEMORY_DIR };
}

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

interface Harness {
	api: ExtensionAPI;
	emit: (event: string, payload?: unknown) => unknown;
	handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>;
	shutdown: () => void;
}

/**
 * Minimal ExtensionContext over a real ExtensionAPI registration. `t` is required so a harness that
 * starts the presence loop is always shut down, releasing its timers.
 */
function createHarness(t: TestContext, overrides: Partial<ExtensionContext> = {}): Harness {
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
	const api = {
		cwd: process.cwd(),
		agentDir: process.cwd(),
		on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerMessageRenderer() {},
	} as unknown as ExtensionAPI;

	const ctx = {
		hasUI: false,
		getSettings: () => ({}),
		getSoulManager: () => undefined,
		model: undefined,
		...overrides,
	} as unknown as ExtensionContext;

	const emit = (event: string, payload: unknown = {}): unknown => {
		const results = (handlers.get(event) ?? []).map((handler) => handler(payload, ctx));
		return results[0] as Bootstrap | undefined;
	};

	// Unconditional: a harness that never started the loop simply has nothing to clear.
	t.after(() => emit("session_shutdown", { type: "session_shutdown" }));

	return { api, handlers, emit, shutdown: () => emit("session_shutdown", { type: "session_shutdown" }) };
}

/** A UI-capable context: startPresenceLoop only runs its timers when hasUI is true. */
function uiContext(overrides: Partial<ExtensionContext> = {}): Partial<ExtensionContext> {
	return {
		hasUI: true,
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: { onTerminalInput: () => () => {}, getEditorText: () => "" },
		...overrides,
	} as unknown as Partial<ExtensionContext>;
}

test("production Presence paths no longer read the suspended Soul manager", () => {
	// generatePresenceLine and generateAwakening previously called ctx.getSoulManager().
	const soulReads = [...SOURCE.matchAll(/ctx\.getSoulManager\(\)/g)];
	assert.equal(soulReads.length, 0, `Expected no live getSoulManager() read, found ${soulReads.length}.`);
	// The pure normalizer stays for the suspended-Soul restore path and its ordering tests.
	assert.equal(typeof (__testUtils as Record<string, unknown>).collectSoulHints, "function");
	assert.equal(typeof (__testUtils as Record<string, unknown>).buildPresenceSystemPrompt, "function");
});

test("the default host really returns undefined for getSoulManager", () => {
	// Proves the removal above is not a behavior change on any reachable host.
	const bindings = readFileSync(join(process.cwd(), "core", "runtime", "extension-core-bindings.ts"), "utf8");
	assert.match(bindings, /getSoulManager: \(\) => undefined/);
	const session = readFileSync(join(process.cwd(), "core", "runtime", "agent-session.ts"), "utf8");
	assert.match(
		session,
		/@deprecated NanoSoul is suspended; always undefined\.[\s\S]{0,80}get soulManager\(\): unknown \| undefined \{\s*return undefined;/,
	);
});

test("shipped default still generates awakening and injects internal orientation", async (t) => {
	useIsolatedMemoryRoot(t);
	delete process.env.CATUI_PRESENCE_AWAKENING;
	let completeCalls = 0;
	let resolveCalled: (() => void) | undefined;
	const called = new Promise<void>((resolve) => {
		resolveCalled = resolve;
	});
	const harness = createHarness(t, uiContext({
		model: { id: "offline-test" },
		modelRegistry: { getApiKey: async () => "key" } as never,
		completeSimple: async () => {
			completeCalls += 1;
			resolveCalled?.();
			return "I remember where we left off.";
		},
	}) as unknown as Partial<ExtensionContext>);
	await presenceExtension(harness.api);
	harness.emit("session_start", { type: "session_start" });

	// Await the actual call rather than sleeping a guessed interval.
	await called;
	assert.equal(completeCalls, 1, "default behavior must remain unchanged pending quality evidence");

	// The stub resolving does not mean the extension has stored the result yet: it assigns
	// state.awakening after awaiting. Poll the observable effect instead of guessing a delay.
	const injected = await waitUntil(() => {
		const result = harness.emit("before_agent_start", { type: "before_agent_start", prompt: "hi", systemPrompt: "base" });
		return /## Your Internal Orientation/.test(result?.appendSystemPrompt ?? "") ? result : undefined;
	});
	assert.ok(injected, "default path must inject the internal-orientation block");
	assert.match(injected?.appendSystemPrompt ?? "", /I remember where we left off\./);
});

test("candidate switch makes no awakening call and injects no orientation block", async (t) => {
	useIsolatedMemoryRoot(t);
	process.env.CATUI_PRESENCE_AWAKENING = "off";
	let completeCalls = 0;
	let soulReads = 0;
	const harness = createHarness(t, uiContext({
		model: { id: "offline-test" },
		modelRegistry: { getApiKey: async () => "key" } as never,
		completeSimple: async () => {
			completeCalls += 1;
			return "orientation thought";
		},
		getSoulManager: () => {
			soulReads += 1;
			return undefined;
		},
	}) as unknown as Partial<ExtensionContext>);
	await presenceExtension(harness.api);
	harness.emit("session_start", { type: "session_start" });

	// The previous test proved a real awakening call completes well inside this bound, so waiting
	// it out here is an actual negative observation rather than an unproven assumption.
	await sleep(SETTLE_MS);

	assert.equal(completeCalls, 0, "candidate must not make the separate awakening model call");
	assert.equal(soulReads, 0, "candidate must not read the suspended Soul manager");
	const injected = harness.emit("before_agent_start", { type: "before_agent_start", prompt: "hi", systemPrompt: "base" });
	assert.equal(injected, undefined, "candidate must not inject the internal-orientation block");
});

test("headless and settings-disabled Presence stay inert", async (t) => {
	useIsolatedMemoryRoot(t);
	process.env.CATUI_PRESENCE_AWAKENING = "off";

	// Headless: no UI, so no opening, no idle work, no awakening.
	const headless = createHarness(t, { hasUI: false });
	await presenceExtension(headless.api);
	headless.emit("session_start", { type: "session_start" });
	headless.emit("session_ready", { type: "session_ready" });
	assert.equal(headless.emit("before_agent_start", { type: "before_agent_start", prompt: "hi", systemPrompt: "base" }), undefined);

	// Settings-disabled with a UI: still inert.
	const disabled = createHarness(t, uiContext({
		getSettings: () => ({ presence: { enabled: false } }),
	}));
	await presenceExtension(disabled.api);
	disabled.emit("session_start", { type: "session_start" });
	disabled.emit("session_ready", { type: "session_ready" });
	await sleep(200);
	assert.equal(disabled.emit("before_agent_start", { type: "before_agent_start", prompt: "hi", systemPrompt: "base" }), undefined);
});

test("session_shutdown clears the presence loop's timers in both variants", async (t) => {
	useIsolatedMemoryRoot(t);
	for (const mode of ["off", "on"] as const) {
		process.env.CATUI_PRESENCE_AWAKENING = mode;
		const harness = createHarness(t, uiContext());
		await presenceExtension(harness.api);
		harness.emit("session_start", { type: "session_start" });

		// The idle poll is 15s and the opening retry fires immediately; both must be gone after
		// shutdown, otherwise the suite would hang on an open handle.
		const before = process.getActiveResourcesInfo().length;
		harness.shutdown();
		assert.ok(
			process.getActiveResourcesInfo().length < before,
			`awakening=${mode}: session_shutdown must release the presence timers`,
		);
	}
});

test("presence tests never resolve the live ~/.catui memory root", async (t) => {
	// Regression guard for the isolation contract above: if someone drops the env override, the
	// default would silently point at the developer's real memory directory.
	useIsolatedMemoryRoot(t);
	const { getMemoryDir } = await import("../extensions/builtin/presence/presence-memory.js");
	assert.ok(getMemoryDir().startsWith(tmpdir()), `getMemoryDir() escaped the temp root: ${getMemoryDir()}`);
	assert.equal(getMemoryDir(), process.env.NANOMEM_MEMORY_DIR);
});

test("awakening candidate switch is an env experiment gate, not a persisted setting", () => {
	const settings = readFileSync(join(process.cwd(), "core", "platform", "config", "settings-manager.ts"), "utf8");
	assert.equal(/CATUI_PRESENCE_AWAKENING/.test(settings), false, "must not become a persisted user setting.");
	assert.match(SOURCE, /CATUI_PRESENCE_AWAKENING/);
	assert.equal(/mkdtempSync/.test(SOURCE), false);
});
