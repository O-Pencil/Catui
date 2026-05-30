import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@pencil-agent/ai";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { agentLoop, agentLoopContinue } from "../src/agent-loop.js";
import { structuredAdaptiveAgentLoop } from "../src/structured-adaptive-agent-loop.js";
import { buildToolMap, partitionStructuredAdaptiveToolCalls, type StructuredAdaptiveToolCall } from "../src/structured-adaptive-tool-orchestration.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.js";

// Mock stream for testing - mimics MockAssistantStream
class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: createUsage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): UserMessage {
	return {
		role: "user",
		content: text,
		timestamp: Date.now(),
	};
}

// Simple identity converter for tests - just passes through standard messages
function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

function readToolResultText(message: Extract<AgentMessage, { role: "toolResult" }>): string {
	return message.content
		.filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => {
			setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
		}),
	]);
}

function createRejectingAssistantStream(error: Error): MockAssistantStream {
	return {
		[Symbol.asyncIterator]() {
			return {
				next() {
					return Promise.reject(error);
				},
			};
		},
		result() {
			return new Promise<AssistantMessage>(() => {});
		},
		resultIfResolved() {
			return undefined;
		},
		push() {},
		end() {},
	} as unknown as MockAssistantStream;
}

function createFinalEventWithHangingResultStream(event: AssistantMessageEvent): MockAssistantStream {
	return {
		[Symbol.asyncIterator]() {
			let delivered = false;
			return {
				next() {
					if (delivered) return Promise.resolve({ done: true, value: undefined });
					delivered = true;
					return Promise.resolve({ done: false, value: event });
				},
			};
		},
		result() {
			return new Promise<AssistantMessage>(() => {});
		},
		resultIfResolved() {
			return undefined;
		},
		push() {},
		end() {},
	} as unknown as MockAssistantStream;
}

function createEventlessEndWithHangingResultStream(): MockAssistantStream {
	return {
		[Symbol.asyncIterator]() {
			return {
				next() {
					return Promise.resolve({ done: true, value: undefined });
				},
			};
		},
		result() {
			return new Promise<AssistantMessage>(() => {});
		},
		resultIfResolved() {
			return undefined;
		},
		push() {},
		end() {},
	} as unknown as MockAssistantStream;
}

function totalToolResultTextLength(messages: Extract<AgentMessage, { role: "toolResult" }>[]): number {
	return messages.reduce((total, message) => total + readToolResultText(message).length, 0);
}

