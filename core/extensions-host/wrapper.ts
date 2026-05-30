/**
 * [WHO]: wrapRegisteredTool()
 * [FROM]: Depends on agent-core, extensions/runner, extensions/types
 * [TO]: Consumed by core/extensions-host/index.ts
 * [HERE]: core/extensions-host/wrapper.ts - wraps RegisteredTool into AgentTool
 */
import type { AgentTool, AgentToolUpdateCallback } from "@pencil-agent/agent-core";
import type { ExtensionRunner } from "./runner.js";
import type { RegisteredTool, ToolCallEventResult } from "./types.js";

/**
 * Wrap a RegisteredTool into an AgentTool.
 * Uses the runner's createContext() for consistent context across tools and event handlers.
 */
export function wrapRegisteredTool(registeredTool: RegisteredTool, runner: ExtensionRunner): AgentTool {
	const { definition } = registeredTool;
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		aliases: definition.aliases,
		isConcurrencySafe: definition.isConcurrencySafe,
		interruptBehavior: definition.interruptBehavior,
		validateInput: definition.validateInput,
		maxResultSizeChars: definition.maxResultSizeChars,
		execute: (toolCallId, params, signal, onUpdate) =>
			definition.execute(toolCallId, params, signal, onUpdate, runner.createContext()),
	} as AgentTool;
}

/**
 * Wrap all registered tools into AgentTools.
 * Uses the runner's createContext() for consistent context across tools and event handlers.
 */
export function wrapRegisteredTools(registeredTools: RegisteredTool[], runner: ExtensionRunner): AgentTool[] {
	return registeredTools.map((rt) => wrapRegisteredTool(rt, runner));
}

/**
 * Wrap a tool with extension callbacks for interception.
 * - Emits tool_call event before execution (can block)
 * - Emits tool_result event after execution (can modify result)
 */
export function wrapToolWithExtensions<T>(tool: AgentTool<any, T>, runner: ExtensionRunner): AgentTool<any, T> {
	return {
		...tool,
		execute: async (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback<T>,
		) => {
			let toolInput = params;
			// Emit tool_call event - extensions can block execution
			if (runner.hasHandlers("tool_call")) {
				try {
					const callResult = (await runner.emitToolCall({
						type: "tool_call",
						toolName: tool.name,
						toolCallId,
						input: toolInput,
					})) as ToolCallEventResult | undefined;

					if (callResult?.block) {
						const reason = callResult.reason || "Tool execution was blocked by an extension";
						throw new Error(reason);
					}
					if (callResult?.input) {
						toolInput = callResult.input;
					}
				} catch (err) {
					if (err instanceof Error) {
						throw err;
					}
					throw new Error(`Extension failed, blocking execution: ${String(err)}`);
				}
			}

			// Execute the actual tool
			try {
				const result = await tool.execute(toolCallId, toolInput, signal, onUpdate);

				// Emit tool_result event - extensions can modify the result
				if (runner.hasHandlers("tool_result")) {
					const resultResult = await runner.emitToolResult({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input: toolInput,
						content: result.content,
						details: result.details,
						isError: false,
					});

					if (resultResult) {
						return {
							content: resultResult.content ?? result.content,
							details: (resultResult.details ?? result.details) as T,
						};
					}
				}

				return result;
			} catch (err) {
				// Emit tool_result event for errors
				if (runner.hasHandlers("tool_result")) {
					const resultResult = await runner.emitToolResult({
						type: "tool_result",
						toolName: tool.name,
						toolCallId,
						input: toolInput,
						content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
						details: undefined,
						isError: true,
					});

					if (resultResult?.content) {
						const message = resultResult.content
							.filter((part): part is { type: "text"; text: string } => part.type === "text")
							.map((part) => part.text)
							.join("\n");
						throw new Error(message || (err instanceof Error ? err.message : String(err)));
					}
				}
				throw err;
			}
		},
	};
}

/**
 * Wrap all tools with extension callbacks.
 */
export function wrapToolsWithExtensions<T>(tools: AgentTool<any, T>[], runner: ExtensionRunner): AgentTool<any, T>[] {
	return tools.map((tool) => wrapToolWithExtensions(tool, runner));
}
