/**
 * Test for ToolRegistry namespace-aware collision detection.
 */
import { describe, it, expect } from "vitest";
import { ToolRegistry, BUILTIN_NAMESPACE } from "../core/tools/tool-registry.js";
import { ToolOrchestrator } from "../core/tools/orchestrator.js";
import { ToolRuntimeController } from "../core/runtime/tool-runtime-controller.js";
import { ExtensionRunner } from "../core/extensions-host/runner.js";
import type { Extension, ToolDefinition } from "../core/extensions-host/types.js";
import {
	createExtensionRuntime,
	loadExtensionFromFactory,
} from "../core/extensions-host/loader.js";
import { createEventBus } from "../core/runtime/event-bus.js";
import {
	parseToolName,
	normalizeToolName,
} from "../core/tools/tool-name.js";
import type { AgentTool } from "@catui/agent-core";
import { Type } from "@sinclair/typebox";

// Helper to create a minimal AgentTool
function createTool(name: string, description: string): AgentTool {
	return {
		name,
		label: name,
		description,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
	};
}

function createExtension(path: string, definition: ToolDefinition): Extension {
	return {
		path,
		resolvedPath: path,
		handlers: new Map(),
		tools: new Map([
			[
				definition.name,
				{
					definition,
					extensionPath: path,
				},
			],
		]),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

function createToolDefinition(name: string, description: string): ToolDefinition {
	return {
		name,
		label: name,
		description,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
	};
}

describe("ToolRegistry", () => {
	describe("parseToolName", () => {
		it("parses un-namespaced tool name with default namespace", () => {
			const result = parseToolName("bash");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.namespace).toBe("functions");
				expect(result.value.localName).toBe("bash");
				expect(result.value.fullName).toBe("functions.bash");
			}
		});

		it("parses namespaced tool name", () => {
			const result = parseToolName("filesystem.read");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.namespace).toBe("filesystem");
				expect(result.value.localName).toBe("read");
				expect(result.value.fullName).toBe("filesystem.read");
			}
		});

		it("parses MCP three-segment name with composite namespace", () => {
			const result = parseToolName("mcp.filesystem.read");
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.namespace).toBe("mcp.filesystem");
				expect(result.value.localName).toBe("read");
				expect(result.value.fullName).toBe("mcp.filesystem.read");
			}
		});

		it("rejects invalid MCP name without server segment", () => {
			const result = parseToolName("mcp.read");
			expect(result.ok).toBe(false);
		});

		it("rejects invalid MCP name without tool segment", () => {
			const result = parseToolName("mcp.filesystem.");
			expect(result.ok).toBe(false);
		});

		it("rejects MCP name with non-identifier server id", () => {
			const result = parseToolName("mcp.123bad.read");
			expect(result.ok).toBe(false);
		});

		it("rejects invalid tool name", () => {
			const result = parseToolName("123invalid");
			expect(result.ok).toBe(false);
		});

		it("rejects tool name with too many dots outside MCP", () => {
			const result = parseToolName("a.b.c");
			expect(result.ok).toBe(false);
		});

		it("accepts a 64-character model-facing name without charging the internal namespace", () => {
			const name = `tool_${"a".repeat(59)}`;
			const result = parseToolName(name);

			expect(name).toHaveLength(64);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.localName).toBe(name);
				expect(result.value.fullName).toBe(`functions.${name}`);
			}
		});

		it("rejects a model-facing name longer than 64 characters", () => {
			const result = parseToolName(`tool_${"a".repeat(60)}`);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain("too long");
			}
		});
	});

	describe("normalizeToolName", () => {
		it("normalizes to canonical form", () => {
			expect(normalizeToolName("bash")).toBe("functions.bash");
			expect(normalizeToolName("filesystem.read")).toBe("filesystem.read");
		});
	});

	describe("registration", () => {
		it("registers a tool successfully", () => {
			const registry = new ToolRegistry();
			const tool = createTool("bash", "Execute shell commands");

			const result = registry.register(tool, "builtin", BUILTIN_NAMESPACE);
			expect(result.ok).toBe(true);
			expect(registry.size).toBe(1);
		});

		it("merges tools with same name and description", () => {
			const registry = new ToolRegistry();
			const tool1 = createTool("bash", "Execute shell commands");
			const tool2 = createTool("bash", "Execute shell commands");

			const result1 = registry.register(tool1, "source1", BUILTIN_NAMESPACE);
			const result2 = registry.register(tool2, "source2", BUILTIN_NAMESPACE);

			expect(result1.ok).toBe(true);
			expect(result2.ok).toBe(true);
			expect(result2.merged).toBeDefined();
			expect(registry.size).toBe(1); // Still 1, merged
		});

		it("detects collision with different descriptions in strict mode", () => {
			const registry = new ToolRegistry({ strictMode: true });
			const tool1 = createTool("bash", "Execute shell commands");
			const tool2 = createTool("bash", "Run bash scripts");

			registry.register(tool1, "source1", BUILTIN_NAMESPACE);
			const result = registry.register(tool2, "source2", BUILTIN_NAMESPACE);

			expect(result.ok).toBe(false);
			expect(result.error).toContain("Tool collision detected");
			expect(registry.hasCollisions()).toBe(true);
		});

		it("allows same name in different namespaces", () => {
			const registry = new ToolRegistry();
			const tool1 = createTool("read", "Read file contents");
			const tool2 = createTool("read", "Read from database");

			const result1 = registry.register(tool1, "builtin", "functions");
			const result2 = registry.register(tool2, "db-extension", "database");

			expect(result1.ok).toBe(true);
			expect(result2.ok).toBe(true);
			expect(registry.size).toBe(2); // Two different tools
		});
	});

	describe("batch registration", () => {
		it("registers multiple tools", () => {
			const registry = new ToolRegistry();
			const tools = [
				createTool("bash", "Execute shell commands"),
				createTool("read", "Read file contents"),
			];

			const { results, collisions } = registry.registerBatch(tools, "builtin", BUILTIN_NAMESPACE);

			expect(results.every((r) => r.ok)).toBe(true);
			expect(collisions.length).toBe(0);
			expect(registry.size).toBe(2);
		});

		it("fails all on collision in strict mode", () => {
			const registry = new ToolRegistry({ strictMode: true });
			const tools = [
				createTool("bash", "Execute shell commands"),
				createTool("bash", "Run shell scripts"), // Collision!
			];

			registry.register(createTool("bash", "Execute shell commands"), "existing", BUILTIN_NAMESPACE);
			const { results, collisions } = registry.registerBatch(tools, "builtin", BUILTIN_NAMESPACE);

			expect(results.every((r) => !r.ok)).toBe(true);
			expect(collisions.length).toBe(1);
		});

		it("rejects an intra-batch collision without partially registering tools", () => {
			const registry = new ToolRegistry({ strictMode: true });
			const tools = [
				createTool("bash", "Execute shell commands"),
				createTool("bash", "Run shell scripts"),
			];

			const { results, collisions } = registry.registerBatch(
				tools,
				"builtin",
				BUILTIN_NAMESPACE,
			);

			expect(results.every((result) => !result.ok)).toBe(true);
			expect(collisions).toHaveLength(1);
			expect(registry.size).toBe(0);
			expect(registry.hasCollisions()).toBe(true);
		});
	});

	describe("lookup", () => {
		it("gets tool by full name", () => {
			const registry = new ToolRegistry();
			const tool = createTool("bash", "Execute shell commands");
			registry.register(tool, "builtin", BUILTIN_NAMESPACE);

			expect(registry.get("functions.bash")).toBeDefined();
			expect(registry.has("functions.bash")).toBe(true);
		});

		it("gets tools by namespace prefix", () => {
			const registry = new ToolRegistry();
			registry.register(createTool("bash", "Shell"), "builtin", BUILTIN_NAMESPACE);
			registry.register(createTool("read", "Read"), "builtin", BUILTIN_NAMESPACE);
			registry.register(createTool("query", "Query"), "db", "database");

			const builtinTools = registry.getByNamespacePrefix("functions");
			expect(builtinTools.length).toBe(2);

			const dbTools = registry.getByNamespacePrefix("database");
			expect(dbTools.length).toBe(1);
		});
	});
});