describe("agentLoop with AgentMessage", () => {
	it("should emit events with AgentMessage types", async () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [],
			tools: [],
		};

		const userPrompt: AgentMessage = createUserMessage("Hello");

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "Hi there!" }]);
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([userPrompt], context, config, undefined, streamFn);

		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();

		// Should have user message and assistant message
		expect(messages.length).toBe(2);
		expect(messages[0].role).toBe("user");
		expect(messages[1].role).toBe("assistant");

		// Verify event sequence
		const eventTypes = events.map((e) => e.type);
		expect(eventTypes).toContain("agent_start");
		expect(eventTypes).toContain("turn_start");
		expect(eventTypes).toContain("message_start");
		expect(eventTypes).toContain("message_end");
		expect(eventTypes).toContain("turn_end");
		expect(eventTypes).toContain("agent_end");
	});

	it("should emit standard loop request and result summary events", async () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [],
			tools: [],
		};
		const userPrompt: AgentMessage = createUserMessage("Hello");
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxTokens: 123,
		};
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "hi" }]);
				message.usage = {
					input: 2,
					output: 3,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 5,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.03 },
				};
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([userPrompt], context, config, undefined, streamFn);
		for await (const event of stream) {
			events.push(event);
		}

		const request = events.find(
			(event): event is Extract<AgentEvent, { type: "stream_request_start" }> =>
				event.type === "stream_request_start",
		);
		expect(request).toMatchObject({
			type: "stream_request_start",
			model: "mock",
			provider: "openai",
			api: "openai-responses",
			messageCount: 1,
			maxTokens: 123,
		});

		const resultIndex = events.findIndex((event) => event.type === "agent_result");
		const endIndex = events.findIndex((event) => event.type === "agent_end");
		expect(resultIndex).toBeGreaterThanOrEqual(0);
		expect(endIndex).toBeGreaterThan(resultIndex);
		const result = events[resultIndex] as Extract<AgentEvent, { type: "agent_result" }>;
		expect(result.stopReason).toBe("stop");
		expect(result.turnCount).toBe(1);
		expect(result.toolCallCount).toBe(0);
		expect(result.durationMs).toEqual(expect.any(Number));
		expect(result.usage).toMatchObject({ input: 2, output: 3, totalTokens: 5, cost: { total: 0.03 } });
		expect(result.permissionDenialCount).toBe(0);
		expect(result.permissionDenials).toEqual([]);
	});

	it("should finalize standard loop streams that end with a result but no done event", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getFollowUpMessages: (() => {
				let delivered = false;
				return () => {
					if (delivered) return [];
					delivered = true;
					return [createUserMessage("follow up")];
				};
			})(),
		};

		let callIndex = 0;
		let sawFinalAssistantInSecondRequest = false;
		const stream = agentLoop([createUserMessage("hello")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 1) {
				sawFinalAssistantInSecondRequest = ctx.messages.some(
					(message) =>
						message.role === "assistant" &&
						message.content.some((part) => part.type === "text" && part.text === "final"),
				);
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.end(createAssistantMessage([{ type: "text", text: "final" }]));
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "second" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const assistantEnds = events.filter(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "assistant",
		);
		expect(assistantEnds.map((event) => event.message.content)).toEqual([
			[{ type: "text", text: "final" }],
			[{ type: "text", text: "second" }],
		]);
		expect(sawFinalAssistantInSecondRequest).toBe(true);
	});

	it("should finalize standard loop done events without waiting for result()", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const finalMessage = createAssistantMessage([{ type: "text", text: "event final" }]);
		const stream = agentLoop([createUserMessage("hello")], context, config, undefined, () =>
			createFinalEventWithHangingResultStream({ type: "done", reason: "stop", message: finalMessage }),
		);

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const messages = await withTimeout(stream.result(), 100);

		expect(messages.at(-1)).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "event final" }],
			stopReason: "stop",
		});
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("stop");
	});

	it("should fail standard loop eventless streams that end without a result", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const stream = agentLoop([createUserMessage("hello")], context, config, undefined, () =>
			createEventlessEndWithHangingResultStream(),
		);

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);

		expect(finalAssistant?.stopReason).toBe("error");
		expect(finalAssistant?.errorMessage).toBe("Provider stream ended without a final assistant message");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("error");
		expect(result?.errorSubtype).toBe("model_error");
	});

	it("should let a standard loop recovery hook replace context and retry model errors", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [createUserMessage("old context")],
			tools: [],
		};
		let recoveryCalls = 0;
		let sawRecoveredContext = false;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			recoverModelError: ({ errorSubtype, attempt }) => {
				recoveryCalls += 1;
				expect(errorSubtype).toBe("context_overflow");
				expect(attempt).toBe(1);
				return {
					action: "retry",
					messages: [createUserMessage("compacted context")],
					transition: { reason: "model_error_recovery", subtype: errorSubtype, attempt },
				};
			},
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("too much context")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 1) {
				sawRecoveredContext = ctx.messages.some(
					(message) =>
						message.role === "user" &&
						typeof message.content === "string" &&
						message.content === "compacted context",
				);
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					const message = createAssistantMessage([], "error");
					message.errorMessage = "maximum context length is 8192 tokens";
					mockStream.push({ type: "done", reason: "error", message });
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "recovered" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(recoveryCalls).toBe(1);
		expect(sawRecoveredContext).toBe(true);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("stop");
		expect(result?.lastTransition).toEqual({
			reason: "model_error_recovery",
			subtype: "context_overflow",
			attempt: 1,
		});
		const returnedMessages = await stream.result();
		expect(
			returnedMessages.some((message) => message.role === "assistant" && message.stopReason === "error"),
		).toBe(false);
	});

	it("should recover standard loop custom stream iterator errors", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [createUserMessage("old context")],
			tools: [],
		};
		let recoveryCalls = 0;
		let sawRecoveredContext = false;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			recoverModelError: ({ errorSubtype, attempt }) => {
				recoveryCalls += 1;
				expect(errorSubtype).toBe("context_overflow");
				expect(attempt).toBe(1);
				return {
					action: "retry",
					messages: [createUserMessage("compacted context")],
					transition: { reason: "model_error_recovery", subtype: errorSubtype, attempt },
				};
			},
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("too much context")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 0) {
				callIndex++;
				return createRejectingAssistantStream(new Error("maximum context length is 8192 tokens"));
			}
			sawRecoveredContext = ctx.messages.some(
				(message) =>
					message.role === "user" &&
					typeof message.content === "string" &&
					message.content === "compacted context",
			);
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "recovered" }]),
				});
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(recoveryCalls).toBe(1);
		expect(sawRecoveredContext).toBe(true);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("stop");
		expect(result?.lastTransition).toEqual({
			reason: "model_error_recovery",
			subtype: "context_overflow",
			attempt: 1,
		});
	});

	it("should recover standard loop once when output stops due to max output tokens", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxTokens: 100,
		};

		let callIndex = 0;
		let sawRecoveryPrompt = false;
		const requestedMaxTokens: Array<number | undefined> = [];
		const stream = agentLoop([createUserMessage("write long")], context, config, undefined, (_model, ctx, options) => {
			requestedMaxTokens.push(options?.maxTokens);
			if (callIndex === 1) {
				sawRecoveryPrompt = ctx.messages.some((message) => {
					if (message.role !== "user") return false;
					if (typeof message.content === "string") return message.content.includes("output-token recovery");
					return message.content.some(
						(part) => part.type === "text" && part.text.includes("output-token recovery"),
					);
				});
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					const message = createAssistantMessage([{ type: "text", text: "partial" }], "length");
					message.usage.output = 100;
					message.usage.totalTokens = 100;
					mockStream.push({ type: "done", reason: "length", message });
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "continued" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(sawRecoveryPrompt).toBe(true);
		expect(requestedMaxTokens).toEqual([100, 150]);
		const assistantEnds = events.filter(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "assistant",
		);
		expect(assistantEnds.map((event) => event.message.stopReason)).toEqual(["length", "stop"]);
		const requestStarts = events.filter(
			(event): event is Extract<AgentEvent, { type: "stream_request_start" }> =>
				event.type === "stream_request_start",
		);
		expect(requestStarts.map((event) => event.maxTokens)).toEqual([100, 150]);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.lastTransition).toEqual({ reason: "max_output_tokens_recovery", attempt: 1 });
		expect(result?.transitions).toEqual([{ reason: "max_output_tokens_recovery", attempt: 1 }]);
	});

	it("should close interrupted standard loop tool calls with synthetic tool results", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const stream = agentLoop([createUserMessage("start tool")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage(
					[{ type: "toolCall", id: "tool-1", name: "slow_tool", arguments: { value: "draft" } }],
					"aborted",
				);
				message.errorMessage = "User aborted";
				mockStream.push({ type: "error", reason: "aborted", error: message });
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const toolResults = events
			.filter((event): event is Extract<AgentEvent, { type: "message_end" }> => event.type === "message_end")
			.map((event) => event.message)
			.filter((message): message is Extract<AgentMessage, { role: "toolResult" }> => message.role === "toolResult");
		expect(toolResults).toHaveLength(1);
		expect(toolResults[0]).toMatchObject({
			toolCallId: "tool-1",
			toolName: "slow_tool",
			isError: true,
			details: {
				errorType: "interrupted_tool_call",
				stopReason: "aborted",
			},
		});
		expect(readToolResultText(toolResults[0])).toContain("interrupted");
		const turnEnd = events.find((event): event is Extract<AgentEvent, { type: "turn_end" }> => event.type === "turn_end");
		expect(turnEnd?.toolResults.map((result) => result.toolCallId)).toEqual(["tool-1"]);
	});

	it("should abort standard loop when a custom assistant stream never yields", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const controller = new AbortController();
		const stream = agentLoop([createUserMessage("wait")], context, config, controller.signal, () => new MockAssistantStream());
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort standard loop while a custom assistant stream is still being created", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const controller = new AbortController();
		const stream = agentLoop(
			[createUserMessage("wait")],
			context,
			config,
			controller.signal,
			() => new Promise<MockAssistantStream>(() => {}),
		);
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort standard loop while context transform is still running", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			transformContext: () => new Promise<AgentMessage[]>(() => {}),
			convertToLlm: identityConverter,
		};
		const controller = new AbortController();
		const stream = agentLoop([createUserMessage("wait")], context, config, controller.signal, () => {
			throw new Error("streamFn should not be called after an aborted context transform");
		});
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort standard loop while LLM message conversion is still running", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: () => new Promise<Message[]>(() => {}),
		};
		const controller = new AbortController();
		const stream = agentLoop([createUserMessage("wait")], context, config, controller.signal, () => {
			throw new Error("streamFn should not be called after an aborted LLM conversion");
		});
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort standard loop while API key resolution is still running", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getApiKey: () => new Promise<string | undefined>(() => {}),
		};
		const controller = new AbortController();
		const stream = agentLoop([createUserMessage("wait")], context, config, controller.signal, () => {
			throw new Error("streamFn should not be called after an aborted API key resolution");
		});
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort standard loop while initial steering messages are still loading", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getSteeringMessages: () => new Promise<AgentMessage[]>(() => {}),
		};
		const controller = new AbortController();
		const stream = agentLoop([createUserMessage("wait")], context, config, controller.signal, () => {
			throw new Error("streamFn should not be called after an aborted initial steering read");
		});
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should continue standard loop when a configured output token budget is underused", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			outputTokenBudget: {
				targetTokens: 100,
				thresholdPct: 0.9,
				maxContinuations: 2,
			},
		};

		let callIndex = 0;
		let sawBudgetContinuation = false;
		const stream = agentLoop([createUserMessage("write deeply")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 1) {
				sawBudgetContinuation = ctx.messages.some((message) => {
					if (message.role !== "user") return false;
					if (typeof message.content === "string") return message.content.includes("output token budget");
					return message.content.some(
						(part) => part.type === "text" && part.text.includes("output token budget"),
					);
				});
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([
					{ type: "text", text: callIndex === 0 ? "partial" : "expanded" },
				]);
				message.usage.output = callIndex === 0 ? 30 : 70;
				message.usage.totalTokens = message.usage.output;
				mockStream.push({ type: "done", reason: "stop", message });
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(callIndex).toBe(2);
		expect(sawBudgetContinuation).toBe(true);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.usage?.output).toBe(100);
		expect(result?.lastTransition).toEqual({
			reason: "token_budget_continuation",
			continuationCount: 1,
			outputTokens: 30,
			targetTokens: 100,
		});
	});

	it("should handle custom message types via convertToLlm", async () => {
		// Create a custom message type
		interface CustomNotification {
			role: "notification";
			text: string;
			timestamp: number;
		}

		const notification: CustomNotification = {
			role: "notification",
			text: "This is a notification",
			timestamp: Date.now(),
		};

		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [notification as unknown as AgentMessage], // Custom message in context
			tools: [],
		};

		const userPrompt: AgentMessage = createUserMessage("Hello");

		let convertedMessages: Message[] = [];
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: (messages) => {
				// Filter out notifications, convert rest
				convertedMessages = messages
					.filter((m) => (m as { role: string }).role !== "notification")
					.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
				return convertedMessages;
			},
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "Response" }]);
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([userPrompt], context, config, undefined, streamFn);

		for await (const event of stream) {
			events.push(event);
		}

		// The notification should have been filtered out in convertToLlm
		expect(convertedMessages.length).toBe(1); // Only user message
		expect(convertedMessages[0].role).toBe("user");
	});

	it("should apply transformContext before convertToLlm", async () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [
				createUserMessage("old message 1"),
				createAssistantMessage([{ type: "text", text: "old response 1" }]),
				createUserMessage("old message 2"),
				createAssistantMessage([{ type: "text", text: "old response 2" }]),
			],
			tools: [],
		};

		const userPrompt: AgentMessage = createUserMessage("new message");

		let transformedMessages: AgentMessage[] = [];
		let convertedMessages: Message[] = [];

		const config: AgentLoopConfig = {
			model: createModel(),
			transformContext: async (messages) => {
				// Keep only last 2 messages (prune old ones)
				transformedMessages = messages.slice(-2);
				return transformedMessages;
			},
			convertToLlm: (messages) => {
				convertedMessages = messages.filter(
					(m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
				) as Message[];
				return convertedMessages;
			},
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "Response" }]);
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		const stream = agentLoop([userPrompt], context, config, undefined, streamFn);

		for await (const _ of stream) {
			// consume
		}

		// transformContext should have been called first, keeping only last 2
		expect(transformedMessages.length).toBe(2);
		// Then convertToLlm receives the pruned messages
		expect(convertedMessages.length).toBe(2);
	});

	it("should handle tool calls and results", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const executed: string[] = [];
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "echo",
			label: "Echo",
			description: "Echo tool",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				executed.push(params.value);
				return {
					content: [{ type: "text", text: `echoed: ${params.value}` }],
					details: { value: params.value },
				};
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const userPrompt: AgentMessage = createUserMessage("echo something");

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let callIndex = 0;
		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					// First call: return tool call
					const message = createAssistantMessage(
						[{ type: "toolCall", id: "tool-1", name: "echo", arguments: { value: "hello" } }],
						"toolUse",
					);
					stream.push({ type: "done", reason: "toolUse", message });
				} else {
					// Second call: return final response
					const message = createAssistantMessage([{ type: "text", text: "done" }]);
					stream.push({ type: "done", reason: "stop", message });
				}
				callIndex++;
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([userPrompt], context, config, undefined, streamFn);

		for await (const event of stream) {
			events.push(event);
		}

		// Tool should have been executed
		expect(executed).toEqual(["hello"]);

		// Should have tool execution events
		const toolStart = events.find((e) => e.type === "tool_execution_start");
		const toolEnd = events.find((e) => e.type === "tool_execution_end");
		expect(toolStart).toBeDefined();
		expect(toolEnd).toBeDefined();
		if (toolEnd?.type === "tool_execution_end") {
			expect(toolEnd.isError).toBe(false);
		}
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.lastTransition).toEqual({ reason: "tool_result", toolCallCount: 1 });
		expect(result?.transitions).toEqual([{ reason: "tool_result", toolCallCount: 1 }]);
	});

	it("should stop before exceeding the per-prompt tool call limit", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const executed: string[] = [];
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "echo",
			label: "Echo",
			description: "Echo tool",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				executed.push(params.value);
				return {
					content: [{ type: "text", text: `echoed: ${params.value}` }],
					details: { value: params.value },
				};
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxToolCallsPerPrompt: 1,
		};

		const stream = agentLoop([createUserMessage("echo twice")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage(
					[
						{ type: "toolCall", id: "tool-1", name: "echo", arguments: { value: "first" } },
						{ type: "toolCall", id: "tool-2", name: "echo", arguments: { value: "second" } },
					],
					"toolUse",
				);
				mockStream.push({ type: "done", reason: "toolUse", message });
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(executed).toEqual([]);
		const assistantEnds = events.filter(
			(e): e is Extract<AgentEvent, { type: "message_end" }> =>
				e.type === "message_end" && e.message.role === "assistant",
		);
		expect(assistantEnds.at(-1)?.message.stopReason).toBe("error");
		expect((assistantEnds.at(-1)?.message as AssistantMessage | undefined)?.errorMessage).toContain(
			"tool-call limit",
		);
		const toolResultEnds = events.filter(
			(e): e is Extract<AgentEvent, { type: "message_end" }> =>
				e.type === "message_end" && e.message.role === "toolResult",
		);
		expect(toolResultEnds.map((event) => event.message.toolCallId)).toEqual(["tool-1", "tool-2"]);
		expect(toolResultEnds.every((event) => event.message.isError)).toBe(true);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.lastTransition).toEqual({
			reason: "tool_call_limit_reached",
			maxToolCalls: 1,
			requestedToolCalls: 2,
			toolCallCount: 0,
		});
	});

	it("should stop when the per-prompt assistant turn limit is reached", async () => {
		const toolSchema = Type.Object({});
		const tool: AgentTool<typeof toolSchema, Record<string, never>> = {
			name: "again",
			label: "Again",
			description: "Ask for another turn",
			parameters: toolSchema,
			async execute() {
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxTurnsPerPrompt: 1,
		};

		let streamCalls = 0;
		const stream = agentLoop([createUserMessage("loop")], context, config, undefined, () => {
			streamCalls++;
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage(
					[{ type: "toolCall", id: `tool-${streamCalls}`, name: "again", arguments: {} }],
					"toolUse",
				);
				mockStream.push({ type: "done", reason: "toolUse", message });
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(streamCalls).toBe(1);
		const assistantEnds = events.filter(
			(e): e is Extract<AgentEvent, { type: "message_end" }> =>
				e.type === "message_end" && e.message.role === "assistant",
		);
		expect((assistantEnds.at(-1)?.message as AssistantMessage | undefined)?.errorMessage).toContain(
			"assistant turns",
		);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.lastTransition).toEqual({
			reason: "max_turns_reached",
			maxTurns: 1,
			turnCount: 2,
		});
	});

	it("should inject queued messages and skip remaining tool calls", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const executed: string[] = [];
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "echo",
			label: "Echo",
			description: "Echo tool",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				executed.push(params.value);
				return {
					content: [{ type: "text", text: `ok:${params.value}` }],
					details: { value: params.value },
				};
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		const userPrompt: AgentMessage = createUserMessage("start");
		const queuedUserMessage: AgentMessage = createUserMessage("interrupt");

		let queuedDelivered = false;
		let callIndex = 0;
		let sawInterruptInContext = false;

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getSteeringMessages: async () => {
				// Return steering message after first tool executes
				if (executed.length === 1 && !queuedDelivered) {
					queuedDelivered = true;
					return [queuedUserMessage];
				}
				return [];
			},
		};

		const events: AgentEvent[] = [];
		const stream = agentLoop([userPrompt], context, config, undefined, (_model, ctx, _options) => {
			// Check if interrupt message is in context on second call
			if (callIndex === 1) {
				sawInterruptInContext = ctx.messages.some(
					(m) => m.role === "user" && typeof m.content === "string" && m.content === "interrupt",
				);
			}

			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					// First call: return two tool calls
					const message = createAssistantMessage(
						[
							{ type: "toolCall", id: "tool-1", name: "echo", arguments: { value: "first" } },
							{ type: "toolCall", id: "tool-2", name: "echo", arguments: { value: "second" } },
						],
						"toolUse",
					);
					mockStream.push({ type: "done", reason: "toolUse", message });
				} else {
					// Second call: return final response
					const message = createAssistantMessage([{ type: "text", text: "done" }]);
					mockStream.push({ type: "done", reason: "stop", message });
				}
				callIndex++;
			});
			return mockStream;
		});

		for await (const event of stream) {
			events.push(event);
		}

		// Only first tool should have executed
		expect(executed).toEqual(["first"]);

		// Second tool should be skipped
		const toolEnds = events.filter(
			(e): e is Extract<AgentEvent, { type: "tool_execution_end" }> => e.type === "tool_execution_end",
		);
		expect(toolEnds.length).toBe(2);
		expect(toolEnds[0].isError).toBe(false);
		expect(toolEnds[1].isError).toBe(true);
		if (toolEnds[1].result.content[0]?.type === "text") {
			expect(toolEnds[1].result.content[0].text).toContain("Skipped due to queued user message");
		}

		// Queued message should appear in events
		const queuedMessageEvent = events.find(
			(e) =>
				e.type === "message_start" &&
				e.message.role === "user" &&
				typeof e.message.content === "string" &&
				e.message.content === "interrupt",
		);
		expect(queuedMessageEvent).toBeDefined();

		// Interrupt message should be in context when second LLM call is made
		expect(sawInterruptInContext).toBe(true);
	});

	it("should resolve tool aliases and append context messages after standard loop tool results", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const executed: string[] = [];
		const contextMessage = createUserMessage("tool attachment");
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "echo",
			aliases: ["Echo"],
			label: "Echo",
			description: "Echo tool",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				executed.push(params.value);
				return {
					content: [{ type: "text", text: `echoed:${params.value}` }],
					details: { value: params.value },
					contextMessages: [contextMessage],
				};
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let callIndex = 0;
		let sawContextMessageInSecondCall = false;
		const stream = agentLoop([createUserMessage("echo")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 1) {
				sawContextMessageInSecondCall = ctx.messages.some(
					(message) => message.role === "user" && message.content === "tool attachment",
				);
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tool-1", name: "Echo", arguments: { value: "hello" } }],
							"toolUse",
						),
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(executed).toEqual(["hello"]);
		expect(sawContextMessageInSecondCall).toBe(true);
		const messageEnds = events.filter(
			(event): event is Extract<AgentEvent, { type: "message_end" }> => event.type === "message_end",
		);
		const toolResultIndex = messageEnds.findIndex((event) => event.message.role === "toolResult");
		const contextMessageIndex = messageEnds.findIndex(
			(event) => event.message.role === "user" && event.message.content === "tool attachment",
		);
		expect(toolResultIndex).toBeGreaterThanOrEqual(0);
		expect(contextMessageIndex).toBeGreaterThan(toolResultIndex);
	});

	it("should run standard loop tool validateInput before execute", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let executed = false;
		const tool: AgentTool<typeof toolSchema> = {
			name: "guarded",
			label: "Guarded",
			description: "Guarded tool",
			parameters: toolSchema,
			validateInput: (params) => params.value === "bad" ? "value is not allowed" : undefined,
			async execute() {
				executed = true;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [tool] };
		const config: AgentLoopConfig = { model: createModel(), convertToLlm: identityConverter };
		const stream = agentLoop([createUserMessage("guard")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "toolUse",
					message: createAssistantMessage(
						[{ type: "toolCall", id: "tool-1", name: "guarded", arguments: { value: "bad" } }],
						"toolUse",
					),
				});
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(executed).toBe(false);
		const toolEnd = events.find(
			(event): event is Extract<AgentEvent, { type: "tool_execution_end" }> => event.type === "tool_execution_end",
		);
		expect(toolEnd?.isError).toBe(true);
		expect(toolEnd?.result.content[0]?.type === "text" ? toolEnd.result.content[0].text : "").toContain(
			"value is not allowed",
		);
	});

	it("should feed standard loop permission denials back as tool results", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let executed = false;
		const tool: AgentTool<typeof toolSchema> = {
			name: "write",
			label: "Write",
			description: "Write tool",
			parameters: toolSchema,
			async execute() {
				executed = true;
				return { content: [{ type: "text", text: "written" }], details: {} };
			},
		};

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [tool] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			canUseTool: () => ({ decision: "deny", reason: "outside workspace" }),
		};
		const stream = agentLoop([createUserMessage("write")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "toolUse",
					message: createAssistantMessage(
						[{ type: "toolCall", id: "tool-1", name: "write", arguments: { value: "x" } }],
						"toolUse",
					),
				});
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(executed).toBe(false);
		const toolResultEnd = events.find(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "toolResult",
		);
		expect(toolResultEnd?.message.isError).toBe(true);
		expect(readToolResultText(toolResultEnd!.message)).toContain("Permission denied: outside workspace");
	});

	it("should enforce standard loop aggregate tool result batch budget before the next model request", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "budget_read",
			label: "Budget read",
			description: "Read tool with configurable output size",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				return {
					content: [
						{
							type: "text",
							text: params.value === "large" ? "L".repeat(220) : "small-output",
						},
					],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxToolResultBatchSizeChars: 90,
		};

		let secondRequestToolResults: Extract<AgentMessage, { role: "toolResult" }>[] = [];
		let callIndex = 0;
		const stream = agentLoop([createUserMessage("read small and large")], context, config, undefined, (_model, ctx) => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[
								{ type: "toolCall", id: "tool-small", name: "budget_read", arguments: { value: "small" } },
								{ type: "toolCall", id: "tool-large", name: "budget_read", arguments: { value: "large" } },
							],
							"toolUse",
						),
					});
				} else {
					secondRequestToolResults = ctx.messages.filter(
						(message): message is Extract<AgentMessage, { role: "toolResult" }> => message.role === "toolResult",
					);
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(secondRequestToolResults.map((result) => result.toolCallId)).toEqual(["tool-small", "tool-large"]);
		expect(readToolResultText(secondRequestToolResults[0]!)).toBe("small-output");
		expect(totalToolResultTextLength(secondRequestToolResults)).toBeLessThanOrEqual(90);
		expect(readToolResultText(secondRequestToolResults[1]!)).toContain("Tool result truncated by batch budget");
		expect((secondRequestToolResults[1]!.details as { truncationReason?: string }).truncationReason).toBe(
			"tool_result_batch_budget",
		);

		const eventToolResults = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "toolResult",
			)
			.map((event) => event.message);
		expect(totalToolResultTextLength(eventToolResults)).toBeLessThanOrEqual(90);
	});

	it("should start standard loop tool-use summaries without blocking the next model request", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "summary_read",
			label: "Summary read",
			description: "Read tool used to test non-blocking summaries",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		let summaryStartedAt = 0;
		let summaryResolvedAt = 0;
		let secondRequestStartedAt = 0;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			createToolUseSummary() {
				summaryStartedAt = Date.now();
				return new Promise<AgentMessage>((resolve) => {
					setTimeout(() => {
						summaryResolvedAt = Date.now();
						resolve(createUserMessage("Tool summary: summary_read returned value."));
					}, 40);
				});
			},
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("read")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			if (callIndex === 1) {
				secondRequestStartedAt = Date.now();
			}
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tool-1", name: "summary_read", arguments: { value: "file" } }],
							"toolUse",
						),
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		for await (const _event of stream) {
			// consume
		}
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(summaryStartedAt).toBeGreaterThan(0);
		expect(secondRequestStartedAt).toBeGreaterThan(0);
		expect(summaryResolvedAt).toBeGreaterThan(0);
		expect(secondRequestStartedAt).toBeLessThan(summaryResolvedAt);
	});

	it("should add ready standard loop tool-use summaries to the next model request context", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "ready_summary_read",
			label: "Ready summary read",
			description: "Read tool used to test settled summaries",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const summaryMessage = createUserMessage("Tool summary: ready_summary_read returned file.");
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			createToolUseSummary() {
				return summaryMessage;
			},
		};

		let secondRequestSawSummary = false;
		let callIndex = 0;
		const stream = agentLoop([createUserMessage("read")], context, config, undefined, (_model, ctx) => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tool-1", name: "ready_summary_read", arguments: { value: "file" } }],
							"toolUse",
						),
					});
				} else {
					secondRequestSawSummary = ctx.messages.includes(summaryMessage);
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(secondRequestSawSummary).toBe(true);
		expect(
			events.some(
				(event) =>
					event.type === "message_end" &&
					event.message.role === "user" &&
					event.message.content === "Tool summary: ready_summary_read returned file.",
			),
		).toBe(true);
	});

	it("should allow standard loop stop hooks to inject a continuation turn", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		let stopHookCalls = 0;
		let sawStopHookMessage = false;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			runStopHooks: () => {
				stopHookCalls++;
				if (stopHookCalls === 1) {
					return { action: "continue", messages: [createUserMessage("Please verify the final answer.")] };
				}
				return { action: "stop" };
			},
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("answer")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 1) {
				sawStopHookMessage = ctx.messages.some(
					(message) => message.role === "user" && message.content === "Please verify the final answer.",
				);
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: callIndex === 0 ? "draft" : "verified" }]),
				});
				callIndex++;
			});
			return mockStream;
		});

		for await (const _event of stream) {
			// consume
		}

		expect(callIndex).toBe(2);
		expect(stopHookCalls).toBe(2);
		expect(sawStopHookMessage).toBe(true);
	});

	it("should abort standard loop while stop hooks are still running", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const controller = new AbortController();
		let stopHookCalls = 0;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			runStopHooks: () => {
				stopHookCalls += 1;
				queueMicrotask(() => controller.abort());
				return new Promise(() => {});
			},
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("answer")], context, config, controller.signal, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "draft" }]),
				});
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		expect(callIndex).toBe(1);
		expect(stopHookCalls).toBe(1);
		const finalAssistant = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "assistant",
			)
			.at(-1)?.message as AssistantMessage | undefined;
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should record standard loop follow-up message continuations", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		let followUpDelivered = false;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getFollowUpMessages: () => {
				if (followUpDelivered) return [];
				followUpDelivered = true;
				return [createUserMessage("follow up")];
			},
		};

		let callIndex = 0;
		let sawFollowUp = false;
		const stream = agentLoop([createUserMessage("answer")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 1) {
				sawFollowUp = ctx.messages.some(
					(message) => message.role === "user" && message.content === "follow up",
				);
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([
						{ type: "text", text: callIndex === 0 ? "first answer" : "follow-up answer" },
					]),
				});
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(callIndex).toBe(2);
		expect(sawFollowUp).toBe(true);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.lastTransition).toEqual({ reason: "follow_up" });
		expect(result?.transitions).toEqual([{ reason: "follow_up" }]);
	});

	it("should abort standard loop while follow-up messages are still loading", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const controller = new AbortController();
		let followUpCalls = 0;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getFollowUpMessages: () => {
				followUpCalls += 1;
				queueMicrotask(() => controller.abort());
				return new Promise<AgentMessage[]>(() => {});
			},
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("answer")], context, config, controller.signal, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "draft" }]),
				});
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		expect(callIndex).toBe(1);
		expect(followUpCalls).toBe(1);
		const finalAssistant = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "assistant",
			)
			.at(-1)?.message as AssistantMessage | undefined;
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should stop standard loop stop-hook continuations at the configured limit", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxStopHookContinuations: 1,
			runStopHooks: () => ({
				action: "continue",
				messages: [createUserMessage("Try again.")],
			}),
		};

		let callIndex = 0;
		const stream = agentLoop([createUserMessage("answer")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: `draft ${callIndex}` }]),
				});
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(callIndex).toBe(2);
		const assistantEnds = events.filter(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "assistant",
		);
		expect((assistantEnds.at(-1)?.message as AssistantMessage | undefined)?.stopReason).toBe("error");
		expect((assistantEnds.at(-1)?.message as AssistantMessage | undefined)?.errorMessage).toContain(
			"stop_hook_limit_reached",
		);
	});
});

