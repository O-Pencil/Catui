/**
 * Structured-adaptive tool orchestration for the selectable structured loop.
 * Batches concurrency-safe tools, keeps stateful tools serial, and returns
 * ordered tool_result messages matching assistant tool_use order.
 */
/**
 * [WHO]: runStructuredAdaptiveTools, partitionStructuredAdaptiveToolCalls, StructuredAdaptiveToolCall
 * [FROM]: Depends on @pencil-agent/ai, ./types, ./errors
 * [TO]: Consumed by ./structured-adaptive-agent-loop.ts and agent-core tests
 * [HERE]: packages/agent-core/src/structured-adaptive-tool-orchestration.ts - tool batching/execution layer for structured-adaptive loop
 */

import {
	type AssistantMessage,
	EventStream,
	type TextContent,
	type ToolResultMessage,
	validateToolArguments,
} from "@pencil-agent/ai";
import { ToolNotFoundError } from "./errors.js";
import type {
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolPermissionDenial,
	AgentToolResult,
} from "./types.js";

const DEFAULT_SAFE_TOOL_NAMES = new Set([
	"read",
	"find",
	"grep",
	"ls",
	"source",
	"time",
	"web_search",
	"web_fetch",
	"CronList",
]);
const DEFAULT_MAX_TOOL_CONCURRENCY = 10;
const MAX_TOOL_CONCURRENCY_ENV = "NANOPENCIL_MAX_TOOL_USE_CONCURRENCY";

export type StructuredAdaptiveToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

export interface StructuredAdaptiveToolRunResult {
	toolResults: ToolResultMessage[];
	contextMessages: AgentMessage[];
	steeringMessages?: AgentMessage[];
	permissionDenials: AgentToolPermissionDenial[];
}

interface StructuredAdaptiveToolUseResult {
	toolResult: ToolResultMessage;
	contextMessages: AgentMessage[];
}

export async function runStructuredAdaptiveTools(
	toolCalls: StructuredAdaptiveToolCall[],
	tools: AgentTool<any>[] | undefined,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	getSteeringMessages?: AgentLoopConfig["getSteeringMessages"],
	maxConcurrency?: number,
	canUseTool?: AgentLoopConfig["canUseTool"],
): Promise<StructuredAdaptiveToolRunResult> {
	const results: ToolResultMessage[] = [];
	const contextMessages: AgentMessage[] = [];
	const permissionDenials: AgentToolPermissionDenial[] = [];
	const toolByName = buildToolMap(tools);
	const batches = partitionStructuredAdaptiveToolCalls(toolCalls, toolByName);

	let consumed = 0;
	for (const batch of batches) {
		const batchUses = await runToolBatch(
			batch,
			(toolCall) =>
				runStructuredAdaptiveToolUse(
					toolCall,
					toolByName.get(toolCall.name),
					signal,
					stream,
					canUseTool,
			),
			maxConcurrency,
		);
		const batchResults = batchUses.map((use) => use.toolResult);
		results.push(...batchResults);
		contextMessages.push(...batchUses.flatMap((use) => use.contextMessages));
		permissionDenials.push(...extractPermissionDenials(batchResults));
		consumed += batch.length;

		if (getSteeringMessages) {
			const steering = await getSteeringMessages();
			if (steering.length > 0) {
				for (const skipped of toolCalls.slice(consumed)) {
					results.push(skipStructuredAdaptiveToolCall(skipped, stream));
				}
				return { toolResults: results, contextMessages, steeringMessages: steering, permissionDenials };
			}
		}
	}

	return { toolResults: results, contextMessages, permissionDenials };
}

async function runToolBatch<T, TResult>(
	items: T[],
	run: (item: T) => Promise<TResult>,
	maxConcurrency: number | undefined,
): Promise<TResult[]> {
	const limit = resolveMaxToolConcurrency(maxConcurrency);
	const results: TResult[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await run(items[index]!);
		}
	}

	const workerCount = Math.min(limit, items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}

function resolveMaxToolConcurrency(maxConcurrency: number | undefined): number {
	if (maxConcurrency !== undefined) {
		return Math.max(1, Math.floor(maxConcurrency || DEFAULT_MAX_TOOL_CONCURRENCY));
	}
	const raw = typeof process !== "undefined" ? process.env[MAX_TOOL_CONCURRENCY_ENV] : undefined;
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	if (Number.isFinite(parsed) && parsed > 0) {
		return Math.floor(parsed);
	}
	return DEFAULT_MAX_TOOL_CONCURRENCY;
}

export function buildToolMap(tools: AgentTool<any>[] | undefined): Map<string, AgentTool<any>> {
	const toolByName = new Map<string, AgentTool<any>>();
	for (const tool of tools ?? []) {
		toolByName.set(tool.name, tool);
		for (const alias of tool.aliases ?? []) {
			if (!toolByName.has(alias)) {
				toolByName.set(alias, tool);
			}
		}
	}
	return toolByName;
}

export function partitionStructuredAdaptiveToolCalls(
	toolCalls: StructuredAdaptiveToolCall[],
	toolByName: Map<string, AgentTool<any>>,
): StructuredAdaptiveToolCall[][] {
	const batches: StructuredAdaptiveToolCall[][] = [];
	let safeBatch: StructuredAdaptiveToolCall[] = [];

	for (const toolCall of toolCalls) {
		const tool = toolByName.get(toolCall.name);
		if (isConcurrencySafe(tool, toolCall.name)) {
			safeBatch.push(toolCall);
			continue;
		}

		if (safeBatch.length > 0) {
			batches.push(safeBatch);
			safeBatch = [];
		}
		batches.push([toolCall]);
	}

	if (safeBatch.length > 0) {
		batches.push(safeBatch);
	}

	return batches;
}

