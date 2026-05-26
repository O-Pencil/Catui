import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel, type Model } from "@pencil-agent/ai";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { Agent, type AgentTool } from "../src/index.js";

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

	it("should keep weak-model-compatible behavior opt-in so the default standard loop is unchanged", async () => {
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
				return { decision: "deny", reason: "weak-model-compatible only" };
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
		expect(permissionChecks).toBe(0);
		expect(events).not.toContain("stream_request_start");
		expect(events).not.toContain("agent_result");
		const toolResults = agent.state.messages.filter((message) => message.role === "toolResult");
		expect(toolResults).toHaveLength(2);
		expect(toolResults.every((message) => message.isError === false)).toBe(true);
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

		// Test clearMessages
		agent.clearMessages();
		expect(agent.state.messages).toEqual([]);
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
			if (event.type === "agent_end") {
				events.push("agent_end");
			}
		});

		await expect(agent.prompt("trigger failure")).resolves.toBeUndefined();

		expect(events).toEqual(["message_start", "message_end", "agent_end"]);
		expect(agent.state.messages.at(-1)?.role).toBe("assistant");
		expect((agent.state.messages.at(-1) as AssistantMessage | undefined)?.errorMessage).toBe("stream setup failed");
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
