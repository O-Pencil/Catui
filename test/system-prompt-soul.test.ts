/**
 * [WHO]: system prompt and before_agent_start regression tests
 * [FROM]: Depends on node:test, core/prompt/system-prompt.ts, core/extensions-host/runner.ts
 * [TO]: Consumed by repository test runner
 * [HERE]: test/system-prompt-soul.test.ts - guards Soul layering and append-only extension prompt behavior
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt } from "../core/prompt/system-prompt.js";
import { ExtensionRunner } from "../core/extensions-host/runner.js";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	Extension,
	ExtensionRuntime,
} from "../core/extensions-host/types.js";

function createBeforeAgentStartExtension(
	path: string,
	handler: (event: BeforeAgentStartEvent) => BeforeAgentStartEventResult | undefined,
): Extension {
	return {
		path,
		resolvedPath: path,
		handlers: new Map([["before_agent_start", [handler as never]]]),
		tools: new Map(),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

function createRunner(extensions: Extension[]): ExtensionRunner {
	const runtime: ExtensionRuntime = {
		flagValues: new Map(),
		pendingProviderRegistrations: [],
		sendMessage: () => {},
		sendUserMessage: () => {},
		executeCommand: async () => false,
		appendEntry: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => {},
		getCommands: () => [],
		setModel: async () => false,
		getThinkingLevel: () => "off",
		setThinkingLevel: () => {},
		isIdle: () => true,
	};

	const runner = new ExtensionRunner(
		extensions,
		runtime,
		process.cwd(),
		{ getEntries: () => [] } as never,
		{} as never,
	);

	runner.bindCore(
		{
			sendMessage: runtime.sendMessage,
			sendUserMessage: runtime.sendUserMessage,
			executeCommand: runtime.executeCommand,
			appendEntry: runtime.appendEntry,
			setSessionName: runtime.setSessionName,
			getSessionName: runtime.getSessionName,
			setLabel: runtime.setLabel,
			getActiveTools: runtime.getActiveTools,
			getAllTools: runtime.getAllTools,
			setActiveTools: runtime.setActiveTools,
			getCommands: runtime.getCommands,
			setModel: runtime.setModel,
			getThinkingLevel: runtime.getThinkingLevel,
			setThinkingLevel: runtime.setThinkingLevel,
		},
		{
			getModel: () => undefined,
			completeSimple: async () => undefined,
			isIdle: () => true,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: () => {},
			getSystemPrompt: () => "",
			getSoulManager: () => undefined,
			getSettings: () => ({}),
		},
	);

	return runner;
}

test("system-prompt: places soul section once after base instructions", () => {
	const prompt = buildSystemPrompt({
		selectedTools: ["read"],
		soulInjection: "Stay steady and collaborative.",
	});

	assert.equal(
		prompt.split("Stay steady and collaborative.").length - 1,
		1,
	);
	assert.ok(prompt.includes("## Stable Personality Layer"));
	assert.ok(
		prompt.indexOf("You are the writing assistant in nanopencil.") <
			prompt.indexOf("## Stable Personality Layer"),
	);
});

test("before_agent_start: append-only extensions preserve soul base prompt", async () => {
	const basePrompt = buildSystemPrompt({
		selectedTools: ["read"],
		soulInjection: "Stable soul voice.",
	});
	const runner = createRunner([
		createBeforeAgentStartExtension("presence", () => ({
			appendSystemPrompt: "## Recent Presence Lines\n- still here",
		})),
		createBeforeAgentStartExtension("interview", () => ({
			appendSystemPrompt: "[Interview Hint]\nclarify if needed",
		})),
	]);

	const result = await runner.emitBeforeAgentStart(
		"help me fix this",
		undefined,
		basePrompt,
	);

	assert.ok(result?.systemPrompt);
	assert.ok(result!.systemPrompt!.startsWith(basePrompt));
	assert.equal(result!.systemPrompt!.split("Stable soul voice.").length - 1, 1);
	assert.ok(result!.systemPrompt!.includes("## Recent Presence Lines"));
	assert.ok(result!.systemPrompt!.includes("[Interview Hint]"));
});

test("before_agent_start: replacement still chains with later append", async () => {
	const runner = createRunner([
		createBeforeAgentStartExtension("replace", () => ({
			systemPrompt: "REPLACED BASE",
		})),
		createBeforeAgentStartExtension("append", () => ({
			appendSystemPrompt: "APPENDED BLOCK",
		})),
	]);

	const result = await runner.emitBeforeAgentStart("prompt", undefined, "ORIGINAL");

	assert.equal(result?.systemPrompt, "REPLACED BASE\n\nAPPENDED BLOCK");
});
