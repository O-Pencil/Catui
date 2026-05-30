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
import { AuthStorage } from "../core/platform/config/auth-storage.js";
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
										agentLoopFramework: "weak-model-compatible",
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
			expect(registry.find("local", "qwen-test")?.agentLoopFramework).toBe("weak-model-compatible");
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
										agentLoopFramework: "weak-model-compatible",
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
			expect(registry.find("openai", "gpt-4o-mini")?.agentLoopFramework).toBe("weak-model-compatible");
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
			expect(registry.find("local", "qwen-compat")?.agentLoopFramework).toBe("weak-model-compatible");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("normalizes high-intelligence and low-intelligence aliases while loading config", () => {
		const dir = mkdtempSync(join(tmpdir(), "nanopencil-model-loop-legacy-alias-"));
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
										id: "qwen-low-compat",
										name: "Qwen Low Compat",
										agentLoopFramework: "low-intelligence",
									},
									{
										id: "qwen-high-compat",
										name: "Qwen High Compat",
										agentLoopFramework: "high-intelligence",
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
			expect(registry.find("local", "qwen-low-compat")?.agentLoopFramework).toBe("weak-model-compatible");
			expect(registry.find("local", "qwen-high-compat")?.agentLoopFramework).toBe("standard");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
