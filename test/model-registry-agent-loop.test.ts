/**
 * [WHO]: Verifies ModelRegistry support for per-model agentLoopFramework config
 * [FROM]: Depends on AuthStorage and ModelRegistry
 * [TO]: Consumed by root Vitest suite
 * [HERE]: test/model-registry-agent-loop.test.ts - regression coverage for model loop framework selection
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthStorage } from "../core/config/auth-storage.js";
import { ModelRegistry } from "../core/model-registry.js";

describe("ModelRegistry agentLoopFramework config", () => {
	it("loads per-model agent loop framework from models.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "nanopencil-model-loop-"));
		try {
			const modelsPath = join(dir, "models.json");
			writeFileSync(
				modelsPath,
				JSON.stringify(
					{
						providers: {
							local: {
								baseUrl: "http://localhost:11434/v1",
								api: "openai-completions",
								apiKey: "test-key",
								models: [
									{
										id: "qwen-test",
										name: "Qwen Test",
										agentLoopFramework: "low-intelligence",
									},
								],
							},
						},
					},
					null,
					2,
				),
				"utf-8",
			);

			const registry = new ModelRegistry(AuthStorage.inMemory(), modelsPath, {
				useOnlyCustomModels: true,
			});

			expect(registry.getError()).toBeUndefined();
			expect(registry.find("local", "qwen-test")?.agentLoopFramework).toBe("low-intelligence");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads agent loop framework from modelOverrides for built-in models", () => {
		const dir = mkdtempSync(join(tmpdir(), "nanopencil-model-loop-override-"));
		try {
			const modelsPath = join(dir, "models.json");
			writeFileSync(
				modelsPath,
				JSON.stringify(
					{
						providers: {
							openai: {
								modelOverrides: {
									"gpt-4o-mini": {
										agentLoopFramework: "low-intelligence",
									},
								},
							},
						},
					},
					null,
					2,
				),
				"utf-8",
			);

			const registry = new ModelRegistry(AuthStorage.inMemory(), modelsPath);

			expect(registry.getError()).toBeUndefined();
			expect(registry.find("openai", "gpt-4o-mini")?.agentLoopFramework).toBe("low-intelligence");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("normalizes earlier experimental framework names while loading config", () => {
		const dir = mkdtempSync(join(tmpdir(), "nanopencil-model-loop-compat-"));
		try {
			const modelsPath = join(dir, "models.json");
			writeFileSync(
				modelsPath,
				JSON.stringify(
					{
						providers: {
							local: {
								baseUrl: "http://localhost:11434/v1",
								api: "openai-completions",
								apiKey: "test-key",
								models: [
									{
										id: "qwen-compat",
										name: "Qwen Compat",
										agentLoopFramework: "structured-adaptive",
									},
								],
							},
						},
					},
					null,
					2,
				),
				"utf-8",
			);

			const registry = new ModelRegistry(AuthStorage.inMemory(), modelsPath, {
				useOnlyCustomModels: true,
			});

			expect(registry.getError()).toBeUndefined();
			expect(registry.find("local", "qwen-compat")?.agentLoopFramework).toBe("low-intelligence");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
