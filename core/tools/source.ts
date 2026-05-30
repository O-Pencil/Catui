/**
 * [WHO]: ToolSourceType, ToolSource, SourceTool
 * [FROM]: Depends on extensions/types
 * [TO]: Consumed by core/tools/index.ts (not directly imported)
 * [HERE]: core/tools/source.ts - tool source abstraction (builtin, MCP, extension)
 */
import type { ToolDefinition } from "../extensions-host/types.js";

export type ToolSourceType = "builtin" | "mcp" | "extension";

/**
 * Tool source interface
 * Implement this to add new tool sources (MCP, custom protocols, etc.)
 */
export interface ToolSource {
	/** Unique identifier for this tool source */
	id: string;
	/** Type of tool source */
	type: ToolSourceType;
	/** Human-readable name */
	name: string;
	/** Description of what this source provides */
	description?: string;
	/** Load tools from this source */
	load(): Promise<ToolDefinition[]>;
	/** Unload tools from this source */
	unload(): Promise<void>;
	/** Check if this source is enabled */
	isEnabled(): boolean;
}

/**
 * Tool source registry
 * Manages multiple tool sources
 */
export class ToolSourceRegistry {
	private sources: Map<string, ToolSource> = new Map();

	/**
	 * Register a tool source
	 */
	register(source: ToolSource): void {
		if (this.sources.has(source.id)) {
			// Skip duplicate registration silently
			return;
		}
		this.sources.set(source.id, source);
	}

	/**
	 * Unregister a tool source
	 */
	unregister(id: string): void {
		this.sources.delete(id);
	}

	/**
	 * Get a tool source by ID
	 */
	get(id: string): ToolSource | undefined {
		return this.sources.get(id);
	}

	/**
	 * Get all registered tool sources
	 */
	getAll(): ToolSource[] {
		return Array.from(this.sources.values());
	}

	/**
	 * Get tool sources by type
	 */
	getByType(type: ToolSourceType): ToolSource[] {
		return this.getAll().filter((s) => s.type === type);
	}

	/**
	 * Load all enabled tool sources
	 */
	async loadAll(): Promise<ToolDefinition[]> {
		const allTools: ToolDefinition[] = [];

		for (const source of this.getAll()) {
			if (!source.isEnabled()) {
				continue;
			}

			try {
				const tools = await source.load();
				allTools.push(...tools);
			} catch (error) {
				// Skip failed source, continue with others
			}
		}

		return allTools;
	}

	/**
	 * Unload all tool sources
	 */
	async unloadAll(): Promise<void> {
		for (const source of this.getAll()) {
			try {
				await source.unload();
			} catch (error) {
				// Skip failed unload
			}
		}
	}
}

/**
 * Builtin tool source
 * Wraps built-in tools as a ToolSource
 */
export class BuiltinToolSource implements ToolSource {
	readonly id = "builtin";
	readonly type: ToolSourceType = "builtin";
	readonly name = "Built-in Tools";
	readonly description = "Core editing and file operation tools";

	private tools: ToolDefinition[] = [];

	constructor(tools: ToolDefinition[] = []) {
		this.tools = tools;
	}

	isEnabled(): boolean {
		return true;
	}

	async load(): Promise<ToolDefinition[]> {
		return this.tools;
	}

	async unload(): Promise<void> {
		// No-op for builtin tools
	}
}
