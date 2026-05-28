import { afterEach, describe, expect, it, vi } from "vitest";
import { registerApiProvider } from "../src/api-registry.js";
import { resetApiProviders } from "../src/providers/register-builtins.js";
import { streamSimple } from "../src/stream.js";
import type { AssistantMessage, Context, Model } from "../src/types.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";

afterEach(() => {
	resetApiProviders();
	vi.restoreAllMocks();
});

function createModel(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "Mock",
		api: "openai-responses",
		provider: "mock",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 1024,
	};
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "mock",
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

describe("stream retry abort handling", () => {
	it("emits an error event when aborted before provider stream creation", async () => {
		const providerCalled = vi.fn();
		registerApiProvider(
			{
				api: "openai-responses",
				stream() {
					providerCalled();
					return new AssistantMessageEventStream();
				},
				streamSimple() {
					providerCalled();
					return new AssistantMessageEventStream();
				},
			},
			"stream-retry-abort-test",
		);

		const controller = new AbortController();
		controller.abort();

		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
		};
		const stream = streamSimple(createModel(), context, { signal: controller.signal });
		const events = [];
		for await (const event of stream) {
			events.push(event);
		}
		const result = await stream.result();

		expect(providerCalled).not.toHaveBeenCalled();
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "error",
			reason: "error",
			error: {
				role: "assistant",
				stopReason: "error",
				errorMessage: "Request was aborted",
			},
		});
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("Request was aborted");
	});

	it("forwards provider streams that end with a final result but no done event", async () => {
		let providerCalls = 0;
		registerApiProvider(
			{
				api: "openai-responses",
				stream() {
					providerCalls += 1;
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						if (providerCalls === 1) {
							stream.end(createAssistantMessage("first result"));
						} else {
							stream.push({ type: "done", reason: "stop", message: createAssistantMessage("second result") });
						}
					});
					return stream;
				},
				streamSimple() {
					providerCalls += 1;
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						if (providerCalls === 1) {
							stream.end(createAssistantMessage("first result"));
						} else {
							stream.push({ type: "done", reason: "stop", message: createAssistantMessage("second result") });
						}
					});
					return stream;
				},
			},
			"stream-retry-eventless-end-test",
		);

		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
		};
		const stream = streamSimple(createModel(), context);
		const events = [];
		for await (const event of stream) {
			events.push(event);
		}
		const result = await stream.result();

		expect(providerCalls).toBe(1);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "done",
			reason: "stop",
			message: {
				content: [{ type: "text", text: "first result" }],
			},
		});
		expect(result.content).toEqual([{ type: "text", text: "first result" }]);
	});
});
