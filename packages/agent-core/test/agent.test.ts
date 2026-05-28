import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel, type Model } from "@pencil-agent/ai";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { Agent, type AgentMessage, type AgentTool } from "../src/index.js";

// Mock stream that mimics AssistantMessageEventStream
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

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createErrorMessage(message: string): AssistantMessage {
	return {
		...createAssistantMessage(""),
		stopReason: "error",
		errorMessage: message,
	};
}

function createToolUseMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		...createAssistantMessage(""),
		content,
		stopReason: "toolUse",
	};
}

describe("Agent", () => {
	it("should create an agent instance with default state", () => {
		const agent = new Agent();

		expect(agent.state).toBeDefined();
		expect(agent.state.systemPrompt).toBe("");
		expect(agent.state.model).toBeDefined();
		expect(agent.state.thinkingLevel).toBe("off");
		expect(agent.state.tools).toEqual([]);
		expect(agent.state.messages).toEqual([]);
		expect(agent.state.isStreaming).toBe(false);
		expect(agent.state.streamMessage).toBe(null);
		expect(agent.state.pendingToolCalls).toEqual(new Set());
		expect(agent.state.error).toBeUndefined();
		expect(agent.state.lastResult).toBeUndefined();
	});

	it("should create an agent instance with custom initial state", () => {
		const customModel = getModel("openai", "gpt-4o-mini");
		const agent = new Agent({
			initialState: {
				systemPrompt: "You are a helpful assistant.",
				model: customModel,
				thinkingLevel: "low",
			},
		});

		expect(agent.state.systemPrompt).toBe("You are a helpful assistant.");
		expect(agent.state.model).toBe(customModel);
		expect(agent.state.thinkingLevel).toBe("low");
	});

	it("should select the model configured agent loop framework", async () => {
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
				return { content: [{ type: "text", text: params.value }], details: { value: params.value } };
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
				return { content: [{ type: "text", text: params.value }], details: { value: params.value } };
			},
		};

		const model = {
			...getModel("openai", "gpt-4o-mini"),
			agentLoopFramework: "weak-model-compatible",
		} as Model<any> & { agentLoopFramework: "weak-model-compatible" };
		let callIndex = 0;
		const agent = new Agent({
			initialState: {
				model,
				tools: [slowTool, fastTool],
			},
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (callIndex === 0) {
						stream.push({
							type: "done",
							reason: "toolUse",
							message: createToolUseMessage([
								{ type: "toolCall", id: "tool-1", name: "slow_read", arguments: { value: "first" } },
								{ type: "toolCall", id: "tool-2", name: "fast_read", arguments: { value: "second" } },
							]),
						});
					} else {
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("done") });
					}
					callIndex++;
				});
				return stream;
			},
		});

		expect(agent.agentLoopFramework).toBe("weak-model-compatible");
		await agent.prompt("read both");

		expect(executionOrder.slice(0, 2)).toEqual(["start:first", "start:second"]);
		const toolResults = agent.state.messages
			.filter((message) => message.role === "toolResult")
			.map((message) => message.toolCallId);
		expect(toolResults).toEqual(["tool-1", "tool-2"]);
	});

	it("should keep standard loop serial while sharing tool permission gates", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const executionOrder: string[] = [];
		const events: string[] = [];
		let permissionChecks = 0;

		const slowTool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "slow_read",
			label: "Slow read",
			description: "Safe slow tool",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params) {
				executionOrder.push(`start:${params.value}`);
				await new Promise((resolve) => setTimeout(resolve, 0));
				executionOrder.push(`end:${params.value}`);
				return { content: [{ type: "text", text: params.value }], details: { value: params.value } };
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
				executionOrder.push(`end:${params.value}`);
				return { content: [{ type: "text", text: params.value }], details: { value: params.value } };
			},
		};

		let callIndex = 0;
		const agent = new Agent({
			initialState: {
				tools: [slowTool, fastTool],
			},
			canUseTool() {
				permissionChecks++;
				return { decision: "allow" };
			},
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (callIndex === 0) {
						stream.push({
							type: "done",
							reason: "toolUse",
							message: createToolUseMessage([
								{ type: "toolCall", id: "tool-1", name: "slow_read", arguments: { value: "first" } },
								{ type: "toolCall", id: "tool-2", name: "fast_read", arguments: { value: "second" } },
							]),
						});
					} else {
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("done") });
					}
					callIndex++;
				});
				return stream;
			},
		});
		agent.subscribe((event) => events.push(event.type));

		expect(agent.agentLoopFramework).toBe("standard");
		await agent.prompt("read both");

		expect(executionOrder).toEqual(["start:first", "end:first", "start:second", "end:second"]);
		expect(permissionChecks).toBe(2);
		expect(events).toContain("stream_request_start");
		expect(events).toContain("agent_result");
		const toolResults = agent.state.messages.filter((message) => message.role === "toolResult");
		expect(toolResults).toHaveLength(2);
		expect(toolResults.every((message) => message.isError === false)).toBe(true);
	});

	it("should retain the last agent result summary in state", async () => {
		const agent = new Agent({
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					const message = createAssistantMessage("done");
					message.usage.input = 4;
					message.usage.output = 6;
					message.usage.totalTokens = 10;
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			},
		});

		await agent.prompt("answer");

		expect(agent.state.lastResult).toMatchObject({
			stopReason: "stop",
			turnCount: 1,
			toolCallCount: 0,
			usage: { input: 4, output: 6, totalTokens: 10 },
			permissionDenialCount: 0,
		});
		expect(agent.state.lastResult?.durationMs).toEqual(expect.any(Number));
	});

	it("should pass recoverModelError into the weak-model-compatible loop", async () => {
		const model = {
			...getModel("openai", "gpt-4o-mini"),
			agentLoopFramework: "weak-model-compatible",
			contextWindow: 8192,
		} as Model<any> & { agentLoopFramework: "weak-model-compatible" };
		let callIndex = 0;
		let recoveryCalls = 0;
		const agent = new Agent({
			initialState: { model },
			recoverModelError({ errorSubtype, attempt }) {
				recoveryCalls++;
				return {
					action: "retry",
					messages: [{ role: "user", content: "compacted", timestamp: Date.now() }],
					transition: { reason: "model_error_recovery", subtype: errorSubtype, attempt },
				};
			},
			streamFn: (_model, context) => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (callIndex === 0) {
						stream.push({
							type: "error",
							reason: "error",
							error: createErrorMessage("maximum context length is 8192 tokens"),
						});
					} else {
						expect(context.messages.some((message) => message.role === "user" && message.content === "compacted")).toBe(
							true,
						);
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("recovered") });
					}
					callIndex++;
				});
				return stream;
			},
		});

		await agent.prompt("too much");

		expect(recoveryCalls).toBe(1);
		const finalAssistant = agent.state.messages.filter((message) => message.role === "assistant").at(-1);
		expect(finalAssistant?.role).toBe("assistant");
		expect(finalAssistant?.stopReason).toBe("stop");
	});

	it("should pass aggregate tool result batch budget into the weak-model-compatible loop", async () => {
		const model = {
			...getModel("openai", "gpt-4o-mini"),
			agentLoopFramework: "weak-model-compatible",
		} as Model<any> & { agentLoopFramework: "weak-model-compatible" };
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "large_read",
			label: "Large read",
			description: "Returns large content",
			parameters: toolSchema,
			isConcurrencySafe: true,
			async execute(_toolCallId, params) {
				return {
					content: [{ type: "text", text: params.value.repeat(200) }],
					details: { value: params.value },
				};
			},
		};
		let callIndex = 0;
		const agent = new Agent({
			initialState: { model, tools: [tool] },
			maxToolResultBatchSizeChars: 80,
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (callIndex === 0) {
						stream.push({
							type: "done",
							reason: "toolUse",
							message: createToolUseMessage([
								{ type: "toolCall", id: "tool-1", name: "large_read", arguments: { value: "x" } },
							]),
						});
					} else {
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("done") });
					}
					callIndex++;
				});
				return stream;
			},
		});

		await agent.prompt("read");

		const toolResult = agent.state.messages.find((message) => message.role === "toolResult");
		expect(toolResult?.role).toBe("toolResult");
		const text = toolResult?.content[0]?.type === "text" ? toolResult.content[0].text : "";
		expect(text.length).toBeLessThanOrEqual(80);
		expect(text).toContain("Tool result truncated by batch budget");
	});

	it("should pass standard loop summary and output budget options", async () => {
		const toolSchema = Type.Object({ value: Type.String() });
		const tool: AgentTool<typeof toolSchema, { value: string }> = {
			name: "read_notes",
			label: "Read notes",
			description: "Returns note content",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				return {
					content: [{ type: "text", text: params.value }],
					details: { value: params.value },
				};
			},
		};
		const summaryMessage: AgentMessage = {
			role: "user",
			content: "Tool summary: read_notes returned concise context.",
			timestamp: Date.now(),
		};
		let callIndex = 0;
		let secondRequestSawSummary = false;
		const agent = new Agent({
			initialState: { tools: [tool] },
			createToolUseSummary() {
				return summaryMessage;
			},
			outputTokenBudget: {
				targetTokens: 100,
				maxContinuations: 1,
			},
			streamFn: (_model, context) => {
				const stream = new MockAssistantStream();
				if (callIndex === 1) {
					secondRequestSawSummary = context.messages.includes(summaryMessage);
				}
				queueMicrotask(() => {
					if (callIndex === 0) {
						stream.push({
							type: "done",
							reason: "toolUse",
							message: createToolUseMessage([
								{ type: "toolCall", id: "tool-1", name: "read_notes", arguments: { value: "notes" } },
							]),
						});
					} else {
						const message = createAssistantMessage(callIndex === 1 ? "short answer" : "expanded answer");
						message.usage.output = 10;
						message.usage.totalTokens = 10;
						stream.push({ type: "done", reason: "stop", message });
					}
					callIndex++;
				});
				return stream;
			},
		});

		await agent.prompt("read and answer");

		expect(secondRequestSawSummary).toBe(true);
		expect(callIndex).toBe(3);
		expect(
			agent.state.messages.some(
				(message) =>
					message.role === "user" &&
					message.content === "Tool summary: read_notes returned concise context.",
			),
		).toBe(true);
	});

	it("should update loop policy at runtime", async () => {
		let callIndex = 0;
		const agent = new Agent({
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					const message = createAssistantMessage(callIndex % 2 === 0 ? "short answer" : "expanded answer");
					message.usage.output = 10;
					message.usage.totalTokens = 10;
					stream.push({ type: "done", reason: "stop", message });
					callIndex++;
				});
				return stream;
			},
		});

		agent.setLoopPolicy({
			outputTokenBudget: {
				targetTokens: 100,
				maxContinuations: 1,
			},
		});

		await agent.prompt("answer with enough detail");

		expect(callIndex).toBe(2);

		agent.clearMessages();
		callIndex = 0;
		agent.setLoopPolicy({ outputTokenBudget: undefined });

		await agent.prompt("answer briefly");

		expect(callIndex).toBe(1);
	});

	it("should subscribe to events", () => {
		const agent = new Agent();

		let eventCount = 0;
		const unsubscribe = agent.subscribe((_event) => {
			eventCount++;
		});

		// No initial event on subscribe
		expect(eventCount).toBe(0);

		// State mutators don't emit events
		agent.setSystemPrompt("Test prompt");
		expect(eventCount).toBe(0);
		expect(agent.state.systemPrompt).toBe("Test prompt");

		// Unsubscribe should work
		unsubscribe();
		agent.setSystemPrompt("Another prompt");
		expect(eventCount).toBe(0); // Should not increase
	});

	it("should update state with mutators", () => {
		const agent = new Agent();

		// Test setSystemPrompt
		agent.setSystemPrompt("Custom prompt");
		expect(agent.state.systemPrompt).toBe("Custom prompt");

		// Test setModel
		const newModel = getModel("google", "gemini-2.5-flash");
		agent.setModel(newModel);
		expect(agent.state.model).toBe(newModel);

		// Test setThinkingLevel
		agent.setThinkingLevel("high");
		expect(agent.state.thinkingLevel).toBe("high");

		// Test setTools
		const tools = [{ name: "test", description: "test tool" } as any];
		agent.setTools(tools);
		expect(agent.state.tools).toBe(tools);

		// Test replaceMessages
		const messages = [{ role: "user" as const, content: "Hello", timestamp: Date.now() }];
		agent.replaceMessages(messages);
		expect(agent.state.messages).toEqual(messages);
		expect(agent.state.messages).not.toBe(messages); // Should be a copy

		// Test appendMessage
		const newMessage = { role: "assistant" as const, content: [{ type: "text" as const, text: "Hi" }] };
		agent.appendMessage(newMessage as any);
		expect(agent.state.messages).toHaveLength(2);
		expect(agent.state.messages[1]).toBe(newMessage);

		(agent.state as any).lastResult = {
			stopReason: "stop",
			turnCount: 1,
			toolCallCount: 0,
			durationMs: 1,
		};

		// Test clearMessages
		agent.clearMessages();
		expect(agent.state.messages).toEqual([]);
		expect(agent.state.lastResult).toBeUndefined();
	});

	it("should support steering message queue", async () => {
		const agent = new Agent();

		const message = { role: "user" as const, content: "Steering message", timestamp: Date.now() };
		agent.steer(message);

		// The message is queued but not yet in state.messages
		expect(agent.state.messages).not.toContainEqual(message);
	});

	it("should support follow-up message queue", async () => {
		const agent = new Agent();

		const message = { role: "user" as const, content: "Follow-up message", timestamp: Date.now() };
		agent.followUp(message);

		// The message is queued but not yet in state.messages
		expect(agent.state.messages).not.toContainEqual(message);
	});

	it("should handle abort controller", () => {
		const agent = new Agent();

		// Should not throw even if nothing is running
		expect(() => agent.abort()).not.toThrow();
	});

	it("should throw when prompt() called while streaming", async () => {
		let abortSignal: AbortSignal | undefined;
		const agent = new Agent({
			// Use a stream function that responds to abort
			streamFn: (_model, _context, options) => {
				abortSignal = options?.signal;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					// Check abort signal periodically
					const checkAbort = () => {
						if (abortSignal?.aborted) {
							stream.push({ type: "error", reason: "aborted", error: createAssistantMessage("Aborted") });
						} else {
							setTimeout(checkAbort, 5);
						}
					};
					checkAbort();
				});
				return stream;
			},
		});

		// Start first prompt (don't await, it will block until abort)
		const firstPrompt = agent.prompt("First message");

		// Wait a tick for isStreaming to be set
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(agent.state.isStreaming).toBe(true);

		// Second prompt should reject
		await expect(agent.prompt("Second message")).rejects.toThrow(
			"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
		);

		// Cleanup - abort to stop the stream
		agent.abort();
		await firstPrompt.catch(() => {}); // Ignore abort error
	});

	it("should emit message lifecycle events for setup errors before agent_end", async () => {
		const agent = new Agent({
			streamFn: () => {
				throw new Error("stream setup failed");
			},
		});

		const events: string[] = [];
		agent.subscribe((event) => {
			if (event.type === "message_start" && event.message.role === "assistant") {
				events.push("message_start");
			}
			if (event.type === "message_end" && event.message.role === "assistant") {
				events.push("message_end");
			}
			if (event.type === "agent_result") {
				events.push("agent_result");
			}
			if (event.type === "agent_end") {
				events.push("agent_end");
			}
		});

		await expect(agent.prompt("trigger failure")).resolves.toBeUndefined();

		expect(events).toEqual(["message_start", "message_end", "agent_result", "agent_end"]);
		expect(agent.state.messages.at(-1)?.role).toBe("assistant");
		expect((agent.state.messages.at(-1) as AssistantMessage | undefined)?.errorMessage).toBe("stream setup failed");
		expect(agent.state.lastResult).toMatchObject({
			stopReason: "error",
			turnCount: 0,
			toolCallCount: 0,
			errorMessage: "stream setup failed",
			errorSubtype: "loop_error",
		});
	});

	it("should throw when continue() called while streaming", async () => {
		let abortSignal: AbortSignal | undefined;
		const agent = new Agent({
			streamFn: (_model, _context, options) => {
				abortSignal = options?.signal;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					const checkAbort = () => {
						if (abortSignal?.aborted) {
							stream.push({ type: "error", reason: "aborted", error: createAssistantMessage("Aborted") });
						} else {
							setTimeout(checkAbort, 5);
						}
					};
					checkAbort();
				});
				return stream;
			},
		});

		// Start first prompt
		const firstPrompt = agent.prompt("First message");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(agent.state.isStreaming).toBe(true);

		// continue() should reject
		await expect(agent.continue()).rejects.toThrow(
			"Agent is already processing. Wait for completion before continuing.",
		);

		// Cleanup
		agent.abort();
		await firstPrompt.catch(() => {});
	});

	it("continue() should process queued follow-up messages after an assistant turn", async () => {
		const agent = new Agent({
			streamFn: () => {
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("Processed") });
				});
				return stream;
			},
		});

		agent.replaceMessages([
			{
				role: "user",
				content: [{ type: "text", text: "Initial" }],
				timestamp: Date.now() - 10,
			},
			createAssistantMessage("Initial response"),
		]);

		agent.followUp({
			role: "user",
			content: [{ type: "text", text: "Queued follow-up" }],
			timestamp: Date.now(),
		});

		await expect(agent.continue()).resolves.toBeUndefined();

		const hasQueuedFollowUp = agent.state.messages.some((message) => {
			if (message.role !== "user") return false;
			if (typeof message.content === "string") return message.content === "Queued follow-up";
			return message.content.some((part) => part.type === "text" && part.text === "Queued follow-up");
		});

		expect(hasQueuedFollowUp).toBe(true);
		expect(agent.state.messages[agent.state.messages.length - 1].role).toBe("assistant");
	});

	it("continue() should keep one-at-a-time steering semantics from assistant tail", async () => {
		let responseCount = 0;
		const agent = new Agent({
			streamFn: () => {
				const stream = new MockAssistantStream();
				responseCount++;
				queueMicrotask(() => {
					stream.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage(`Processed ${responseCount}`),
					});
				});
				return stream;
			},
		});

		agent.replaceMessages([
			{
				role: "user",
				content: [{ type: "text", text: "Initial" }],
				timestamp: Date.now() - 10,
			},
			createAssistantMessage("Initial response"),
		]);

		agent.steer({
			role: "user",
			content: [{ type: "text", text: "Steering 1" }],
			timestamp: Date.now(),
		});
		agent.steer({
			role: "user",
			content: [{ type: "text", text: "Steering 2" }],
			timestamp: Date.now() + 1,
		});

		await expect(agent.continue()).resolves.toBeUndefined();

		const recentMessages = agent.state.messages.slice(-4);
		expect(recentMessages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
		expect(responseCount).toBe(2);
	});

	it("forwards sessionId to streamFn options", async () => {
		let receivedSessionId: string | undefined;
		const agent = new Agent({
			sessionId: "session-abc",
			streamFn: (_model, _context, options) => {
				receivedSessionId = options?.sessionId;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					const message = createAssistantMessage("ok");
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			},
		});

		await agent.prompt("hello");
		expect(receivedSessionId).toBe("session-abc");

		// Test setter
		agent.sessionId = "session-def";
		expect(agent.sessionId).toBe("session-def");

		await agent.prompt("hello again");
		expect(receivedSessionId).toBe("session-def");
	});
});