describe("structuredAdaptiveAgentLoop", () => {
	it("should resolve tool aliases in the structured-adaptive tool orchestration layer", () => {
		const toolSchema = Type.Object({});
		const tool: AgentTool<typeof toolSchema> = {
			name: "read",
			aliases: ["Read"],
			label: "read",
			description: "Read",
			parameters: toolSchema,
			async execute() {
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};

		const map = buildToolMap([tool]);

		expect(map.get("read")).toBe(tool);
		expect(map.get("Read")).toBe(tool);
	});

	it("should partition safe tools into batches and keep unsafe tools serial", () => {
		const toolSchema = Type.Object({});
		const safeTool: AgentTool<typeof toolSchema> = {
			name: "safe",
			label: "safe",
			description: "safe",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute() {
				return { content: [{ type: "text", text: "safe" }], details: {} };
			},
		};
		const unsafeTool: AgentTool<typeof toolSchema> = {
			name: "unsafe",
			label: "unsafe",
			description: "unsafe",
			parameters: toolSchema,
			isConcurrencySafe: false,
			async execute() {
				return { content: [{ type: "text", text: "unsafe" }], details: {} };
			},
		};
		const calls: StructuredAdaptiveToolCall[] = [
			{ type: "toolCall", id: "1", name: "safe", arguments: {} },
			{ type: "toolCall", id: "2", name: "safe", arguments: {} },
			{ type: "toolCall", id: "3", name: "unsafe", arguments: {} },
			{ type: "toolCall", id: "4", name: "safe", arguments: {} },
		];

		const batches = partitionStructuredAdaptiveToolCalls(
			calls,
			new Map([
				[safeTool.name, safeTool],
				[unsafeTool.name, unsafeTool],
			]),
		);

		expect(batches.map((batch) => batch.map((call) => call.id))).toEqual([["1", "2"], ["3"], ["4"]]);
	});

	it("should batch concurrency-safe tools while preserving tool result order", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const executionOrder: string[] = [];
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const slowTool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "slow_read",
			label: "Slow read",
			description: "Safe slow tool",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params) {
				executionOrder.push(`start:${params.value}`);
				await firstGate;
				executionOrder.push(`end:${params.value}`);
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const fastTool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "fast_read",
			label: "Fast read",
			description: "Safe fast tool",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params) {
				executionOrder.push(`start:${params.value}`);
				releaseFirst();
				executionOrder.push(`end:${params.value}`);
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};

		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [slowTool, fastTool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("read both")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[
								{ type: "toolCall", id: "tool-1", name: "slow_read", arguments: { value: "first" } },
								{ type: "toolCall", id: "tool-2", name: "fast_read", arguments: { value: "second" } },
							],
							"toolUse",
						),
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(executionOrder.slice(0, 2)).toEqual(["start:first", "start:second"]);
		const toolResults = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "toolResult",
			)
			.map((event) => event.message.toolCallId);
		expect(toolResults).toEqual(["tool-1", "tool-2"]);
		const toolEnds = events.filter(
			(event): event is Extract<AgentEvent, { type: "tool_execution_end" }> =>
				event.type === "tool_execution_end",
		);
		expect(toolEnds.every((event) => typeof event.durationMs === "number")).toBe(true);
	});

	it("should start concurrency-safe streaming tools before the assistant response is done", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let toolStarted!: () => void;
		const toolStartedPromise = new Promise<void>((resolve) => {
			toolStarted = resolve;
		});
		let startedBeforeDone = false;
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "stream_read",
			label: "Stream read",
			description: "Safe tool that should start as soon as its streamed call is complete",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params) {
				toolStarted();
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("stream read")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(async () => {
				if (callIndex === 0) {
					const toolCall = { type: "toolCall" as const, id: "tool-1", name: "stream_read", arguments: { value: "early" } };
					const partial = createAssistantMessage([toolCall], "toolUse");
					mockStream.push({ type: "start", partial });
					mockStream.push({ type: "toolcall_start", contentIndex: 0, partial });
					mockStream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial });
					startedBeforeDone =
						(await Promise.race([
							toolStartedPromise.then(() => true),
							new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
						])) === true;
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: partial,
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(startedBeforeDone).toBe(true);
		const toolResults = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "toolResult",
			)
			.map((event) => event.message.toolCallId);
		expect(toolResults).toEqual(["tool-1"]);
	});

	it("should close streamed tools with error tool results when the assistant stream errors", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let toolObservedAbort = false;
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "abortable_read",
			label: "Abortable read",
			description: "Safe tool that exits when its signal aborts",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params, signal) {
				await new Promise<void>((_resolve, reject) => {
					signal?.addEventListener(
						"abort",
						() => {
							toolObservedAbort = true;
							reject(new Error("tool aborted after assistant stream error"));
						},
						{ once: true },
					);
				});
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const stream = structuredAdaptiveAgentLoop([createUserMessage("stream read")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const toolCall = { type: "toolCall" as const, id: "tool-1", name: "abortable_read", arguments: { value: "early" } };
				const partial = createAssistantMessage([toolCall], "toolUse");
				mockStream.push({ type: "start", partial });
				mockStream.push({ type: "toolcall_start", contentIndex: 0, partial });
				mockStream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial });
				const errorMessage = createAssistantMessage([{ type: "text", text: "" }], "error");
				errorMessage.errorMessage = "upstream stream failed";
				mockStream.push({ type: "error", reason: "error", error: errorMessage });
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(toolObservedAbort).toBe(true);
		const toolResult = events.find(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "toolResult",
		)?.message;
		expect(toolResult?.toolCallId).toBe("tool-1");
		expect(toolResult?.isError).toBe(true);
		expect(toolResult?.content[0]?.type === "text" ? toolResult.content[0].text : "").toContain(
			"assistant stream error",
		);
		const turnEnd = events.find((event): event is Extract<AgentEvent, { type: "turn_end" }> =>
			event.type === "turn_end",
		);
		expect(turnEnd?.toolResults.map((result) => result.toolCallId)).toEqual(["tool-1"]);
	});

	it("should synthesize error results for queued streamed tools that never started", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const started: string[] = [];
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "exclusive_tool",
			label: "Exclusive tool",
			description: "Unsafe tool that blocks following streamed tools",
			parameters: toolSchema,
			isConcurrencySafe: false,
			async execute(_toolCallId, params, signal) {
				started.push(params.value);
				signal?.addEventListener("abort", releaseFirst, { once: true });
				await firstGate;
				throw new Error(`aborted:${params.value}`);
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const stream = structuredAdaptiveAgentLoop([createUserMessage("stream exclusive")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const firstCall = { type: "toolCall" as const, id: "tool-1", name: "exclusive_tool", arguments: { value: "first" } };
				const secondCall = { type: "toolCall" as const, id: "tool-2", name: "exclusive_tool", arguments: { value: "second" } };
				const partial = createAssistantMessage([firstCall, secondCall], "toolUse");
				mockStream.push({ type: "start", partial });
				mockStream.push({ type: "toolcall_end", contentIndex: 0, toolCall: firstCall, partial });
				mockStream.push({ type: "toolcall_end", contentIndex: 1, toolCall: secondCall, partial });
				const errorMessage = createAssistantMessage([{ type: "text", text: "" }], "error");
				errorMessage.errorMessage = "upstream stream failed";
				mockStream.push({ type: "error", reason: "error", error: errorMessage });
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(started).toEqual(["first"]);
		const toolResults = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "toolResult",
			)
			.map((event) => event.message);
		expect(toolResults.map((result) => result.toolCallId)).toEqual(["tool-1", "tool-2"]);
		expect(toolResults.every((result) => result.isError)).toBe(true);
		expect(toolResults[1].content[0]?.type === "text" ? toolResults[1].content[0].text : "").toContain(
			"assistant stream error",
		);
	});

	it("should let streamed block-interrupt tools finish when the assistant stream aborts", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let toolObservedAbort = false;
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "blocking_write",
			label: "Blocking write",
			description: "Stateful tool that must finish once started",
			parameters: toolSchema,
			isConcurrencySafe: false,
			interruptBehavior: "block",
			async execute(_toolCallId, params, signal) {
				signal?.addEventListener("abort", () => {
					toolObservedAbort = true;
				});
				await new Promise((resolve) => setTimeout(resolve, 5));
				return {
					content: [{ type: "text", text: `committed:${params.value}` }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const stream = structuredAdaptiveAgentLoop([createUserMessage("stream write")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const toolCall = { type: "toolCall" as const, id: "tool-1", name: "blocking_write", arguments: { value: "file" } };
				const partial = createAssistantMessage([toolCall], "toolUse");
				mockStream.push({ type: "start", partial });
				mockStream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial });
				const errorMessage = createAssistantMessage([{ type: "text", text: "" }], "aborted");
				errorMessage.errorMessage = "assistant stream aborted";
				mockStream.push({ type: "error", reason: "aborted", error: errorMessage });
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(toolObservedAbort).toBe(false);
		const toolResult = events.find(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "toolResult",
		)?.message;
		expect(toolResult?.toolCallId).toBe("tool-1");
		expect(toolResult?.isError).toBe(false);
		expect(toolResult?.content[0]?.type === "text" ? toolResult.content[0].text : "").toContain(
			"committed:file",
		);
	});

	it("should evaluate concurrency safety with validated tool arguments", async () => {
		const toolSchema = Type.Object({ readonly: Type.Boolean(), value: Type.String() });
		const safeByValue: AgentTool<typeof toolSchema, { value: string }> = {
			name: "conditional_read",
			label: "Conditional read",
			description: "Only readonly calls can run concurrently",
			parameters: toolSchema,
			isConcurrencySafe: (params) => params.readonly,
			async execute(_toolCallId, params) {
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const calls: StructuredAdaptiveToolCall[] = [
			{ type: "toolCall", id: "1", name: "conditional_read", arguments: { readonly: true, value: "a" } },
			{ type: "toolCall", id: "2", name: "conditional_read", arguments: { readonly: false, value: "b" } },
			{ type: "toolCall", id: "3", name: "conditional_read", arguments: { readonly: true, value: "c" } },
		];

		const batches = partitionStructuredAdaptiveToolCalls(calls, buildToolMap([safeByValue]));

		expect(batches.map((batch) => batch.map((call) => call.id))).toEqual([["1"], ["2"], ["3"]]);
	});

	it("should append tool context messages only after ordered tool results", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "context_read",
			label: "Context read",
			description: "Returns a result and a follow-on context message",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params) {
				return {
					content: [{ type: "text", text: `result:${params.value}` }],
					details: { value: params.value },
					contextMessages: [createUserMessage(`context:${params.value}`)],
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let sawContextAfterToolResults = false;
		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("read contexts")], context, config, undefined, (_model, ctx) => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[
								{ type: "toolCall", id: "tool-1", name: "context_read", arguments: { value: "first" } },
								{ type: "toolCall", id: "tool-2", name: "context_read", arguments: { value: "second" } },
							],
							"toolUse",
						),
					});
				} else {
					const roles = ctx.messages.map((message) =>
						message.role === "toolResult"
							? `tool:${message.toolCallId}`
							: message.role === "user" && typeof message.content === "string" && message.content.startsWith("context:")
								? message.content
								: message.role,
					);
					sawContextAfterToolResults =
						roles.indexOf("tool:tool-1") < roles.indexOf("context:first") &&
						roles.indexOf("tool:tool-2") < roles.indexOf("context:second") &&
						roles.indexOf("context:first") < roles.indexOf("context:second");
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const endedMessages = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" &&
					(event.message.role === "toolResult" ||
						(event.message.role === "user" &&
							typeof event.message.content === "string" &&
							event.message.content.startsWith("context:"))),
			)
			.map((event) =>
				event.message.role === "toolResult" ? event.message.toolCallId : event.message.content,
			);
		expect(endedMessages.slice(-4)).toEqual(["tool-1", "tool-2", "context:first", "context:second"]);
		expect(sawContextAfterToolResults).toBe(true);
	});

	it("should start tool-use summaries without blocking the next model request", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "summary_read",
			label: "Summary read",
			description: "Read tool used to test non-blocking summaries",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params) {
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};

		let summaryStartedAt = 0;
		let summaryResolvedAt = 0;
		let secondRequestStartedAt = 0;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			createToolUseSummary() {
				summaryStartedAt = Date.now();
				return new Promise<AgentMessage>((resolve) => {
					setTimeout(() => {
						summaryResolvedAt = Date.now();
						resolve(createUserMessage("Tool summary: summary_read returned value."));
					}, 40);
				});
			},
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("read")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			if (callIndex === 1) {
				secondRequestStartedAt = Date.now();
			}
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tool-1", name: "summary_read", arguments: { value: "file" } }],
							"toolUse",
						),
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		for await (const _event of stream) {
			// consume
		}
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(summaryStartedAt).toBeGreaterThan(0);
		expect(secondRequestStartedAt).toBeGreaterThan(0);
		expect(summaryResolvedAt).toBeGreaterThan(0);
		expect(secondRequestStartedAt).toBeLessThan(summaryResolvedAt);
	});

	it("should add ready tool-use summaries to the next model request context", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "ready_summary_read",
			label: "Ready summary read",
			description: "Read tool used to test settled summaries",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params) {
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const summaryMessage = createUserMessage("Tool summary: ready_summary_read returned file.");
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			createToolUseSummary() {
				return summaryMessage;
			},
		};

		let secondRequestSawSummary = false;
		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("read")], context, config, undefined, (_model, ctx) => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tool-1", name: "ready_summary_read", arguments: { value: "file" } }],
							"toolUse",
						),
					});
				} else {
					secondRequestSawSummary = ctx.messages.includes(summaryMessage);
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(secondRequestSawSummary).toBe(true);
		expect(
			events.some(
				(event) =>
					event.type === "message_end" &&
					event.message.role === "user" &&
					event.message.content === "Tool summary: ready_summary_read returned file.",
			),
		).toBe(true);
	});

	it("should respect maxToolConcurrency for safe tool batches", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let active = 0;
		let maxActive = 0;
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "safe_read",
			label: "Safe read",
			description: "Safe read",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params) {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active -= 1;
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxToolConcurrency: 2,
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("read many")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[
								{ type: "toolCall", id: "tool-1", name: "safe_read", arguments: { value: "1" } },
								{ type: "toolCall", id: "tool-2", name: "safe_read", arguments: { value: "2" } },
								{ type: "toolCall", id: "tool-3", name: "safe_read", arguments: { value: "3" } },
							],
							"toolUse",
						),
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		for await (const _event of stream) {
			// consume
		}

		expect(maxActive).toBe(2);
	});

	it("should use NANOPENCIL_MAX_TOOL_USE_CONCURRENCY when config does not override it", async () => {
		const previous = process.env.NANOPENCIL_MAX_TOOL_USE_CONCURRENCY;
		process.env.NANOPENCIL_MAX_TOOL_USE_CONCURRENCY = "1";
		try {
			const toolSchema = Type.Object({ value: Type.String() });
			let active = 0;
			let maxActive = 0;
			const tool: AgentTool<typeof toolSchema, { value: string }> = {
				name: "env_safe_read",
				label: "Env safe read",
				description: "Safe read",
				parameters: toolSchema,
				isConcurrencySafe: true,
				async execute(_toolCallId, params) {
					active += 1;
					maxActive = Math.max(maxActive, active);
					await new Promise((resolve) => setTimeout(resolve, 5));
					active -= 1;
					return {
						content: [{ type: "text", text: params.value }],
						details: { value: params.value },
					};
				},
			};
			const context: AgentContext = {
				systemPrompt: "",
				messages: [],
				tools: [tool],
			};
			const config: AgentLoopConfig = {
				model: createModel(),
				convertToLlm: identityConverter,
			};

			let callIndex = 0;
			const stream = structuredAdaptiveAgentLoop([createUserMessage("read many")], context, config, undefined, () => {
				const mockStream = new MockAssistantStream();
				queueMicrotask(() => {
					if (callIndex === 0) {
						mockStream.push({
							type: "done",
							reason: "toolUse",
							message: createAssistantMessage(
								[
									{ type: "toolCall", id: "tool-1", name: "env_safe_read", arguments: { value: "1" } },
									{ type: "toolCall", id: "tool-2", name: "env_safe_read", arguments: { value: "2" } },
								],
								"toolUse",
							),
						});
					} else {
						mockStream.push({
							type: "done",
							reason: "stop",
							message: createAssistantMessage([{ type: "text", text: "done" }]),
						});
					}
					callIndex++;
				});
				return mockStream;
			});

			for await (const _event of stream) {
				// consume
			}

			expect(maxActive).toBe(1);
		} finally {
			if (previous === undefined) {
				delete process.env.NANOPENCIL_MAX_TOOL_USE_CONCURRENCY;
			} else {
				process.env.NANOPENCIL_MAX_TOOL_USE_CONCURRENCY = previous;
			}
		}
	});

	it("should report structured-adaptive tool-call limit transitions", async () => {
		const toolSchema = Type.Object({});
		const tool: AgentTool<typeof toolSchema, Record<string, never>> = {
			name: "limited",
			label: "Limited",
			description: "Should not run when the batch exceeds the limit",
			parameters: toolSchema,
			async execute() {
				return { content: [{ type: "text", text: "ran" }], details: {} };
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxToolCallsPerPrompt: 1,
		};

		const stream = structuredAdaptiveAgentLoop([createUserMessage("run twice")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "toolUse",
					message: createAssistantMessage(
						[
							{ type: "toolCall", id: "tool-1", name: "limited", arguments: {} },
							{ type: "toolCall", id: "tool-2", name: "limited", arguments: {} },
						],
						"toolUse",
					),
				});
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.lastTransition).toEqual({
			reason: "tool_call_limit_reached",
			maxToolCalls: 1,
			requestedToolCalls: 2,
			toolCallCount: 0,
		});
		expect(result?.errorSubtype).toBe("tool_call_limit_reached");
		const toolResultEnds = events.filter(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "toolResult",
		);
		expect(toolResultEnds.map((event) => event.message.toolCallId)).toEqual(["tool-1", "tool-2"]);
		expect(toolResultEnds.every((event) => event.message.isError)).toBe(true);
	});

	it("should return custom input validation failures as tool results", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let executed = false;
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "guarded",
			label: "Guarded",
			description: "Guarded tool",
			parameters: toolSchema,
			validateInput(params) {
				return params.value === "bad" ? "value is not allowed" : undefined;
			},
			async execute(_toolCallId, params) {
				executed = true;
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("run guarded")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tool-1", name: "guarded", arguments: { value: "bad" } }],
							"toolUse",
						),
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "handled" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(executed).toBe(false);
		const toolResult = events.find(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "toolResult",
		)?.message;
		expect(toolResult?.isError).toBe(true);
		expect(toolResult?.content[0]?.type === "text" ? toolResult.content[0].text : "").toContain(
			"value is not allowed",
		);
	});

	it("should enforce an aggregate tool result batch budget before the next model request", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "budget_read",
			label: "Budget read",
			description: "Returns text large enough to trigger aggregate budget enforcement",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params) {
				const text = params.value === "small" ? "small-output" : "L".repeat(200);
				return {
					content: [{ type: "text", text }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxToolResultBatchSizeChars: 90,
		};

		let secondRequestToolResults: Extract<AgentMessage, { role: "toolResult" }>[] = [];
		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("read small and large")], context, config, undefined, (_model, ctx) => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[
								{ type: "toolCall", id: "tool-small", name: "budget_read", arguments: { value: "small" } },
								{ type: "toolCall", id: "tool-large", name: "budget_read", arguments: { value: "large" } },
							],
							"toolUse",
						),
					});
				} else {
					secondRequestToolResults = ctx.messages.filter(
						(message): message is Extract<AgentMessage, { role: "toolResult" }> => message.role === "toolResult",
					);
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "done" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(secondRequestToolResults.map((result) => result.toolCallId)).toEqual(["tool-small", "tool-large"]);
		expect(readToolResultText(secondRequestToolResults[0]!)).toBe("small-output");
		expect(totalToolResultTextLength(secondRequestToolResults)).toBeLessThanOrEqual(90);
		expect(readToolResultText(secondRequestToolResults[1]!)).toContain("Tool result truncated by batch budget");
		expect((secondRequestToolResults[1]!.details as { truncationReason?: string }).truncationReason).toBe(
			"tool_result_batch_budget",
		);

		const eventToolResults = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "toolResult",
			)
			.map((event) => event.message);
		expect(totalToolResultTextLength(eventToolResults)).toBeLessThanOrEqual(90);
	});

	it("should return permission denials as tool results without executing the tool", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let executed = false;
		let permissionInput: unknown;
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "guarded_write",
			label: "Guarded write",
			description: "Guarded write tool",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				executed = true;
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			canUseTool(event) {
				permissionInput = event.input;
				return { decision: "deny", reason: "write tools require approval" };
			},
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("run guarded write")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tool-1", name: "guarded_write", arguments: { value: "draft" } }],
							"toolUse",
						),
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "handled" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(executed).toBe(false);
		expect(permissionInput).toEqual({ value: "draft" });
		const toolResult = events.find(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "toolResult",
		)?.message;
		expect(toolResult?.isError).toBe(true);
		expect(toolResult?.content[0]?.type === "text" ? toolResult.content[0].text : "").toContain(
			"Permission denied: write tools require approval",
		);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.permissionDenialCount).toBe(1);
		expect(result?.permissionDenials).toEqual([
			{
				toolCallId: "tool-1",
				toolName: "guarded_write",
				reason: "write tools require approval",
			},
		]);
	});

	it("should classify permission denials thrown by wrapped tools", async () => {
		const toolSchema = Type.Object({});
		const tool: AgentTool<typeof toolSchema, Record<string, never>> = {
			name: "wrapped_write",
			label: "Wrapped write",
			description: "Wrapped mutating tool",
			parameters: toolSchema,
			async execute() {
				throw new Error("Permission denied for this tool call.");
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("run wrapped write")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tool-1", name: "wrapped_write", arguments: {} }],
							"toolUse",
						),
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "handled" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.permissionDenialCount).toBe(1);
		expect(result?.permissionDenials).toEqual([
			{
				toolCallId: "tool-1",
				toolName: "wrapped_write",
				reason: "Permission denied for this tool call.",
			},
		]);
	});

	it("should truncate oversized tool results when maxResultSizeChars is set", async () => {
		const toolSchema = Type.Object({});
		const tool: AgentTool<typeof toolSchema, Record<string, never>> = {
			name: "large",
			label: "Large",
			description: "Large result tool",
			parameters: toolSchema,
			maxResultSizeChars: 5,
			async execute() {
				return {
					content: [{ type: "text", text: "abcdefghijklmnopqrstuvwxyz" }],
					details: {},
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("run large")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.push({
						type: "done",
						reason: "toolUse",
						message: createAssistantMessage(
							[{ type: "toolCall", id: "tool-1", name: "large", arguments: {} }],
							"toolUse",
						),
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "handled" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const toolResult = events.find(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "toolResult",
		)?.message;
		const text = toolResult?.content[0]?.type === "text" ? toolResult.content[0].text : "";
		expect(text.startsWith("abcde")).toBe(true);
		expect(text).toContain("Tool result truncated to 5 characters");
	});

	it("should recover once when output stops due to max output tokens", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxTokens: 100,
		};

		let callIndex = 0;
		let sawRecoveryPrompt = false;
		const requestedMaxTokens: Array<number | undefined> = [];
		const stream = structuredAdaptiveAgentLoop(
			[createUserMessage("write long")],
			context,
			config,
			undefined,
			(_model, ctx, options) => {
				requestedMaxTokens.push(options?.maxTokens);
				if (callIndex === 1) {
					sawRecoveryPrompt = ctx.messages.some((message) => {
						if (message.role !== "user") return false;
						if (typeof message.content === "string") return message.content.includes("output-token recovery");
						return message.content.some(
							(part) => part.type === "text" && part.text.includes("output-token recovery"),
						);
					});
				}
				const mockStream = new MockAssistantStream();
				queueMicrotask(() => {
					if (callIndex === 0) {
						const message = createAssistantMessage([{ type: "text", text: "partial" }], "length");
						message.usage.output = 100;
						message.usage.totalTokens = 100;
						mockStream.push({
							type: "done",
							reason: "length",
							message,
						});
					} else {
						mockStream.push({
							type: "done",
							reason: "stop",
							message: createAssistantMessage([{ type: "text", text: "continued" }]),
						});
					}
					callIndex++;
				});
				return mockStream;
			},
		);

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(sawRecoveryPrompt).toBe(true);
		expect(requestedMaxTokens).toEqual([100, 150]);
		const assistantEnds = events.filter(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "assistant",
		);
		expect(assistantEnds.map((event) => event.message.stopReason)).toEqual(["length", "stop"]);
		const requestStarts = events.filter(
			(event): event is Extract<AgentEvent, { type: "stream_request_start" }> =>
				event.type === "stream_request_start",
		);
		expect(requestStarts.map((event) => event.maxTokens)).toEqual([100, 150]);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.lastTransition).toEqual({ reason: "max_output_tokens_recovery", attempt: 1 });
		expect(result?.transitions).toEqual([{ reason: "max_output_tokens_recovery", attempt: 1 }]);
	});

	it("should close interrupted structured-adaptive tool calls with synthetic tool results", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const stream = structuredAdaptiveAgentLoop([createUserMessage("start tool")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage(
					[{ type: "toolCall", id: "tool-1", name: "slow_tool", arguments: { value: "draft" } }],
					"aborted",
				);
				message.errorMessage = "User aborted";
				mockStream.push({ type: "error", reason: "aborted", error: message });
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const toolResults = events
			.filter((event): event is Extract<AgentEvent, { type: "message_end" }> => event.type === "message_end")
			.map((event) => event.message)
			.filter((message): message is Extract<AgentMessage, { role: "toolResult" }> => message.role === "toolResult");
		expect(toolResults).toHaveLength(1);
		expect(toolResults[0]).toMatchObject({
			toolCallId: "tool-1",
			toolName: "slow_tool",
			isError: true,
			details: {
				errorType: "interrupted_tool_call",
				stopReason: "aborted",
			},
		});
		expect(readToolResultText(toolResults[0])).toContain("interrupted");
		const turnEnd = events.find((event): event is Extract<AgentEvent, { type: "turn_end" }> => event.type === "turn_end");
		expect(turnEnd?.toolResults.map((result) => result.toolCallId)).toEqual(["tool-1"]);
	});

	it("should abort structured-adaptive loop when a custom assistant stream never yields", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const controller = new AbortController();
		const stream = structuredAdaptiveAgentLoop(
			[createUserMessage("wait")],
			context,
			config,
			controller.signal,
			() => new MockAssistantStream(),
		);
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort structured-adaptive loop while a custom assistant stream is still being created", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const controller = new AbortController();
		const stream = structuredAdaptiveAgentLoop(
			[createUserMessage("wait")],
			context,
			config,
			controller.signal,
			() => new Promise<MockAssistantStream>(() => {}),
		);
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort structured-adaptive loop while context transform is still running", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			transformContext: () => new Promise<AgentMessage[]>(() => {}),
			convertToLlm: identityConverter,
		};
		const controller = new AbortController();
		const stream = structuredAdaptiveAgentLoop([createUserMessage("wait")], context, config, controller.signal, () => {
			throw new Error("streamFn should not be called after an aborted context transform");
		});
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort structured-adaptive loop while LLM message conversion is still running", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: () => new Promise<Message[]>(() => {}),
		};
		const controller = new AbortController();
		const stream = structuredAdaptiveAgentLoop([createUserMessage("wait")], context, config, controller.signal, () => {
			throw new Error("streamFn should not be called after an aborted LLM conversion");
		});
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort structured-adaptive loop while API key resolution is still running", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getApiKey: () => new Promise<string | undefined>(() => {}),
		};
		const controller = new AbortController();
		const stream = structuredAdaptiveAgentLoop([createUserMessage("wait")], context, config, controller.signal, () => {
			throw new Error("streamFn should not be called after an aborted API key resolution");
		});
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort structured-adaptive loop while initial steering messages are still loading", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getSteeringMessages: () => new Promise<AgentMessage[]>(() => {}),
		};
		const controller = new AbortController();
		const stream = structuredAdaptiveAgentLoop([createUserMessage("wait")], context, config, controller.signal, () => {
			throw new Error("streamFn should not be called after an aborted initial steering read");
		});
		queueMicrotask(() => controller.abort());

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should continue when a configured output token budget is underused", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			outputTokenBudget: {
				targetTokens: 100,
				thresholdPct: 0.9,
				maxContinuations: 2,
			},
		};

		let callIndex = 0;
		let sawBudgetContinuation = false;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("write deeply")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 1) {
				sawBudgetContinuation = ctx.messages.some((message) => {
					if (message.role !== "user") return false;
					if (typeof message.content === "string") return message.content.includes("output token budget");
					return message.content.some(
						(part) => part.type === "text" && part.text.includes("output token budget"),
					);
				});
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([
					{ type: "text", text: callIndex === 0 ? "partial" : "expanded" },
				]);
				message.usage.output = callIndex === 0 ? 30 : 70;
				message.usage.totalTokens = message.usage.output;
				mockStream.push({ type: "done", reason: "stop", message });
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(callIndex).toBe(2);
		expect(sawBudgetContinuation).toBe(true);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.usage?.output).toBe(100);
		expect(result?.lastTransition).toEqual({
			reason: "token_budget_continuation",
			continuationCount: 1,
			outputTokens: 30,
			targetTokens: 100,
		});
	});

	it("should stop output token budget continuation at the configured limit", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			outputTokenBudget: {
				targetTokens: 1000,
				maxContinuations: 1,
			},
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("write deeply")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: `chunk ${callIndex}` }]);
				message.usage.output = 10;
				message.usage.totalTokens = 10;
				mockStream.push({ type: "done", reason: "stop", message });
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(callIndex).toBe(2);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.usage?.output).toBe(20);
		expect(result?.lastTransition).toEqual({
			reason: "token_budget_continuation",
			continuationCount: 1,
			outputTokens: 10,
			targetTokens: 1000,
		});
	});

	it("should emit a structured-adaptive agent_result summary before agent_end", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const stream = structuredAdaptiveAgentLoop([createUserMessage("hello")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "hi" }]);
				message.usage = {
					...createUsage(),
					input: 2,
					output: 3,
					totalTokens: 5,
					cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
				};
				mockStream.push({
					type: "done",
					reason: "stop",
					message,
				});
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const resultIndex = events.findIndex((event) => event.type === "agent_result");
		const endIndex = events.findIndex((event) => event.type === "agent_end");
		const requestIndex = events.findIndex((event) => event.type === "stream_request_start");
		expect(requestIndex).toBeGreaterThanOrEqual(0);
		const request = events[requestIndex];
		expect(request?.type).toBe("stream_request_start");
		if (request?.type === "stream_request_start") {
			expect(request.model).toBe("mock");
			expect(request.provider).toBe("openai");
			expect(request.messageCount).toBe(1);
		}
		expect(resultIndex).toBeGreaterThanOrEqual(0);
		expect(endIndex).toBeGreaterThan(resultIndex);
		const result = events[resultIndex];
		expect(result?.type).toBe("agent_result");
		if (result?.type === "agent_result") {
			expect(result.stopReason).toBe("stop");
			expect(result.turnCount).toBe(1);
			expect(result.toolCallCount).toBe(0);
			expect(result.usage?.input).toBe(2);
			expect(result.usage?.output).toBe(3);
			expect(result.usage?.totalTokens).toBe(5);
			expect(result.usage?.cost.total).toBe(0.03);
			expect(result.permissionDenialCount).toBe(0);
			expect(result.permissionDenials).toEqual([]);
			expect(typeof result.durationMs).toBe("number");
		}
	});

	it("should finalize structured-adaptive streams that end with a result but no done event", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getFollowUpMessages: (() => {
				let delivered = false;
				return () => {
					if (delivered) return [];
					delivered = true;
					return [createUserMessage("follow up")];
				};
			})(),
		};

		let callIndex = 0;
		let sawFinalAssistantInSecondRequest = false;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("hello")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 1) {
				sawFinalAssistantInSecondRequest = ctx.messages.some(
					(message) =>
						message.role === "assistant" &&
						message.content.some((part) => part.type === "text" && part.text === "final"),
				);
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					mockStream.end(createAssistantMessage([{ type: "text", text: "final" }]));
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "second" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const assistantEnds = events.filter(
			(event): event is Extract<AgentEvent, { type: "message_end" }> =>
				event.type === "message_end" && event.message.role === "assistant",
		);
		expect(assistantEnds.map((event) => event.message.content)).toEqual([
			[{ type: "text", text: "final" }],
			[{ type: "text", text: "second" }],
		]);
		expect(sawFinalAssistantInSecondRequest).toBe(true);
	});

	it("should finalize structured-adaptive done events without waiting for result()", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const finalMessage = createAssistantMessage([{ type: "text", text: "event final" }]);
		const stream = structuredAdaptiveAgentLoop([createUserMessage("hello")], context, config, undefined, () =>
			createFinalEventWithHangingResultStream({ type: "done", reason: "stop", message: finalMessage }),
		);

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const messages = await withTimeout(stream.result(), 100);

		expect(messages.at(-1)).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "event final" }],
			stopReason: "stop",
		});
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("stop");
	});

	it("should fail structured-adaptive eventless streams that end without a result", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const stream = structuredAdaptiveAgentLoop([createUserMessage("hello")], context, config, undefined, () =>
			createEventlessEndWithHangingResultStream(),
		);

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const messages = await withTimeout(stream.result(), 100);
		const finalAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant",
		);

		expect(finalAssistant?.stopReason).toBe("error");
		expect(finalAssistant?.errorMessage).toBe("Provider stream ended without a final assistant message");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("error");
		expect(result?.errorSubtype).toBe("model_error");
	});

	it("should classify context overflow errors in structured-adaptive agent_result", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const stream = structuredAdaptiveAgentLoop([createUserMessage("too much context")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([], "error");
				message.errorMessage = "maximum context length is 8192 tokens";
				mockStream.push({
					type: "done",
					reason: "error",
					message,
				});
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("error");
		expect(result?.errorSubtype).toBe("context_overflow");
		expect(result?.errorMessage).toContain("maximum context length");
	});

	it("should let a recovery hook replace context and retry model errors inside the loop", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [createUserMessage("old context")],
			tools: [],
		};
		let recoveryCalls = 0;
		let sawRecoveredContext = false;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			recoverModelError: ({ errorSubtype, attempt }) => {
				recoveryCalls += 1;
				expect(errorSubtype).toBe("context_overflow");
				expect(attempt).toBe(1);
				return {
					action: "retry",
					messages: [createUserMessage("compacted context")],
					transition: { reason: "model_error_recovery", subtype: errorSubtype, attempt },
				};
			},
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("too much context")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 1) {
				sawRecoveredContext = ctx.messages.some(
					(message) =>
						message.role === "user" &&
						typeof message.content === "string" &&
						message.content === "compacted context",
				);
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					const message = createAssistantMessage([], "error");
					message.errorMessage = "maximum context length is 8192 tokens";
					mockStream.push({
						type: "done",
						reason: "error",
						message,
					});
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "recovered" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(recoveryCalls).toBe(1);
		expect(sawRecoveredContext).toBe(true);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("stop");
		expect(result?.lastTransition).toEqual({
			reason: "model_error_recovery",
			subtype: "context_overflow",
			attempt: 1,
		});
	});

	it("should recover structured-adaptive custom stream iterator errors", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [createUserMessage("old context")],
			tools: [],
		};
		let recoveryCalls = 0;
		let sawRecoveredContext = false;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			recoverModelError: ({ errorSubtype, attempt }) => {
				recoveryCalls += 1;
				expect(errorSubtype).toBe("context_overflow");
				expect(attempt).toBe(1);
				return {
					action: "retry",
					messages: [createUserMessage("compacted context")],
					transition: { reason: "model_error_recovery", subtype: errorSubtype, attempt },
				};
			},
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("too much context")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 0) {
				callIndex++;
				return createRejectingAssistantStream(new Error("maximum context length is 8192 tokens"));
			}
			sawRecoveredContext = ctx.messages.some(
				(message) =>
					message.role === "user" &&
					typeof message.content === "string" &&
					message.content === "compacted context",
			);
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "recovered" }]),
				});
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(recoveryCalls).toBe(1);
		expect(sawRecoveredContext).toBe(true);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("stop");
		expect(result?.lastTransition).toEqual({
			reason: "model_error_recovery",
			subtype: "context_overflow",
			attempt: 1,
		});
	});

	it("should not carry permission denials from recovered streaming tool attempts", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		let toolExecuted = false;
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "guarded_stream_read",
			label: "Guarded stream read",
			description: "Safe streamed tool guarded by permission",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute() {
				toolExecuted = true;
				return {
					content: [{ type: "text", text: "should not execute" }],
					details: {},
				};
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [tool],
		};
		let recoveryCalls = 0;
		let permissionChecks = 0;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			canUseTool: () => {
				permissionChecks += 1;
				return { decision: "deny", reason: "outside workspace" };
			},
			recoverModelError: ({ errorSubtype, attempt }) => {
				recoveryCalls += 1;
				return {
					action: "retry",
					messages: [createUserMessage("recovered context")],
					transition: { reason: "model_error_recovery", subtype: errorSubtype, attempt },
				};
			},
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("stream guarded read")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				if (callIndex === 0) {
					const toolCall = {
						type: "toolCall" as const,
						id: "tool-1",
						name: "guarded_stream_read",
						arguments: { value: "early" },
					};
					const partial = createAssistantMessage([toolCall], "toolUse");
					mockStream.push({ type: "start", partial });
					mockStream.push({ type: "toolcall_start", contentIndex: 0, partial });
					mockStream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial });
					const errorMessage = createAssistantMessage([toolCall], "error");
					errorMessage.errorMessage = "upstream 503 service unavailable";
					mockStream.push({ type: "error", reason: "error", error: errorMessage });
				} else {
					mockStream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage([{ type: "text", text: "recovered" }]),
					});
				}
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(recoveryCalls).toBe(1);
		expect(permissionChecks).toBe(1);
		expect(toolExecuted).toBe(false);
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("stop");
		expect(result?.permissionDenialCount).toBe(0);
		expect(result?.permissionDenials).toEqual([]);
		const returnedMessages = await stream.result();
		expect(returnedMessages.some((message) => message.role === "toolResult")).toBe(false);
		expect(
			returnedMessages.some((message) => message.role === "assistant" && message.stopReason === "error"),
		).toBe(false);
	});

	it("should allow stop hooks to inject a continuation turn", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		let hookCalls = 0;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			runStopHooks: () => {
				hookCalls += 1;
				if (hookCalls === 1) {
					return {
						action: "continue",
						messages: [createUserMessage("Stop hook says revise the final answer.")],
					};
				}
				return { action: "stop" };
			},
		};

		let callIndex = 0;
		let sawStopHookMessage = false;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("answer")], context, config, undefined, (_model, ctx) => {
			if (callIndex === 1) {
				sawStopHookMessage = ctx.messages.some((message) => {
					if (message.role !== "user") return false;
					if (typeof message.content === "string") return message.content.includes("Stop hook says");
					return message.content.some((part) => part.type === "text" && part.text.includes("Stop hook says"));
				});
			}
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([
						{ type: "text", text: callIndex === 0 ? "draft" : "revised" },
					]),
				});
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(hookCalls).toBe(2);
		expect(sawStopHookMessage).toBe(true);
		const assistantTexts = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "assistant",
			)
			.map((event) =>
				event.message.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
		);
		expect(assistantTexts).toEqual(["draft", "revised"]);
	});

	it("should abort structured-adaptive loop while stop hooks are still running", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const controller = new AbortController();
		let hookCalls = 0;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			runStopHooks: () => {
				hookCalls += 1;
				queueMicrotask(() => controller.abort());
				return new Promise(() => {});
			},
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("answer")], context, config, controller.signal, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "draft" }]),
				});
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		expect(callIndex).toBe(1);
		expect(hookCalls).toBe(1);
		const finalAssistant = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "assistant",
			)
			.at(-1)?.message as AssistantMessage | undefined;
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should abort structured-adaptive loop while follow-up messages are still loading", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const controller = new AbortController();
		let followUpCalls = 0;
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			getFollowUpMessages: () => {
				followUpCalls += 1;
				queueMicrotask(() => controller.abort());
				return new Promise<AgentMessage[]>(() => {});
			},
		};

		let callIndex = 0;
		const stream = structuredAdaptiveAgentLoop([createUserMessage("answer")], context, config, controller.signal, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "draft" }]),
				});
				callIndex++;
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);

		expect(callIndex).toBe(1);
		expect(followUpCalls).toBe(1);
		const finalAssistant = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "assistant",
			)
			.at(-1)?.message as AssistantMessage | undefined;
		expect(finalAssistant?.stopReason).toBe("aborted");
		expect(finalAssistant?.errorMessage).toBe("Request was aborted");
		const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> =>
			event.type === "agent_result",
		);
		expect(result?.stopReason).toBe("aborted");
		expect(result?.errorSubtype).toBe("aborted");
	});

	it("should stop when stop hook continuation limit is reached", async () => {
		const context: AgentContext = {
			systemPrompt: "",
			messages: [],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			maxStopHookContinuations: 1,
			runStopHooks: () => ({
				action: "continue",
				messages: [createUserMessage("revise again")],
			}),
		};

		const stream = structuredAdaptiveAgentLoop([createUserMessage("answer")], context, config, undefined, () => {
			const mockStream = new MockAssistantStream();
			queueMicrotask(() => {
				mockStream.push({
					type: "done",
					reason: "stop",
					message: createAssistantMessage([{ type: "text", text: "draft" }]),
				});
			});
			return mockStream;
		});

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const finalAssistant = events
			.filter(
				(event): event is Extract<AgentEvent, { type: "message_end" }> =>
					event.type === "message_end" && event.message.role === "assistant",
			)
			.at(-1)?.message as AssistantMessage | undefined;
		expect(finalAssistant?.stopReason).toBe("error");
		expect(finalAssistant?.errorMessage).toContain("stop_hook_limit_reached");
	});
});

