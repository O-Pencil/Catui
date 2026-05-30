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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) => {
			setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
		}),
	]);
}

function createRejectingStream(error: Error): AssistantMessageEventStream {
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
	} as unknown as AssistantMessageEventStream;
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

	it("retries provider stream factory errors before forwarding the final result", async () => {
		let providerCalls = 0;
		registerApiProvider(
			{
				api: "openai-responses",
				stream() {
					providerCalls += 1;
					if (providerCalls === 1) {
						throw new Error("503 service unavailable");
					}
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("recovered") });
					});
					return stream;
				},
				streamSimple() {
					providerCalls += 1;
					if (providerCalls === 1) {
						throw new Error("503 service unavailable");
					}
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("recovered") });
					});
					return stream;
				},
			},
			"stream-retry-factory-error-test",
		);

		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
		};
		const stream = streamSimple(createModel(), context, { retry: { baseDelayMs: 1, jitter: false } });
		const events = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const result = await withTimeout(stream.result(), 100);

		expect(providerCalls).toBe(2);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "done",
			reason: "stop",
			message: {
				content: [{ type: "text", text: "recovered" }],
			},
		});
		expect(result.content).toEqual([{ type: "text", text: "recovered" }]);
	});

	it("emits an error event when provider stream factory errors are exhausted", async () => {
		let providerCalls = 0;
		registerApiProvider(
			{
				api: "openai-responses",
				stream() {
					providerCalls += 1;
					throw new Error("503 service unavailable");
				},
				streamSimple() {
					providerCalls += 1;
					throw new Error("503 service unavailable");
				},
			},
			"stream-retry-factory-error-exhausted-test",
		);

		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
		};
		const stream = streamSimple(createModel(), context, {
			retry: { maxRetries: 1, baseDelayMs: 1, jitter: false },
		});
		const events = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const result = await withTimeout(stream.result(), 100);

		expect(providerCalls).toBe(2);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "error",
			reason: "error",
			error: {
				stopReason: "error",
				errorMessage: "503 service unavailable",
			},
		});
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("503 service unavailable");
	});

	it("retries provider streams that end without a final result", async () => {
		let providerCalls = 0;
		registerApiProvider(
			{
				api: "openai-responses",
				stream() {
					providerCalls += 1;
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						if (providerCalls === 1) {
							stream.end();
						} else {
							stream.push({ type: "done", reason: "stop", message: createAssistantMessage("recovered empty") });
						}
					});
					return stream;
				},
				streamSimple() {
					providerCalls += 1;
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						if (providerCalls === 1) {
							stream.end();
						} else {
							stream.push({ type: "done", reason: "stop", message: createAssistantMessage("recovered empty") });
						}
					});
					return stream;
				},
			},
			"stream-retry-empty-end-test",
		);

		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
		};
		const stream = streamSimple(createModel(), context, { retry: { baseDelayMs: 1, jitter: false } });
		const events = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const result = await withTimeout(stream.result(), 100);

		expect(providerCalls).toBe(2);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "done",
			reason: "stop",
			message: {
				content: [{ type: "text", text: "recovered empty" }],
			},
		});
		expect(result.content).toEqual([{ type: "text", text: "recovered empty" }]);
	});

	it("emits an error event when provider streams end without a final result after retries", async () => {
		let providerCalls = 0;
		registerApiProvider(
			{
				api: "openai-responses",
				stream() {
					providerCalls += 1;
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => stream.end());
					return stream;
				},
				streamSimple() {
					providerCalls += 1;
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => stream.end());
					return stream;
				},
			},
			"stream-retry-empty-end-exhausted-test",
		);

		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
		};
		const stream = streamSimple(createModel(), context, {
			retry: { maxRetries: 1, baseDelayMs: 1, jitter: false },
		});
		const events = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const result = await withTimeout(stream.result(), 100);

		expect(providerCalls).toBe(2);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "error",
			reason: "error",
			error: {
				stopReason: "error",
				errorMessage: "Provider stream ended without a final assistant message",
			},
		});
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("Provider stream ended without a final assistant message");
	});

	it("emits an abort error without waiting for retry backoff", async () => {
		let providerCalls = 0;
		const controller = new AbortController();
		registerApiProvider(
			{
				api: "openai-responses",
				stream() {
					providerCalls += 1;
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						stream.push({
							type: "error",
							reason: "error",
							error: {
								...createAssistantMessage(""),
								content: [],
								stopReason: "error",
								errorMessage: "503 service unavailable",
							},
						});
						controller.abort();
					});
					return stream;
				},
				streamSimple() {
					providerCalls += 1;
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						stream.push({
							type: "error",
							reason: "error",
							error: {
								...createAssistantMessage(""),
								content: [],
								stopReason: "error",
								errorMessage: "503 service unavailable",
							},
						});
						controller.abort();
					});
					return stream;
				},
			},
			"stream-retry-abort-backoff-test",
		);

		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
		};
		const stream = streamSimple(createModel(), context, {
			signal: controller.signal,
			retry: { baseDelayMs: 1000, jitter: false },
		});
		const events = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const result = await withTimeout(stream.result(), 100);

		expect(providerCalls).toBe(1);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "error",
			reason: "error",
			error: {
				stopReason: "error",
				errorMessage: "Request was aborted",
			},
		});
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("Request was aborted");
	});

	it("emits an abort error when a provider stream never yields", async () => {
		let providerCalls = 0;
		const controller = new AbortController();
		registerApiProvider(
			{
				api: "openai-responses",
				stream() {
					providerCalls += 1;
					return new AssistantMessageEventStream();
				},
				streamSimple() {
					providerCalls += 1;
					return new AssistantMessageEventStream();
				},
			},
			"stream-retry-abort-hung-stream-test",
		);

		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
		};
		const stream = streamSimple(createModel(), context, { signal: controller.signal });
		queueMicrotask(() => controller.abort());
		const events = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const result = await withTimeout(stream.result(), 100);

		expect(providerCalls).toBe(1);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "error",
			reason: "error",
			error: {
				stopReason: "error",
				errorMessage: "Request was aborted",
			},
		});
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("Request was aborted");
	});

	it("retries provider stream iterator errors before forwarding the final result", async () => {
		let providerCalls = 0;
		registerApiProvider(
			{
				api: "openai-responses",
				stream() {
					providerCalls += 1;
					if (providerCalls === 1) {
						return createRejectingStream(new Error("503 service unavailable"));
					}
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("recovered iterator") });
					});
					return stream;
				},
				streamSimple() {
					providerCalls += 1;
					if (providerCalls === 1) {
						return createRejectingStream(new Error("503 service unavailable"));
					}
					const stream = new AssistantMessageEventStream();
					queueMicrotask(() => {
						stream.push({ type: "done", reason: "stop", message: createAssistantMessage("recovered iterator") });
					});
					return stream;
				},
			},
			"stream-retry-iterator-error-test",
		);

		const context: Context = {
			messages: [{ role: "user", content: "hello", timestamp: 1 }],
		};
		const stream = streamSimple(createModel(), context, { retry: { baseDelayMs: 1, jitter: false } });
		const events = [];
		await withTimeout(
			(async () => {
				for await (const event of stream) {
					events.push(event);
				}
			})(),
			100,
		);
		const result = await withTimeout(stream.result(), 100);

		expect(providerCalls).toBe(2);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "done",
			reason: "stop",
			message: {
				content: [{ type: "text", text: "recovered iterator" }],
			},
		});
		expect(result.content).toEqual([{ type: "text", text: "recovered iterator" }]);
	});
});
