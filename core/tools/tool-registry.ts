/**
 * [WHO]: ToolRegistry class, collision detection, namespace-aware registration
 * [FROM]: Depends on agent-core (AgentTool type) and tool-name.ts
 * [TO]: Consumed by ToolOrchestrator (replaces internal Map), agent-session (rebuilds tools)
 * [HERE]: core/tools/tool-registry.ts - unified tool registry with namespace support
 *
 * Registry rules:
 * 1. Internal keys are namespaced (`functions.bash`, `git.status`) while
 *    AgentTool.name remains unchanged for model and extension compatibility.
 * 2. Collision detection:
 *    - Same namespace + same name + same description → merge (share single tool)
 *    - Same namespace + same name + different description → collision error
 *    - Different namespace → no collision
 * 3. Strict batch registration validates everything before mutating the registry.
 * 4. Unqualified tools use the internal `functions` namespace.
 */

import type { AgentTool } from "@catui/agent-core";
import {
	type ToolName,
	parseToolName,
	BUILTIN_NAMESPACE,
} from "./tool-name.js";

export { BUILTIN_NAMESPACE } from "./tool-name.js";

/**
 * A registered tool with its metadata.
 */
interface RegisteredTool {
	/** The tool implementation. */
	tool: AgentTool;
	/** Parsed tool name with namespace. */
	name: ToolName;
	/** Tool description (used for collision detection). */
	description: string;
	/** Source that registered this tool (for error messages). */
	source: string;
}

/**
 * Result of a registration attempt.
 */
export interface RegistrationResult {
	/** Whether registration succeeded. */
	ok: boolean;
	/** If failed, the error message. */
	error?: string;
	/** If merged with existing tool, reference to the merged entry. */
	merged?: AgentTool;
	/** The registered tool (or the existing one if merged). */
	tool?: AgentTool;
}

/**
 * Collision info for duplicate tool names.
 */
export interface ToolCollision {
	/** The canonical name that collided. */
	fullName: string;
	/** First registration source. */
	firstSource: string;
	/** First registration description. */
	firstDescription: string;
	/** Attempted registration source. */
	duplicateSource: string;
	/** Attempted registration description. */
	duplicateDescription: string;
}

/**
 * Options for ToolRegistry.
 */
export interface ToolRegistryOptions {
	/** Whether to throw on collision (default: true in strict mode). */
	strictMode?: boolean;
	/** Default namespace for tools without explicit namespace. */
	defaultNamespace?: string;
}

/**
 * Central registry for all tools with namespace support and collision detection.
 *
 * Design principle: registration should fail before send-model-request, not during.
 * This prevents models from receiving half-broken toolsets.
 */
export class ToolRegistry {
	/** Map from canonical full name to registered tool. */
	private _tools: Map<string, RegisteredTool> = new Map();

	/** Whether to throw on collision. */
	private _strictMode: boolean;

	/** Default namespace for unnamespaced tools. */
	private _defaultNamespace: string;

	/** Collisions detected during batch registration. */
	private _collisions: ToolCollision[] = [];

	constructor(options: ToolRegistryOptions = {}) {
		this._strictMode = options.strictMode ?? true;
		this._defaultNamespace = options.defaultNamespace ?? BUILTIN_NAMESPACE;
	}

	/**
	 * Register a single tool.
	 *
	 * @param tool - The tool to register
	 * @param source - Source identifier (e.g., "builtin", "mcp:filesystem", "extension:my-ext")
	 * @param namespace - Optional namespace override (defaults to "functions")
	 * @returns Registration result
	 */
	register(tool: AgentTool, source: string, namespace?: string): RegistrationResult {
		// Parse tool name
		const parseResult = parseToolName(tool.name, namespace ?? this._defaultNamespace);
		if (!parseResult.ok) {
			return { ok: false, error: parseResult.error };
		}
		const parsedName = parseResult.value;

		// Check for collision
		const existing = this._tools.get(parsedName.fullName);
		if (existing) {
			// Same description → merge (share tool)
			if (existing.description === tool.description) {
				return {
					ok: true,
					merged: existing.tool,
					tool: existing.tool,
				};
			}

			// Different description → collision
			const collision: ToolCollision = {
				fullName: parsedName.fullName,
				firstSource: existing.source,
				firstDescription: existing.description,
				duplicateSource: source,
				duplicateDescription: tool.description,
			};
			this._collisions.push(collision);

			if (this._strictMode) {
				return {
					ok: false,
					error: formatCollisionError(collision),
				};
			}

			// Non-strict mode: log warning but allow (last writer wins)
			console.warn(
				`Tool collision: ${parsedName.fullName} registered by ${source} overwrites ${existing.source}`,
			);
		}

		// Register the tool
		const registered: RegisteredTool = {
			tool,
			name: parsedName,
			description: tool.description,
			source,
		};
		this._tools.set(parsedName.fullName, registered);

		return { ok: true, tool: registered.tool };
	}