function isConcurrencySafe(tool: AgentTool<any> | undefined, name: string): boolean {
	return tool?.isConcurrencySafe ?? DEFAULT_SAFE_TOOL_NAMES.has(name);
}

async function runStructuredAdaptiveToolUse(
	toolCall: StructuredAdaptiveToolCall,
	tool: AgentTool<any> | undefined,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	canUseTool?: AgentLoopConfig["canUseTool"],
): Promise<StructuredAdaptiveToolUseResult> {
	const startedAt = Date.now();
	stream.push({
		type: "tool_execution_start",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		args: toolCall.arguments,
	});

	let result: AgentToolResult<any>;
	let isError = false;

	try {
		if (!tool) throw new ToolNotFoundError(toolCall.name);
		const validatedArgs = validateToolArguments(tool, toolCall);
		const validationMessage = await tool.validateInput?.(validatedArgs);
		if (typeof validationMessage === "string" && validationMessage.trim()) {
			throw new Error(validationMessage);
		}
		const permission = await canUseTool?.({
			toolCallId: toolCall.id,
			toolName: tool.name,
			requestedToolName: toolCall.name,
			input: validatedArgs,
			rawInput: toolCall.arguments,
			tool,
		});
		if (permission?.decision === "deny") {
			const reason = permission.reason?.trim();
			result = {
				content: [
					{ type: "text", text: reason ? `Permission denied: ${reason}` : `Permission denied for ${tool.name}` },
				],
				details: {
					errorType: "permission_denied",
					reason,
					toolName: tool.name,
					toolCallId: toolCall.id,
				},
			};
			isError = true;
		} else {
			result = await tool.execute(toolCall.id, validatedArgs, signal, (partialResult) => {
				stream.push({
					type: "tool_execution_update",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					args: toolCall.arguments,
					partialResult,
				});
			});
			result = enforceMaxResultSize(result, tool.maxResultSizeChars);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result = {
			content: [{ type: "text", text: message }],
			details: isPermissionDeniedMessage(message)
				? {
						errorType: "permission_denied",
						reason: message,
						toolName: tool?.name ?? toolCall.name,
						toolCallId: toolCall.id,
					}
				: {},
		};
		isError = true;
	}

	stream.push({
		type: "tool_execution_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result,
		isError,
		durationMs: Date.now() - startedAt,
	});

	const toolResult: ToolResultMessage = {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: result.content,
		details: result.details,
		isError,
		timestamp: Date.now(),
	};

	return {
		toolResult,
		contextMessages: result.contextMessages ?? [],
	};
}

function isPermissionDeniedMessage(message: string): boolean {
	return /^Permission (denied|request was cancelled)/i.test(message.trim());
}

function extractPermissionDenials(toolResults: ToolResultMessage[]): AgentToolPermissionDenial[] {
	const denials: AgentToolPermissionDenial[] = [];
	for (const result of toolResults) {
		const details = result.details;
		if (!details || typeof details !== "object") continue;
		if ((details as { errorType?: unknown }).errorType !== "permission_denied") continue;
		const reason = (details as { reason?: unknown }).reason;
		denials.push({
			toolCallId: result.toolCallId,
			toolName: result.toolName,
			reason: typeof reason === "string" && reason.length > 0 ? reason : undefined,
		});
	}
	return denials;
}

function enforceMaxResultSize<T>(
	result: AgentToolResult<T>,
	maxResultSizeChars: number | undefined,
): AgentToolResult<T> {
	if (!maxResultSizeChars || maxResultSizeChars <= 0) return result;

	let remaining = Math.floor(maxResultSizeChars);
	let truncated = false;
	const content = result.content.map((part) => {
		if (part.type !== "text") return part;
		if (remaining <= 0) {
			truncated = true;
			return { ...part, text: "" } satisfies TextContent;
		}
		if (part.text.length <= remaining) {
			remaining -= part.text.length;
			return part;
		}
		truncated = true;
		const text = part.text.slice(0, remaining);
		remaining = 0;
		return { ...part, text } satisfies TextContent;
	});

	if (!truncated) return result;

	const note = `\n\n[Tool result truncated to ${Math.floor(maxResultSizeChars)} characters.]`;
	let lastTextIndex = -1;
	for (let i = content.length - 1; i >= 0; i -= 1) {
		if (content[i]?.type === "text") {
			lastTextIndex = i;
			break;
		}
	}
	if (lastTextIndex >= 0) {
		const part = content[lastTextIndex] as TextContent;
		content[lastTextIndex] = { ...part, text: `${part.text}${note}` };
	} else {
		content.push({ type: "text", text: note.trimStart() });
	}

	return { ...result, content };
}

function skipStructuredAdaptiveToolCall(
	toolCall: StructuredAdaptiveToolCall,
	stream: EventStream<AgentEvent, AgentMessage[]>,
): ToolResultMessage {
	const startedAt = Date.now();
	const result: AgentToolResult<any> = {
		content: [{ type: "text", text: "Skipped due to queued user message." }],
		details: {},
	};

	stream.push({
		type: "tool_execution_start",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		args: toolCall.arguments,
	});
	stream.push({
		type: "tool_execution_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result,
		isError: true,
		durationMs: Date.now() - startedAt,
	});

	return {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: result.content,
		details: result.details,
		isError: true,
		timestamp: Date.now(),
	};
}