describe("ToolOrchestrator registry compatibility", () => {
	function makeOrchestrator(): ToolOrchestrator {
		return new ToolOrchestrator({ getExtensionTools: () => new Map() });
	}

	it("keeps canonical and legacy lookups on the merged tool instance", () => {
		const orchestrator = makeOrchestrator();
		const first = createTool("bash", "Execute shell commands");
		const duplicate = createTool("bash", "Execute shell commands");

		orchestrator.replaceTools([first, duplicate]);

		expect(orchestrator.getTool("bash")).toBe(first);
		expect(orchestrator.getTool("functions.bash")).toBe(first);
		expect(orchestrator.getTool("bash")).not.toBe(duplicate);
		expect(
			orchestrator.setActiveToolsByName(["bash", "functions.bash"]).tools,
		).toEqual([first]);
	});

	it("keeps dynamic registration aliases on the merged tool instance", () => {
		const orchestrator = makeOrchestrator();
		const first = createTool("bash", "Execute shell commands");
		const duplicate = createTool("bash", "Execute shell commands");

		orchestrator.registerTool("bash", first);
		orchestrator.registerTool("bash", duplicate);

		expect(orchestrator.getTool("bash")).toBe(first);
		expect(orchestrator.getTool("functions.bash")).toBe(first);
	});

	it("enumerates effective tools without exposing compatibility aliases", () => {
		const orchestrator = makeOrchestrator();
		orchestrator.replaceTools([createTool("bash", "Execute shell commands")]);

		expect(orchestrator.getToolNames()).toEqual(["bash"]);
	});

	it("keeps the previous registry when replacement collides", () => {
		const orchestrator = makeOrchestrator();
		const existing = createTool("read", "Read files");
		orchestrator.replaceTools([existing]);

		expect(() =>
			orchestrator.replaceTools([
				createTool("bash", "Execute shell commands"),
				createTool("bash", "Run shell scripts"),
			]),
		).toThrow(/collision/i);

		expect(orchestrator.getToolNames()).toEqual(["read"]);
		expect(orchestrator.getTool("read")).toBe(existing);
	});

	it("detects conflicting tools registered by separate extensions", () => {
		const first = createExtension(
			"extension:first",
			createToolDefinition("search", "Search local files"),
		);
		const second = createExtension(
			"extension:second",
			createToolDefinition("search", "Search the web"),
		);
		const runner = new ExtensionRunner(
			[first, second],
			{} as never,
			process.cwd(),
			process.cwd(),
			{} as never,
			{} as never,
		);
		const controller = new ToolRuntimeController(makeOrchestrator());

		expect(() =>
			controller.build({
				baseTools: new Map(),
				customTools: [],
				includeAllExtensionTools: true,
				extensionRunner: runner,
			}),
		).toThrow(/collision/i);
	});

	it("rejects conflicting duplicate registrations inside one extension", async () => {
		await expect(
			loadExtensionFromFactory(
				(api) => {
					api.registerTool(createToolDefinition("search", "Search local files"));
					api.registerTool(createToolDefinition("search", "Search the web"));
				},
				process.cwd(),
				process.cwd(),
				createEventBus(),
				createExtensionRuntime(),
				"extension:duplicate",
			),
		).rejects.toThrow(/collision/i);
	});
});
