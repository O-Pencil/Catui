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

test("parse args recognizes non-persistent agent loop controls", () => {
	const args = parseArgs([
		"--agent-loop",
		"weak-model-compatible",
		"--max-turns-per-prompt",
		"3",
		"--max-tool-calls-per-prompt",
		"8",
		"--max-tool-concurrency",
		"2",
		"Run bounded checks",
	]);

	assert.equal(args.agentLoopFramework, "weak-model-compatible");
	assert.deepEqual(args.loopPolicy, {
		maxTurnsPerPrompt: 3,
		maxToolCallsPerPrompt: 8,
		maxToolConcurrency: 2,
	});
	assert.deepEqual(args.messages, ["Run bounded checks"]);
});

test("parse args recognizes output continuation loop controls", () => {
	const args = parseArgs([
		"--output-token-budget",
		"1200",
		"--output-token-budget-threshold",
		"0.75",
		"--output-token-budget-continuations",
		"2",
		"--max-output-token-recovery-attempts",
		"3",
		"Write the migration plan",
	]);

	assert.deepEqual(args.loopPolicy, {
		outputTokenBudget: {
			targetTokens: 1200,
			thresholdPct: 0.75,
			maxContinuations: 2,
		},
		maxOutputTokenRecoveryAttempts: 3,
	});
	assert.deepEqual(args.messages, ["Write the migration plan"]);
});

test("parse args recognizes print failure policies", () => {
	const args = parseArgs(["--print", "--fail-on-agent-error", "--fail-on-tool-denial", "Run CI checks"]);

	assert.equal(args.print, true);
	assert.equal(args.failOnAgentError, true);
	assert.equal(args.failOnToolDenial, true);
	assert.deepEqual(args.messages, ["Run CI checks"]);
});

test("json print mode can fail when final agent result is an error", async () => {
	const stdout: string[] = [];
	const originalLog = console.log;
	console.log = (...args: unknown[]) => {
		stdout.push(args.map(String).join(" "));
	};

	let result: Awaited<ReturnType<typeof runPrintMode>> | undefined;
	try {
		const session = {
			sessionManager: {
				getHeader: () => undefined,
			},
			state: {
				lastResult: {
					stopReason: "error",
					turnCount: 2,
					toolCallCount: 1,
					durationMs: 50,
					errorSubtype: "tool_call_limit_reached",
					lastTransition: {
						reason: "tool_call_limit_reached",
						maxToolCalls: 1,
						requestedToolCalls: 2,
						toolCallCount: 1,
					},
				},
				messages: [],
			},
			extensionRunner: undefined,
			agent: {
				waitForIdle: async () => {},
			},
			bindExtensions: async () => {},
			subscribe: () => () => {},
			prompt: async () => {},
		};

		result = await runPrintMode(session as any, {
			mode: "json",
			failOnAgentError: true,
		});
	} finally {
		console.log = originalLog;
	}

	assert.equal(result?.exitCode, 1);
	assert.deepEqual(stdout, []);
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

test("text print mode can fail on tool denial after emitting answer and loop result", async () => {
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

	let result: Awaited<ReturnType<typeof runPrintMode>> | undefined;
	try {
		const session = {
			sessionManager: {
				getHeader: () => undefined,
			},
			state: {
				lastResult: {
					stopReason: "stop",
					turnCount: 2,
					toolCallCount: 2,
					durationMs: 100,
					permissionDenialCount: 1,
					permissionDenials: [{ toolCallId: "call-1", toolName: "bash", reason: "not allowed" }],
					lastTransition: { reason: "tool_result", toolCallCount: 1 },
				},
				messages: [
					{
						role: "assistant",
						stopReason: "stop",
						content: [{ type: "text", text: "checked" }],
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

		result = await runPrintMode(session as any, {
			mode: "text",
			printLoopResult: true,
			failOnToolDenial: true,
		});
	} finally {
		console.log = originalLog;
		console.error = originalError;
	}

	assert.equal(result?.exitCode, 1);
	assert.deepEqual(stdout, ["checked"]);
	assert.equal(stderr.length, 1);
	assert.deepEqual(JSON.parse(stderr[0]), {
		type: "agent_result",
		stopReason: "stop",
		turnCount: 2,
		toolCallCount: 2,
		durationMs: 100,
		permissionDenialCount: 1,
		permissionDenials: [{ toolCallId: "call-1", toolName: "bash", reason: "not allowed" }],
		lastTransition: { reason: "tool_result", toolCallCount: 1 },
	});
});

test("text print mode emits loop result before returning an error exit code", async () => {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const originalLog = console.log;
	const originalError = console.error;
	const originalExit = process.exit;
	console.log = (...args: unknown[]) => {
		stdout.push(args.map(String).join(" "));
	};
	console.error = (...args: unknown[]) => {
		stderr.push(args.map(String).join(" "));
	};
	process.exit = ((code?: string | number | null | undefined) => {
		throw new Error(`unexpected process.exit(${code})`);
	}) as typeof process.exit;

	let result: Awaited<ReturnType<typeof runPrintMode>> | undefined;
	try {
		const session = {
			sessionManager: {
				getHeader: () => undefined,
			},
			state: {
				lastResult: {
					stopReason: "error",
					turnCount: 4,
					toolCallCount: 6,
					durationMs: 900,
					errorMessage: "Stopped after reaching the turn limit.",
					errorSubtype: "max_turns_reached",
					lastTransition: { reason: "max_turns_reached", maxTurns: 3, turnCount: 4 },
				},
				messages: [
					{
						role: "assistant",
						stopReason: "error",
						errorMessage: "Stopped after reaching the turn limit.",
						content: [{ type: "text", text: "partial answer" }],
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

		result = await runPrintMode(session as any, {
			mode: "text",
			printLoopResult: true,
		});
	} finally {
		console.log = originalLog;
		console.error = originalError;
		process.exit = originalExit;
	}

	assert.equal(result?.exitCode, 1);
	assert.deepEqual(stdout, []);
	assert.equal(stderr[0], "Stopped after reaching the turn limit.");
	assert.deepEqual(JSON.parse(stderr[1]), {
		type: "agent_result",
		stopReason: "error",
		turnCount: 4,
		toolCallCount: 6,
		durationMs: 900,
		errorMessage: "Stopped after reaching the turn limit.",
		errorSubtype: "max_turns_reached",
		lastTransition: { reason: "max_turns_reached", maxTurns: 3, turnCount: 4 },
	});
});
