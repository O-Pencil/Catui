import assert from "node:assert/strict";
import test from "node:test";
import { PencilAgent } from "../core/runtime/pencil-agent.js";
import { AuthStorage } from "../core/platform/config/auth-storage.js";
import { ModelRegistry } from "../core/model-registry.js";

function makeRegistry(): ModelRegistry {
	// modelsJsonPath = undefined → skip disk read; only built-in + runtime registrations.
	return new ModelRegistry(AuthStorage.inMemory(), undefined);
}

test("resolveRequestedModel returns undefined when neither provider nor model provided", () => {
	const agent = new PencilAgent({});
	const registry = makeRegistry();
	const resolved = (agent as any).resolveRequestedModel(registry);
	assert.equal(resolved, undefined);
});

test("resolveRequestedModel returns existing entry from registry without re-registering", () => {
	const registry = makeRegistry();
	registry.registerProvider("dashscope-coding", {
		api: "openai-completions",
		baseUrl: "https://example.test/v1",
		apiKey: "sk-test",
		models: [{
			id: "qwen3.5-plus",
			name: "qwen3.5-plus",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128_000,
			maxTokens: 8192,
		}],
	});

	const agent = new PencilAgent({
		provider: "dashscope-coding",
		model: "qwen3.5-plus",
		// Intentionally NO baseUrl — to confirm the registry lookup short-circuits
		// before the dynamic-registration branch.
	});
	const resolved = (agent as any).resolveRequestedModel(registry);
	assert.ok(resolved, "expected to resolve existing model");
	assert.equal(resolved.provider, "dashscope-coding");
	assert.equal(resolved.id, "qwen3.5-plus");
});

test("resolveRequestedModel dynamically registers when baseUrl provided and model unknown", () => {
	const registry = makeRegistry();
	const agent = new PencilAgent({
		provider: "custom-vendor",
		model: "vendor-flagship",
		apiKey: "sk-runtime",
		baseUrl: "https://api.custom-vendor.test/v1",
	});

	assert.equal(registry.find("custom-vendor", "vendor-flagship"), undefined);
	const resolved = (agent as any).resolveRequestedModel(registry);
	assert.ok(resolved, "expected dynamic registration to produce a Model");
	assert.equal(resolved.provider, "custom-vendor");
	assert.equal(resolved.id, "vendor-flagship");
	assert.equal(resolved.baseUrl, "https://api.custom-vendor.test/v1");
	assert.equal(resolved.api, "openai-completions");
	// And it should now be findable via the public registry API.
	assert.ok(registry.find("custom-vendor", "vendor-flagship"));
});

test("resolveRequestedModel returns undefined and warns when model unknown and no baseUrl", () => {
	const registry = makeRegistry();
	const warnings: string[] = [];
	const agent = new PencilAgent({
		provider: "missing-provider",
		model: "missing-model",
		logger: {
			info: () => {},
			warn: (msg: string) => warnings.push(msg),
			error: () => {},
			debug: () => {},
		},
	});

	const resolved = (agent as any).resolveRequestedModel(registry);
	assert.equal(resolved, undefined);
	assert.ok(
		warnings.some((m) => m.includes("missing-provider/missing-model")),
		"expected a warning that names the missing provider/model",
	);
});
