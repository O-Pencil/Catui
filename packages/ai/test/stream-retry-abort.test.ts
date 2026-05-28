import { afterEach, describe, expect, it, vi } from "vitest";
import { registerApiProvider } from "../src/api-registry.js";
import { resetApiProviders } from "../src/providers/register-builtins.js";
import { streamSimple } from "../src/stream.js";
import type { Context, Model } from "../src/types.js";
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
});