	/**
	 * Register multiple tools in batch.
	 * If strict mode is enabled, all registrations succeed or all fail.
	 *
	 * @param tools - Tools to register
	 * @param source - Source identifier
	 * @param namespace - Optional namespace override
	 * @returns Array of registration results
	 */
	registerBatch(
		tools: AgentTool[],
		source: string,
		namespace?: string,
	): { results: RegistrationResult[]; collisions: ToolCollision[] } {
		if (!this._strictMode) {
			const collisionStart = this._collisions.length;
			const results = tools.map((tool) => this.register(tool, source, namespace));
			return {
				results,
				collisions: this._collisions.slice(collisionStart),
			};
		}

		const stagedTools = new Map(this._tools);
		const stagedResults: RegistrationResult[] = [];
		const collisions: ToolCollision[] = [];
		const validationErrors: string[] = [];

		for (const tool of tools) {
			const parseResult = parseToolName(tool.name, namespace ?? this._defaultNamespace);
			if (!parseResult.ok) {
				validationErrors.push(parseResult.error);
				continue;
			}

			const parsedName = parseResult.value;
			const existing = stagedTools.get(parsedName.fullName);
			if (existing) {
				if (existing.description === tool.description) {
					stagedResults.push({ ok: true, merged: existing.tool, tool: existing.tool });
					continue;
				}

				collisions.push({
					fullName: parsedName.fullName,
					firstSource: existing.source,
					firstDescription: existing.description,
					duplicateSource: source,
					duplicateDescription: tool.description,
				});
				continue;
			}

			const registered: RegisteredTool = {
				tool,
				name: parsedName,
				description: tool.description,
				source,
			};
			stagedTools.set(parsedName.fullName, registered);
			stagedResults.push({ ok: true, tool: registered.tool });
		}

		if (validationErrors.length > 0 || collisions.length > 0) {
			this._collisions.push(...collisions);
			const error = [
				...validationErrors,
				...collisions.map(formatCollisionError),
			].join("\n");
			return {
				results: tools.map(() => ({ ok: false, error })),
				collisions,
			};
		}

		this._tools = stagedTools;
		return { results: stagedResults, collisions };
	}

	/**
	 * Get a tool by its full name.
	 */
	get(fullName: string): AgentTool | undefined {
		return this._tools.get(fullName)?.tool;
	}

	/**
	 * Get a tool by namespace and local name.
	 */
	getByNamespace(namespace: string, localName: string): AgentTool | undefined {
		return this.get(`${namespace}.${localName}`);
	}

	/**
	 * Check if a tool exists.
	 */
	has(fullName: string): boolean {
		return this._tools.has(fullName);
	}

	/**
	 * Get all registered tools.
	 */
	getAll(): AgentTool[] {
		return Array.from(this._tools.values()).map((r) => r.tool);
	}

	/**
	 * Get all registered tool names (full canonical names).
	 */
	getNames(): string[] {
		return Array.from(this._tools.keys());
	}

	/**
	 * Get tools by namespace.
	 */
	getByNamespacePrefix(namespace: string): AgentTool[] {
		const prefix = `${namespace}.`;
		return Array.from(this._tools.entries())
			.filter(([name]) => name.startsWith(prefix))
			.map(([, registered]) => registered.tool);
	}

	/**
	 * Clear all registered tools.
	 */
	clear(): void {
		this._tools.clear();
		this._collisions = [];
	}

	/**
	 * Get all collisions detected.
	 */
	getCollisions(): ToolCollision[] {
		return [...this._collisions];
	}

	/**
	 * Check if there are any collisions.
	 */
	hasCollisions(): boolean {
		return this._collisions.length > 0;
	}

	/**
	 * Get registry size.
	 */
	get size(): number {
		return this._tools.size;
	}
}

/**
 * Format a collision error message.
 */
function formatCollisionError(collision: ToolCollision): string {
	return [
		`Tool collision detected: "${collision.fullName}"`,
		`  First registered by: ${collision.firstSource}`,
		`    Description: "${collision.firstDescription.slice(0, 50)}${collision.firstDescription.length > 50 ? "..." : ""}"`,
		`  Attempted registration from: ${collision.duplicateSource}`,
		`    Description: "${collision.duplicateDescription.slice(0, 50)}${collision.duplicateDescription.length > 50 ? "..." : ""}"`,
		`Tools with the same name in the same namespace must have the same description.`,
	].join("\n");
}
