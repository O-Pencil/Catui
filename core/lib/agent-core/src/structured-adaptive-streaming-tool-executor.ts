/**
 * Structured-adaptive streaming tool executor.
 * Starts complete streamed tool calls before the assistant response finishes,
 * while preserving ordered tool_result emission for the next model turn.
 */
/**
 * [WHO]: StructuredAdaptiveStreamingToolExecutor
 * [FROM]: Depends on @pencil-agent/ai, ./types, ./structured-adaptive-tool-orchestration
 * [TO]: Consumed by ./structured-adaptive-agent-loop.ts
 * [HERE]: core/lib/agent-core/src/structured-adaptive-streaming-tool-executor.ts - streaming tool scheduling for weak-model-compatible loop
 */

import { EventStream, type ToolResultMessage } from "@pencil-agent/ai";
import type { AgentToolResult } from "./types.js";
import type {
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolPermissionDenial,
} from "./types.js";
import {
	buildToolMap,
	isStructuredAdaptiveToolCallConcurrencySafe,
	resolveStructuredAdaptiveToolInterruptBehavior,
	runStructuredAdaptiveToolUse,
	type StructuredAdaptiveToolCall,
	type StructuredAdaptiveToolRunResult,
} from "./structured-adaptive-tool-orchestration.js";

type StreamingToolStatus = "queued" | "executing" | "completed";

interface StreamingToolRecord {
	toolCall: StructuredAdaptiveToolCall;
	tool: AgentTool<any> | undefined;
	isConcurrencySafe: boolean;
	interruptBehavior: "cancel" | "block";
	status: StreamingToolStatus;
	abortController: AbortController;
	promise?: Promise<void>;
	toolResult?: ToolResultMessage;
	contextMessages: AgentMessage[];
}

export class StructuredAdaptiveStreamingToolExecutor {
	private readonly toolByName: Map<string, AgentTool<any>>;
	private readonly records: StreamingToolRecord[] = [];
	private readonly maxConcurrency: number;
	private discardedReason: string | undefined;
	private parentAborted = false;
	private parentAbortReason: unknown;

	constructor(
		tools: AgentTool<any>[] | undefined,
		signal: AbortSignal | undefined,
		private readonly stream: EventStream<AgentEvent, AgentMessage[]>,
		maxConcurrency: number,
		private readonly canUseTool?: AgentLoopConfig["canUseTool"],
	) {
		this.toolByName = buildToolMap(tools);
		this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
		if (signal?.aborted) {
			this.parentAborted = true;
			this.parentAbortReason = signal.reason;
		} else {
			signal?.addEventListener(
				"abort",
				() => {
					this.parentAborted = true;
					this.parentAbortReason = signal.reason;
					for (const record of this.records) {
						if (record.interruptBehavior === "cancel" && !record.abortController.signal.aborted) {
							record.abortController.abort(signal.reason);
						}
					}
				},
				{ once: true },
			);
		}
	}

	get size(): number {
		return this.records.length;
	}

	addTool(toolCall: StructuredAdaptiveToolCall): void {
		if (this.records.some((record) => record.toolCall.id === toolCall.id)) return;
		const tool = this.toolByName.get(toolCall.name);
		const abortController = new AbortController();
		const interruptBehavior = resolveStructuredAdaptiveToolInterruptBehavior(toolCall, tool);
		if (this.parentAborted && interruptBehavior === "cancel") {
			abortController.abort(this.parentAbortReason);
		}
		this.records.push({
			toolCall,
			tool,
			isConcurrencySafe: isStructuredAdaptiveToolCallConcurrencySafe(toolCall, tool),
			interruptBehavior,
			status: "queued",
			abortController,
			contextMessages: [],
		});
		this.processQueue();
	}

	async drain(): Promise<StructuredAdaptiveToolRunResult> {
		this.processQueue();
		while (this.records.some((record) => record.status !== "completed")) {
			const running = this.records
				.filter((record) => record.status === "executing" && record.promise)
				.map((record) => record.promise!);
			if (running.length === 0) {
				this.processQueue();
				continue;
			}
			await Promise.race(running);
			this.processQueue();
		}

		const toolResults = this.records.map((record) => record.toolResult!);
		return {
			toolResults,
			contextMessages: this.records.flatMap((record) => record.contextMessages),
			permissionDenials: extractPermissionDenials(toolResults),
		};
	}

	async discardAndDrain(
		reason: string,
		abortMode: "all" | "cancel" = "all",
	): Promise<StructuredAdaptiveToolRunResult> {
		this.discardedReason = reason;
		for (const record of this.records) {
			if (
				record.status === "executing" &&
				(abortMode === "all" || record.interruptBehavior === "cancel") &&
				!record.abortController.signal.aborted
			) {
				record.abortController.abort(reason);
			}
			if (record.status === "queued") {
				this.completeWithSyntheticError(record, reason);
			}
		}
		return this.drain();
	}

	private processQueue(): void {
		for (const record of this.records) {
			if (record.status !== "queued") continue;
			if (this.discardedReason) {
				this.completeWithSyntheticError(record, this.discardedReason);
				continue;
			}
			if (!this.canStart(record)) {
				if (!record.isConcurrencySafe) return;
				continue;
			}
			this.start(record);
		}
	}

	private canStart(record: StreamingToolRecord): boolean {
		const executing = this.records.filter((candidate) => candidate.status === "executing");
		if (record.isConcurrencySafe) {
			return (
				executing.length < this.maxConcurrency &&
				executing.every((candidate) => candidate.isConcurrencySafe)
			);
		}
		return executing.length === 0;
	}

	private start(record: StreamingToolRecord): void {
		record.status = "executing";
		record.promise = runStructuredAdaptiveToolUse(
			record.toolCall,
			record.tool,
			record.abortController.signal,
			this.stream,
			this.canUseTool,
		)
			.then((result) => {
				record.toolResult = result.toolResult;
				record.contextMessages = result.contextMessages;
			})
			.finally(() => {
				record.status = "completed";
			});
	}

	private completeWithSyntheticError(record: StreamingToolRecord, reason: string): void {
		const startedAt = Date.now();
		const result: AgentToolResult<Record<string, unknown>> = {
			content: [{ type: "text", text: `Tool discarded because ${reason}.` }],
			details: {
				errorType: "streaming_tool_discarded",
				reason,
				toolName: record.tool?.name ?? record.toolCall.name,
				toolCallId: record.toolCall.id,
			},
		};
		this.stream.push({
			type: "tool_execution_start",
			toolCallId: record.toolCall.id,
			toolName: record.toolCall.name,
			args: record.toolCall.arguments,
		});
		this.stream.push({
			type: "tool_execution_end",
			toolCallId: record.toolCall.id,
			toolName: record.toolCall.name,
			result,
			isError: true,
			durationMs: Date.now() - startedAt,
		});
		record.toolResult = {
			role: "toolResult",
			toolCallId: record.toolCall.id,
			toolName: record.toolCall.name,
			content: result.content,
			details: result.details,
			isError: true,
			timestamp: Date.now(),
		};
		record.contextMessages = [];
		record.status = "completed";
	}
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
