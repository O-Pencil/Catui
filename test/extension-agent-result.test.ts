/**
 * [WHO]: Verifies extension agent_result hook delivery
 * [FROM]: Depends on node:test, core/extensions-host/runner.ts, core/extensions-host/types.ts
 * [TO]: Consumed by repository test runner
 * [HERE]: test/extension-agent-result.test.ts - guards agent loop result observability for extensions
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionRunner } from "../core/extensions-host/runner.js";
import { AgentSession } from "../core/runtime/agent-session.js";
import type {
	AgentResultEvent,
	Extension,
	ExtensionRuntime,
} from "../core/extensions-host/types.js";

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

test("extension runner delivers agent_result events", async () => {
	const received: AgentResultEvent[] = [];
	const extension: Extension = {
		path: "agent-result-probe",
		resolvedPath: "agent-result-probe",
		handlers: new Map([
			[
				"agent_result",
				[
					((event: AgentResultEvent) => {
						received.push(event);
					}) as never,
				],
			],
		]),
		tools: new Map(),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
	const runner = createRunner([extension]);

	await runner.emit({
		type: "agent_result",
		stopReason: "stop",
		turnCount: 2,
		toolCallCount: 3,
		durationMs: 42,
		permissionDenialCount: 1,
		permissionDenials: [{ toolCallId: "tool-1", toolName: "write", reason: "blocked" }],
		lastTransition: { reason: "tool_result", toolCallCount: 3 },
	} satisfies AgentResultEvent);

	assert.equal(received.length, 1);
	assert.equal(received[0].turnCount, 2);
	assert.equal(received[0].toolCallCount, 3);
	assert.deepEqual(received[0].lastTransition, { reason: "tool_result", toolCallCount: 3 });
	assert.deepEqual(received[0].permissionDenials, [
		{ toolCallId: "tool-1", toolName: "write", reason: "blocked" },
	]);
});

test("agent session forwards agent_result to extensions", async () => {
	const received: AgentResultEvent[] = [];
	const extension: Extension = {
		path: "agent-session-result-probe",
		resolvedPath: "agent-session-result-probe",
		handlers: new Map([
			[
				"agent_result",
				[
					((event: AgentResultEvent) => {
						received.push(event);
					}) as never,
				],
			],
		]),
		tools: new Map(),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
	const runner = createRunner([extension]);
	const session = Object.create(AgentSession.prototype) as {
		_extensionRunner: ExtensionRunner;
		_emitExtensionEvent(event: AgentResultEvent): Promise<void>;
	};
	session._extensionRunner = runner;

	await session._emitExtensionEvent({
		type: "agent_result",
		stopReason: "toolUse",
		turnCount: 4,
		toolCallCount: 7,
		durationMs: 123,
		lastTransition: { reason: "tool_result", toolCallCount: 7 },
	});

	assert.equal(received.length, 1);
	assert.equal(received[0].stopReason, "toolUse");
	assert.equal(received[0].turnCount, 4);
	assert.deepEqual(received[0].lastTransition, { reason: "tool_result", toolCallCount: 7 });
});
