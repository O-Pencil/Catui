/**
 * [WHO]: ToolInfo, ToolOrchestrator class
 * [FROM]: Depends on agent-core, extensions, tool-registry, tool-name
 * [TO]: Consumed by core/runtime/agent-session.ts
 * [HERE]: core/tools/orchestrator.ts - runtime tool registry, lookup, and active-tool resolution
 *
 * REFACTORED: Now uses ToolRegistry internally for namespace-aware collision detection.
 * Legacy API preserved for backward compatibility.
 *
 * Shape note (intentional, not a bug): `_legacyRegistry` and `_registry` are
 * kept in sync — for any registered AgentTool, both paths return the same
 * instance. They differ only in lookup shape:
 *   - `_registry` is the canonical view (strict namespace).
 *   - `_legacyRegistry` mirrors it under both `bash` and `functions.bash` keys
 *     so legacy callers that pre-date the namespace refactor keep working.
 */
import type { AgentTool } from "@catui/agent-core";
import type { ToolDefinition, ToolInfo } from "../extensions-host/index.js";
import { ToolRegistry, BUILTIN_NAMESPACE } from "./tool-registry.js";
import { normalizeToolName } from "./tool-name.js";

export interface ToolOrchestratorOptions {
	/** Initial custom tools from SDK options */
	customTools?: ToolDefinition[];
	/** Initial active tool names */
	initialActiveToolNames?: string[];
	/** Tool registry from extensions */
	getExtensionTools: () => Map<string, ToolDefinition>;
	/** Enable strict tool collision detection (default: true) */
	strictToolRegistry?: boolean;
}

export class ToolOrchestrator {
	/** Legacy map for backward compatibility with un-namespaced lookups. */
	private _legacyRegistry: Map<string, AgentTool> = new Map();
	/** New namespace-aware registry with collision detection. */
	private _registry: ToolRegistry;
	private _activeToolNames: string[] = [];
	private _customTools: ToolDefinition[] = [];
	private _initialActiveToolNames?: string[];
	private _getExtensionTools: () => Map<string, ToolDefinition>;
	/** Track if strict mode is enabled for collision detection. */
	private _strictMode: boolean;

	constructor(options: ToolOrchestratorOptions) {
		this._customTools = options.customTools || [];
		this._initialActiveToolNames = options.initialActiveToolNames;
		this._activeToolNames = options.initialActiveToolNames ?? [];
		this._getExtensionTools = options.getExtensionTools;
		this._strictMode = options.strictToolRegistry ?? true;
		this._registry = new ToolRegistry({ strictMode: this._strictMode });
	}

	/**
	 * Get all registered tool names
	 */
	getToolNames(): string[] {
		return this._registry.getAll().map((tool) => tool.name);
	}

	/**
	 * Get the names of currently active tools
	 */
	getActiveToolNames(): string[] {
		return [...this._activeToolNames];
	}

	/**
	 * Replace the runtime registry after tools are rebuilt.
	 * Now uses ToolRegistry for collision detection.
	 */
	replaceTools(tools: Iterable<AgentTool>, activeToolNames?: string[]): void {
		const toolArray = Array.from(tools);
		const nextRegistry = new ToolRegistry({ strictMode: this._strictMode });
		const { results } = nextRegistry.registerBatch(toolArray, "runtime", BUILTIN_NAMESPACE);
		const failedRegistration = results.find((result) => !result.ok);
		if (failedRegistration) {
			throw new Error(failedRegistration.error ?? "Tool registration failed");
		}
		const nextLegacyRegistry = new Map<string, AgentTool>();

		// Populate legacy registry for backward-compatible lookups
		// Both namespaced (functions.bash) and un-namespaced (bash) forms
		for (const tool of toolArray) {
			const canonicalName = normalizeToolName(tool.name, BUILTIN_NAMESPACE);
			const registeredTool = nextRegistry.get(canonicalName);
			if (!registeredTool) {
				throw new Error(`Registered tool missing from registry: ${canonicalName}`);
			}
			nextLegacyRegistry.set(tool.name, registeredTool);
			nextLegacyRegistry.set(canonicalName, registeredTool);
		}

		const nextActiveToolNames = activeToolNames ?? this._activeToolNames;
		const nextActiveTools = nextActiveToolNames.filter((name) => nextLegacyRegistry.has(name));

		this._registry = nextRegistry;
		this._legacyRegistry = nextLegacyRegistry;
		this._activeToolNames = nextActiveTools;
	}

	/**
	 * Get all configured tools with name, description, and parameter schema
	 */
	getAllTools(): ToolInfo[] {
		return this._registry.getAll().map((t) => ({
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		}));
	}

	/**
	 * Get tool by name (supports both namespaced and un-namespaced forms).
	 * Legacy: "bash" → returns functions.bash
	 * New: "functions.bash" → returns functions.bash
	 */
	getTool(name: string): AgentTool | undefined {
		return this._legacyRegistry.get(name);
	}

	/**
	 * Check if tool exists (supports both namespaced and un-namespaced forms).
	 */
	hasTool(name: string): boolean {
		return this._legacyRegistry.has(name);
	}

	/**
	 * Set active tools by name
	 * Returns the tools that were actually set and valid tool names
	 */
	setActiveToolsByName(toolNames: string[]): { tools: AgentTool[]; validToolNames: string[] } {
		const tools: AgentTool[] = [];
		const validToolNames: string[] = [];
		const seenTools = new Set<AgentTool>();
		for (const name of toolNames) {
			const tool = this._legacyRegistry.get(name);
			if (tool && !seenTools.has(tool)) {
				seenTools.add(tool);
				tools.push(tool);
				validToolNames.push(name);
			}
		}
		this._activeToolNames = validToolNames;
		return { tools, validToolNames };
	}

	/**
	 * Register a tool (supports both namespaced and un-namespaced forms).
	 */
	registerTool(name: string, tool: AgentTool): void {
		const aliasCanonicalName = normalizeToolName(name, BUILTIN_NAMESPACE);
		const toolCanonicalName = normalizeToolName(tool.name, BUILTIN_NAMESPACE);
		const result = this._registry.register(tool, "dynamic");
		if (!result.ok) {
			throw new Error(result.error);
		}
		const registeredTool = this._registry.get(toolCanonicalName);
		if (!registeredTool) {
			throw new Error(`Registered tool missing from registry: ${toolCanonicalName}`);
		}
		// Update legacy registry
		this._legacyRegistry.set(name, registeredTool);
		this._legacyRegistry.set(aliasCanonicalName, registeredTool);
		this._legacyRegistry.set(tool.name, registeredTool);
		this._legacyRegistry.set(toolCanonicalName, registeredTool);
	}

	/**
	 * Get custom tools
	 */
	getCustomTools(): ToolDefinition[] {
		return this._customTools;
	}

	/**
	 * Replace custom tools after dynamic MCP refresh.
	 */
	setCustomTools(customTools: ToolDefinition[]): void {
		this._customTools = customTools;
	}

	/**
	 * Get initial active tool names
	 */
	getInitialActiveToolNames(): string[] | undefined {
		return this._initialActiveToolNames;
	}

	/**
	 * Get extension tools map
	 */
	getExtensionTools(): Map<string, ToolDefinition> {
		return this._getExtensionTools();
	}
}
