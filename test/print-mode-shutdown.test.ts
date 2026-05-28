import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../cli/args.js";
import { runPrintMode } from "../modes/print-mode.js";

test("print mode emits session_shutdown so extensions can flush final events", async () => {
	let shutdownEmits = 0;

	const session = {
		sessionManager: {
			getHeader: () => undefined,
		},
		state: {
			messages: [],
		},
		extensionRunner: {
			hasHandlers: (eventType: string) => eventType === "session_shutdown",
			emit: async (event: { type: string }) => {
				if (event.type === "session_shutdown") shutdownEmits += 1;
			},
		},
		bindExtensions: async () => {},
		subscribe: () => () => {},
		prompt: async () => {},
	};

	await runPrintMode(session as any, {
		mode: "json",
		initialMessage: "Inspect SAL eval lifecycle",
	});

	assert.equal(shutdownEmits, 1);
});

test("parse args recognizes print loop result reporting", () => {
	const args = parseArgs(["--print", "--print-loop-result", "Run checks"]);

	assert.equal(args.print, true);
	assert.equal(args.printLoopResult, true);
	assert.deepEqual(args.messages, ["Run checks"]);
});

test("text print mode can emit final agent loop result as stderr JSON", async () => {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const originalLog = console.log;
	const originalError = console.error;
	console.log = (...args: unknown[]) => {
		stdout.push(args.map(String).join(" "));
	};
	console.error = (...args: unknown[]) => {
		stderr.push(args.map(String).join(" "));
	};

	try {
		const session = {
			sessionManager: {
				getHeader: () => undefined,
			},
			state: {
				lastResult: {
					stopReason: "toolUse",
					turnCount: 3,
					toolCallCount: 4,
					durationMs: 250,
					permissionDenialCount: 1,
					lastTransition: { reason: "tool_result", toolCallCount: 2 },
				},
				messages: [
					{
						role: "assistant",
						stopReason: "toolUse",
						content: [{ type: "text", text: "final answer" }],
					},
				],
			},
			extensionRunner: undefined,
			agent: {
				waitForIdle: async () => {},
			},
			bindExtensions: async () => {},
			subscribe: () => () => {},
			prompt: async () => {},
		};

		await runPrintMode(session as any, {
			mode: "text",
			printLoopResult: true,
		});
	} finally {
		console.log = originalLog;
		console.error = originalError;
	}

	assert.deepEqual(stdout, ["final answer"]);
	assert.equal(stderr.length, 1);
	assert.deepEqual(JSON.parse(stderr[0]), {
		type: "agent_result",
		stopReason: "toolUse",
		turnCount: 3,
		toolCallCount: 4,
		durationMs: 250,
		permissionDenialCount: 1,
		lastTransition: { reason: "tool_result", toolCallCount: 2 },
	});
});
