/**
 * [WHO]: Tests for discoverModels(), discoverOpenAIModels(), getDiscoveryProtocol()
 * [FROM]: Depends on ./discovery.js
 * [TO]: None (test file)
 * [HERE]: core/model/discovery.test.ts — remote model discovery engine tests
 */

import assert from "node:assert";
import { describe, it, mock } from "node:test";
import {
	getDiscoveryProtocol,
	discoverOpenAIModels,
	discoverModels,
	type DiscoveredModel,
} from "./discovery.js";

describe("getDiscoveryProtocol", () => {
	it("returns 'openai-models' for openai-completions", () => {
		assert.strictEqual(getDiscoveryProtocol("openai-completions"), "openai-models");
	});

	it("returns 'openai-models' for openai-responses", () => {
		assert.strictEqual(getDiscoveryProtocol("openai-responses"), "openai-models");
	});

	it("returns 'openai-models' for openai-codex-responses", () => {
		assert.strictEqual(getDiscoveryProtocol("openai-codex-responses"), "openai-models");
	});

	it("returns 'openai-models' for azure-openai-responses", () => {
		assert.strictEqual(getDiscoveryProtocol("azure-openai-responses"), "openai-models");
	});

	it("returns 'unsupported' for anthropic-messages", () => {
		assert.strictEqual(getDiscoveryProtocol("anthropic-messages"), "unsupported");
	});

	it("returns 'unsupported' for google-generative-ai", () => {
		assert.strictEqual(getDiscoveryProtocol("google-generative-ai"), "unsupported");
	});

	it("returns 'unsupported' for bedrock-converse-stream", () => {
		assert.strictEqual(getDiscoveryProtocol("bedrock-converse-stream"), "unsupported");
	});

	it("returns 'unsupported' for unknown API types", () => {
		assert.strictEqual(getDiscoveryProtocol("custom-api"), "unsupported");
	});
});

describe("discoverOpenAIModels", () => {
	it("parses standard OpenAI /models response", async () => {
		const mockResponse = {
			data: [
				{ id: "gpt-4o", name: "GPT-4o", owned_by: "openai" },
				{ id: "gpt-4o-mini", name: "GPT-4o Mini", owned_by: "openai" },
			],
		};

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock.fn(async () => ({
			ok: true,
			json: async () => mockResponse,
		})) as any;

		try {
			const models = await discoverOpenAIModels("https://api.openai.com/v1", "test-key");
			assert.strictEqual(models.length, 2);
			assert.strictEqual(models[0].id, "gpt-4o");
			assert.strictEqual(models[0].name, "GPT-4o");
			assert.strictEqual(models[0].ownedBy, "openai");
			assert.strictEqual(models[1].id, "gpt-4o-mini");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("includes Authorization header when apiKey is provided", async () => {
		const originalFetch = globalThis.fetch;
		let capturedHeaders: Record<string, string> = {};
		globalThis.fetch = mock.fn(async (_url: string, init: RequestInit) => {
			capturedHeaders = init.headers as Record<string, string>;
			return { ok: true, json: async () => ({ data: [] }) };
		}) as any;

		try {
			await discoverOpenAIModels("https://api.example.com/v1", "sk-test-123");
			assert.strictEqual(capturedHeaders["Authorization"], "Bearer sk-test-123");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("omits Authorization header when apiKey is undefined", async () => {
		const originalFetch = globalThis.fetch;
		let capturedHeaders: Record<string, string> = {};
		globalThis.fetch = mock.fn(async (_url: string, init: RequestInit) => {
			capturedHeaders = init.headers as Record<string, string>;
			return { ok: true, json: async () => ({ data: [] }) };
		}) as any;

		try {
			await discoverOpenAIModels("http://localhost:11434/v1", undefined);
			assert.strictEqual(capturedHeaders["Authorization"], undefined);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("strips trailing slashes from baseUrl", async () => {
		const originalFetch = globalThis.fetch;
		let capturedUrl = "";
		globalThis.fetch = mock.fn(async (url: string) => {
			capturedUrl = url;
			return { ok: true, json: async () => ({ data: [] }) };
		}) as any;

		try {
			await discoverOpenAIModels("https://api.example.com/v1///", undefined);
			assert.strictEqual(capturedUrl, "https://api.example.com/v1/models");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns empty array on non-200 response", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock.fn(async () => ({
			ok: false,
			status: 401,
			json: async () => ({ error: "Unauthorized" }),
		})) as any;

		try {
			const models = await discoverOpenAIModels("https://api.example.com/v1", "bad-key");
			assert.deepStrictEqual(models, []);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns empty array on malformed JSON", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock.fn(async () => ({
			ok: true,
			json: async () => ({ unexpected: "format" }),
		})) as any;

		try {
			const models = await discoverOpenAIModels("https://api.example.com/v1", undefined);
			assert.deepStrictEqual(models, []);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("filters out entries without string id", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock.fn(async () => ({
			ok: true,
			json: async () => ({
				data: [
					{ id: "valid-model" },
					{ id: 123 },
					{ name: "no-id" },
					null,
					{ id: "another-valid" },
				],
			}),
		})) as any;

		try {
			const models = await discoverOpenAIModels("https://api.example.com/v1", undefined);
			assert.strictEqual(models.length, 2);
			assert.strictEqual(models[0].id, "valid-model");
			assert.strictEqual(models[1].id, "another-valid");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns empty array on network error", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock.fn(async () => {
			throw new Error("ECONNREFUSED");
		}) as any;

		try {
			const models = await discoverOpenAIModels("http://localhost:11434/v1", undefined);
			assert.deepStrictEqual(models, []);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("discoverModels", () => {
	it("returns DiscoveryResult with models for openai-completions", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock.fn(async () => ({
			ok: true,
			json: async () => ({
				data: [{ id: "model-a" }, { id: "model-b" }],
			}),
		})) as any;

		try {
			const result = await discoverModels("test-provider", "https://api.example.com/v1", "openai-completions", "key");
			assert.strictEqual(result.provider, "test-provider");
			assert.strictEqual(result.models.length, 2);
			assert.strictEqual(result.ttl, 86400);
			assert.ok(result.fetchedAt > 0);
			assert.strictEqual(result.error, undefined);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns error for unsupported protocol", async () => {
		const result = await discoverModels("anthropic", "https://api.anthropic.com/v1", "anthropic-messages", "key");
		assert.strictEqual(result.provider, "anthropic");
		assert.deepStrictEqual(result.models, []);
		assert.ok(result.error?.includes("not supported"));
		assert.strictEqual(result.ttl, 0);
	});

	it("returns empty models on fetch error (graceful degradation)", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock.fn(async () => {
			throw new Error("timeout");
		}) as any;

		try {
			const result = await discoverModels("test", "https://api.example.com/v1", "openai-completions", "key");
			assert.deepStrictEqual(result.models, []);
			// discoverOpenAIModels swallows errors gracefully — no error propagated
			assert.strictEqual(result.error, undefined);
			assert.strictEqual(result.provider, "test");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
