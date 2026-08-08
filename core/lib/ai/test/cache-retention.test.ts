import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { buildAnthropicPayload } from "../src/providers/anthropic.js";
import { stream } from "../src/stream.js";
import type { Context } from "../src/types.js";

describe("Cache Retention (CATUI_CACHE_RETENTION)", () => {
	const originalEnv = process.env.CATUI_CACHE_RETENTION;

	beforeEach(() => {
		delete process.env.CATUI_CACHE_RETENTION;
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.CATUI_CACHE_RETENTION = originalEnv;
		} else {
			delete process.env.CATUI_CACHE_RETENTION;
		}
	});

	const context: Context = {
		systemPrompt: "You are a helpful assistant.",
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};
	const anthropicTestModelId = "claude-sonnet-4-6";

	describe("Anthropic Provider", () => {
		it.skipIf(!process.env.ANTHROPIC_API_KEY)(
			"should use default cache TTL (no ttl field) when CATUI_CACHE_RETENTION is not set",
			async () => {
				const model = getModel("anthropic", anthropicTestModelId);
				let capturedPayload: any = null;

				const s = stream(model, context, {
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				// Consume the stream to trigger the request
				for await (const _ of s) {
					// Just consume
				}

				expect(capturedPayload).not.toBeNull();
				// System prompt should have cache_control without ttl
				expect(capturedPayload.system).toBeDefined();
				expect(capturedPayload.system[0].cache_control).toEqual({ type: "ephemeral" });
			},
		);

		it.skipIf(!process.env.ANTHROPIC_API_KEY)("should use 1h cache TTL when CATUI_CACHE_RETENTION=long", async () => {
			process.env.CATUI_CACHE_RETENTION = "long";
			const model = getModel("anthropic", anthropicTestModelId);
			let capturedPayload: any = null;

			const s = stream(model, context, {
				onPayload: (payload) => {
					capturedPayload = payload;
				},
			});

			// Consume the stream to trigger the request
			for await (const _ of s) {
				// Just consume
			}

			expect(capturedPayload).not.toBeNull();
			// System prompt should have cache_control with ttl: "1h"
			expect(capturedPayload.system).toBeDefined();
			expect(capturedPayload.system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
		});

		it("should not add ttl when baseUrl is not api.anthropic.com", () => {
			process.env.CATUI_CACHE_RETENTION = "long";

			// Create a model with a different baseUrl (simulating a proxy)
			const baseModel = getModel("anthropic", anthropicTestModelId);
			const proxyModel = {
				...baseModel,
				baseUrl: "https://my-proxy.example.com/v1",
			};

			const payload = buildAnthropicPayload(proxyModel, context, false);

			expect(payload.system?.[0].cache_control).toEqual({ type: "ephemeral" });
		});

		it("should omit cache_control when cacheRetention is none", () => {
			const baseModel = getModel("anthropic", anthropicTestModelId);
			const payload = buildAnthropicPayload(baseModel, context, false, { cacheRetention: "none" });

			expect(payload.system?.[0].cache_control).toBeUndefined();
		});

		it("should add cache_control to string user messages", () => {
			const baseModel = getModel("anthropic", anthropicTestModelId);
			const payload = buildAnthropicPayload(baseModel, context, false);
			const lastMessage = payload.messages[payload.messages.length - 1];
			if (!Array.isArray(lastMessage.content)) {
				throw new Error("Expected the user message content to be an array");
			}
			const lastBlock = lastMessage.content[lastMessage.content.length - 1];
			expect(lastBlock.cache_control).toEqual({ type: "ephemeral" });
		});

		it("should set 1h cache TTL when cacheRetention is long", () => {
			const baseModel = getModel("anthropic", anthropicTestModelId);
			const payload = buildAnthropicPayload(baseModel, context, false, { cacheRetention: "long" });

			expect(payload.system?.[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
		});
	});

	describe("OpenAI Responses Provider", () => {
		it.skipIf(!process.env.OPENAI_API_KEY)(
			"should not set prompt_cache_retention when CATUI_CACHE_RETENTION is not set",
			async () => {
				const model = getModel("openai", "gpt-4o-mini");
				let capturedPayload: any = null;

				const s = stream(model, context, {
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				// Consume the stream to trigger the request
				for await (const _ of s) {
					// Just consume
				}

				expect(capturedPayload).not.toBeNull();
				expect(capturedPayload.prompt_cache_retention).toBeUndefined();
			},
		);

		it.skipIf(!process.env.OPENAI_API_KEY)(
			"should set prompt_cache_retention to 24h when CATUI_CACHE_RETENTION=long",
			async () => {
				process.env.CATUI_CACHE_RETENTION = "long";
				const model = getModel("openai", "gpt-4o-mini");
				let capturedPayload: any = null;

				const s = stream(model, context, {
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				// Consume the stream to trigger the request
				for await (const _ of s) {
					// Just consume
				}

				expect(capturedPayload).not.toBeNull();
				expect(capturedPayload.prompt_cache_retention).toBe("24h");
			},
		);

		it("should not set prompt_cache_retention when baseUrl is not api.openai.com", async () => {
			process.env.CATUI_CACHE_RETENTION = "long";

			// Create a model with a different baseUrl (simulating a proxy)
			const baseModel = getModel("openai", "gpt-4o-mini");
			const proxyModel = {
				...baseModel,
				baseUrl: "https://my-proxy.example.com/v1",
			};

			let capturedPayload: any = null;

			const { streamOpenAIResponses } = await import("../src/providers/openai-responses.js");

			try {
				const s = streamOpenAIResponses(proxyModel, context, {
					apiKey: "fake-key",
					onPayload: (payload) => {
						capturedPayload = payload;
					},
				});

				// This will fail since we're using a fake key and fake proxy, but the payload should be captured
				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			// The payload should have been captured before the error
			if (capturedPayload) {
				expect(capturedPayload.prompt_cache_retention).toBeUndefined();
			}
		});

		it("should omit prompt_cache_key when cacheRetention is none", async () => {
			const model = getModel("openai", "gpt-4o-mini");
			let capturedPayload: any = null;
			const abort = new AbortController();

			const { streamOpenAIResponses } = await import("../src/providers/openai-responses.js");

			try {
				const s = streamOpenAIResponses(model, context, {
					apiKey: "fake-key",
					cacheRetention: "none",
					sessionId: "session-1",
					signal: abort.signal,
					onPayload: (payload) => {
						capturedPayload = payload;
						abort.abort();
					},
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			expect(capturedPayload.prompt_cache_key).toBeUndefined();
			expect(capturedPayload.prompt_cache_retention).toBeUndefined();
		});

		it("should set prompt_cache_retention when cacheRetention is long", async () => {
			const model = getModel("openai", "gpt-4o-mini");
			let capturedPayload: any = null;
			const abort = new AbortController();

			const { streamOpenAIResponses } = await import("../src/providers/openai-responses.js");

			try {
				const s = streamOpenAIResponses(model, context, {
					apiKey: "fake-key",
					cacheRetention: "long",
					sessionId: "session-2",
					signal: abort.signal,
					onPayload: (payload) => {
						capturedPayload = payload;
						abort.abort();
					},
				});

				for await (const event of s) {
					if (event.type === "error") break;
				}
			} catch {
				// Expected to fail
			}

			expect(capturedPayload).not.toBeNull();
			expect(capturedPayload.prompt_cache_key).toBe("session-2");
			expect(capturedPayload.prompt_cache_retention).toBe("24h");
		});
	});
});
