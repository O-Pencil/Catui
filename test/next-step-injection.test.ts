/**
 * [WHO]: Provides next-step-injection test suite covering appendSystemPrompt gating and merge order.
 * [FROM]: Depends on core/extensions-host/runner, loader; extensions/builtin/next-step; SettingsManager.
 * [TO]: Consumed by test runner via `node:test`; gates CATUI-13 acceptance.
 * [HERE]: test/next-step-injection.test.ts - direct ExtensionRunner wiring with mocked ExtensionContextActions.getSettings; no real LLM.
 */

/**
 * Tests for CATUI-13: next-step extension injects a Codex-style "suggest next steps"
 * rule via before_agent_start, gated by settings.nextStep.enabled.
 *
 * Coverage:
 * 1. enabled=true (default) → rule text appended to systemPrompt
 * 2. enabled=false → hook returns undefined, systemPrompt unchanged
 * 3. default → getNextStepEnabled() returns true
 * 4. merge order → next-step rule appears BEFORE other hooks' appendSystemPrompt
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { ExtensionRunner } from "../core/extensions-host/runner.js";
import {
	createExtensionRuntime,
	loadExtensionFromFactory,
} from "../core/extensions-host/loader.js";
import { createEventBus } from "../core/runtime/event-bus.js";
import { SessionManager } from "../core/session/session-manager.js";
import { AuthStorage } from "../core/platform/config/auth-storage.js";
import { ModelRegistry } from "../core/model-registry.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";
import nextStepExtension, { NEXT_STEP_RULE } from "../extensions/builtin/next-step/index.js";

const BASE_SYSTEM_PROMPT = "You are Catui, a helpful AI coding assistant.";

async function makeRunner(getSettings: () => SettingsManager["settings"]) {
	const agentDir = mkdtempSync(join(tmpdir(), "catui-nextstep-"));
	const cwd = process.cwd();
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	const sessionManager = SessionManager.create(cwd, agentDir);
	const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.json"));
	const eventBus = createEventBus();
	const runtime = createExtensionRuntime();

	const extension = await loadExtensionFromFactory(
		nextStepExtension,
		cwd,
		agentDir,
		eventBus,
		runtime,
		"<test:next-step>",
	);

	const runner = new ExtensionRunner([extension], runtime, cwd, agentDir, sessionManager, modelRegistry);
	runner.bindCore(
		{
			sendMessage: () => {},
			sendUserMessage: () => {},
			executeCommand: () => Promise.reject(new Error("not used")),
			appendEntry: () => {},
			setSessionName: () => {},
			getSessionName: () => undefined,
			setLabel: () => {},
			getActiveTools: () => [],
			getAllTools: () => [],
			setActiveTools: () => {},
			getCommands: () => [],
			setModel: () => Promise.reject(new Error("not used")),
			getThinkingLevel: () => "off",
			setThinkingLevel: () => {},
		},
		{
			getModel: () => undefined,
			completeSimple: async () => undefined,
			completeSimpleWithUsage: async () => undefined,
			isIdle: () => true,
			abort: () => {},
			clearFollowUpQueue: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: () => {},
			getSystemPrompt: () => BASE_SYSTEM_PROMPT,
			getSoulManager: () => undefined,
			getSettings,
			getSkills: () => [],
		},
	);

	return { runner, agentDir };
}

test("next-step: getNextStepEnabled defaults to true", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "catui-nextstep-"));
	const settingsManager = SettingsManager.create(process.cwd(), agentDir);
	assert.equal(settingsManager.getNextStepEnabled(), true);
});

test("next-step: enabled=true injects NEXT_STEP_RULE via appendSystemPrompt", async () => {
	const { runner, agentDir } = await makeRunner(() => ({ nextStep: { enabled: true } }));
	const result = await runner.emitBeforeAgentStart("hello", undefined, BASE_SYSTEM_PROMPT);
	assert.ok(result, "expected non-undefined result");
	assert.ok(result.systemPrompt, "expected systemPrompt to be set");
	assert.ok(
		result.systemPrompt!.includes(NEXT_STEP_RULE),
		`expected systemPrompt to contain NEXT_STEP_RULE; got:\n${result.systemPrompt}`,
	);
	assert.ok(
		result.systemPrompt!.startsWith(BASE_SYSTEM_PROMPT),
		"expected systemPrompt to retain the base prompt at the start",
	);
});

test("next-step: enabled=false returns undefined and leaves systemPrompt unchanged (byte-equal)", async () => {
	const { runner } = await makeRunner(() => ({ nextStep: { enabled: false } }));
	const result = await runner.emitBeforeAgentStart("hello", undefined, BASE_SYSTEM_PROMPT);
	assert.equal(result, undefined, "expected hook to return undefined when disabled");
});

test("next-step: missing settings.nextStep key falls back to enabled=true (default)", async () => {
	const { runner } = await makeRunner(() => ({}));
	const result = await runner.emitBeforeAgentStart("hello", undefined, BASE_SYSTEM_PROMPT);
	assert.ok(result?.systemPrompt?.includes(NEXT_STEP_RULE));
});

test("next-step: merge order — next-step rule text appears BEFORE other hooks' appendSystemPrompt", async () => {
	// Register a second extension AFTER next-step that appends a marker string.
	// Because core/extensions-host/runner.ts:emitBeforeAgentStart accumulates
	// appendSystemPrompt in registration order, the later-registered extension's
	// content should appear AFTER next-step's rule.
	const agentDir = mkdtempSync(join(tmpdir(), "catui-nextstep-"));
	const cwd = process.cwd();
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	const sessionManager = SessionManager.create(cwd, agentDir);
	const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.json"));
	const eventBus = createEventBus();
	const runtime = createExtensionRuntime();

	const nextStepExt = await loadExtensionFromFactory(
		nextStepExtension,
		cwd,
		agentDir,
		eventBus,
		runtime,
		"<test:next-step>",
	);

	const trailingExt = await loadExtensionFromFactory(
		(api) => {
			api.on("before_agent_start", () => ({
				appendSystemPrompt: "\n\n## Trailing Marker\n\nThis must come after next-step.",
			}));
		},
		cwd,
		agentDir,
		eventBus,
		runtime,
		"<test:trailing>",
	);

	const runner = new ExtensionRunner(
		[nextStepExt, trailingExt],
		runtime,
		cwd,
		agentDir,
		sessionManager,
		modelRegistry,
	);
	runner.bindCore(
		{
			sendMessage: () => {},
			sendUserMessage: () => {},
			executeCommand: () => Promise.reject(new Error("not used")),
			appendEntry: () => {},
			setSessionName: () => {},
			getSessionName: () => undefined,
			setLabel: () => {},
			getActiveTools: () => [],
			getAllTools: () => [],
			setActiveTools: () => {},
			getCommands: () => [],
			setModel: () => Promise.reject(new Error("not used")),
			getThinkingLevel: () => "off",
			setThinkingLevel: () => {},
		},
		{
			getModel: () => undefined,
			completeSimple: async () => undefined,
			completeSimpleWithUsage: async () => undefined,
			isIdle: () => true,
			abort: () => {},
			clearFollowUpQueue: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: () => {},
			getSystemPrompt: () => BASE_SYSTEM_PROMPT,
			getSoulManager: () => undefined,
			getSettings: () => ({ nextStep: { enabled: true } }),
			getSkills: () => [],
		},
	);

	const result = await runner.emitBeforeAgentStart("hello", undefined, BASE_SYSTEM_PROMPT);
	const merged = result?.systemPrompt ?? "";
	const nextStepIdx = merged.indexOf(NEXT_STEP_RULE);
	const trailingIdx = merged.indexOf("## Trailing Marker");
	assert.ok(nextStepIdx >= 0, "expected NEXT_STEP_RULE in merged prompt");
	assert.ok(trailingIdx >= 0, "expected trailing marker in merged prompt");
	assert.ok(
		nextStepIdx < trailingIdx,
		`expected NEXT_STEP_RULE (idx ${nextStepIdx}) to appear BEFORE trailing marker (idx ${trailingIdx})`,
	);
});

test("next-step: SettingsManager.setNextStepEnabled persists the toggle", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "catui-nextstep-"));
	const sm = SettingsManager.create(process.cwd(), agentDir);
	assert.equal(sm.getNextStepEnabled(), true);
	sm.setNextStepEnabled(false);
	assert.equal(sm.getNextStepEnabled(), false);
	sm.setNextStepEnabled(true);
	assert.equal(sm.getNextStepEnabled(), true);
});