describe("agentLoopContinue with AgentMessage", () => {
	it("should throw when context has no messages", () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		expect(() => agentLoopContinue(context, config)).toThrow("Cannot continue: no messages in context");
	});

	it("should continue from existing context without emitting user message events", async () => {
		const userMessage: AgentMessage = createUserMessage("Hello");

		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [userMessage],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "Response" }]);
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		const events: AgentEvent[] = [];
		const stream = agentLoopContinue(context, config, undefined, streamFn);

		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();

		// Should only return the new assistant message (not the existing user message)
		expect(messages.length).toBe(1);
		expect(messages[0].role).toBe("assistant");

		// Should NOT have user message events (that's the key difference from agentLoop)
		const messageEndEvents = events.filter((e) => e.type === "message_end");
		expect(messageEndEvents.length).toBe(1);
		expect((messageEndEvents[0] as any).message.role).toBe("assistant");
	});

	it("should allow custom message types as last message (caller responsibility)", async () => {
		// Custom message that will be converted to user message by convertToLlm
		interface CustomMessage {
			role: "custom";
			text: string;
			timestamp: number;
		}

		const customMessage: CustomMessage = {
			role: "custom",
			text: "Hook content",
			timestamp: Date.now(),
		};

		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [customMessage as unknown as AgentMessage],
			tools: [],
		};

		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: (messages) => {
				// Convert custom to user message
				return messages
					.map((m) => {
						if ((m as any).role === "custom") {
							return {
								role: "user" as const,
								content: (m as any).text,
								timestamp: m.timestamp,
							};
						}
						return m;
					})
					.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
			},
		};

		const streamFn = () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				const message = createAssistantMessage([{ type: "text", text: "Response to custom message" }]);
				stream.push({ type: "done", reason: "stop", message });
			});
			return stream;
		};

		// Should not throw - the custom message will be converted to user message
		const stream = agentLoopContinue(context, config, undefined, streamFn);

		const events: AgentEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		const messages = await stream.result();
		expect(messages.length).toBe(1);
		expect(messages[0].role).toBe("assistant");
	});
});
