/**
 * Structured-adaptive agent loop for nanoPencil.
 * Keeps the public AgentMessage/EventStream contract while using a query-loop
 * state machine with ordered tool-result pairing and safe tool batching.
 */
/**
 * [WHO]: structuredAdaptiveAgentLoop, structuredAdaptiveAgentLoopContinue
 * [FROM]: Depends on @pencil-agent/ai, ./types, ./errors, structured-adaptive tool executors, and shared loop helpers.
 * [TO]: Consumed by packages/agent-core/src/agent.ts and index.ts
 * [HERE]: packages/agent-core/src/structured-adaptive-agent-loop.ts - selectable structured-adaptive query loop framework with recovered-error tombstoning
 */

import {
	type AssistantMessage,
	type Context,
	EventStream,
	isContextOverflow,
	streamSimple,
	type ToolResultMessage,
	type Usage,
} from "@pencil-agent/ai";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopTransition,
	AgentLoopConfig,
	AgentMessage,
	AgentToolPermissionDenial,
	StreamFn,
} from "./types.js";
import {
	resolveMaxToolConcurrency,
	runStructuredAdaptiveTools,
} from "./structured-adaptive-tool-orchestration.js";
import { StructuredAdaptiveStreamingToolExecutor } from "./structured-adaptive-streaming-tool-executor.js";
import { ValidationError } from "./errors.js";
import {
	computeRecoveryMaxTokens,
	createOutputTokenRecoveryMessage,
	createTokenBudgetContinuation,
} from "./agent-loop-continuations.js";
import {
	createInterruptedToolResults,
	createSkippedToolCallLimitResults,
	enforceToolResultBatchSize,
} from "./agent-loop-tool-results.js";
import {
	flushReadyToolUseSummaries,
	type PendingToolUseSummary,
	startToolUseSummary,
} from "./agent-loop-tool-summaries.js";
import { buildAgentRunPolicy, resolveAgentRunLoopFramework } from "./agent-run-result.js";

const DEFAULT_MAX_TURNS_PER_PROMPT = 64;
const DEFAULT_MAX_TOOL_CALLS_PER_PROMPT = 128;
const DEFAULT_MAX_OUTPUT_TOKEN_RECOVERY_ATTEMPTS = 1;
const DEFAULT_MAX_STOP_HOOK_CONTINUATIONS = 3;
const DEFAULT_MAX_MODEL_ERROR_RECOVERY_ATTEMPTS = 1;

interface QueryLoopState {
	config: AgentLoopConfig;
	turnCount: number;
	toolCallCount: number;
	transition: AgentLoopTransition;
	transitions: AgentLoopTransition[];
	pendingMessages: AgentMessage[];
	pendingToolUseSummaries: PendingToolUseSummary[];
	stopHookActive: boolean;
	stopHookContinuationCount: number;
	maxOutputTokensRecoveryCount: number;
	modelErrorRecoveryCount: number;
	tokenBudgetContinuationCount: number;
	hasAttemptedReactiveCompact: boolean;
	maxOutputTokensOverride?: number;
	startedAt: number;
	usage: Usage;
	permissionDenials: AgentToolPermissionDenial[];
	finalStopReason?: string;
	finalErrorMessage?: string;
	finalErrorSubtype?: string;
}

export function structuredAdaptiveAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	const stream = createAgentStream();

	(async () => {
		const newMessages: AgentMessage[] = [...prompts];
		const currentContext: AgentContext = {
			...context,
			messages: [...context.messages, ...prompts],
		};

		try {
			stream.push({ type: "agent_start" });
			stream.push({ type: "turn_start" });
			for (const prompt of prompts) {
				stream.push({ type: "message_start", message: prompt });
				stream.push({ type: "message_end", message: prompt });
			}

			await runStructuredAdaptiveQueryLoop(currentContext, newMessages, config, signal, stream, streamFn);
		} catch (error: unknown) {
			endWithLoopError(stream, newMessages, config, error, signal);
		}
	})();

	return stream;
}

export function structuredAdaptiveAgentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new ValidationError("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new ValidationError("Cannot continue from message role: assistant");
	}

	const stream = createAgentStream();

	(async () => {
		const newMessages: AgentMessage[] = [];
		const currentContext: AgentContext = { ...context };

		try {
			stream.push({ type: "agent_start" });
			stream.push({ type: "turn_start" });
			await runStructuredAdaptiveQueryLoop(currentContext, newMessages, config, signal, stream, streamFn);
		} catch (error: unknown) {
			endWithLoopError(stream, newMessages, config, error, signal);
		}
	})();

	return stream;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

async function runStructuredAdaptiveQueryLoop(
	currentContext: AgentContext,
	newMessages: AgentMessage[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
): Promise<void> {
	const maxTurns = config.maxTurnsPerPrompt ?? DEFAULT_MAX_TURNS_PER_PROMPT;
	const maxToolCalls = config.maxToolCallsPerPrompt ?? DEFAULT_MAX_TOOL_CALLS_PER_PROMPT;
	const maxOutputTokenRecoveryAttempts =
		config.maxOutputTokenRecoveryAttempts ?? DEFAULT_MAX_OUTPUT_TOKEN_RECOVERY_ATTEMPTS;
	const maxStopHookContinuations = config.maxStopHookContinuations ?? DEFAULT_MAX_STOP_HOOK_CONTINUATIONS;
	const maxModelErrorRecoveryAttempts =
		config.maxModelErrorRecoveryAttempts ?? DEFAULT_MAX_MODEL_ERROR_RECOVERY_ATTEMPTS;
	const state: QueryLoopState = {
		config,
		turnCount: 0,
		toolCallCount: 0,
		transition: { reason: "start" },
		transitions: [],
		pendingMessages: (await config.getSteeringMessages?.()) || [],
		pendingToolUseSummaries: [],
		stopHookActive: false,
		stopHookContinuationCount: 0,
		maxOutputTokensRecoveryCount: 0,
		modelErrorRecoveryCount: 0,
		tokenBudgetContinuationCount: 0,
		hasAttemptedReactiveCompact: false,
		startedAt: Date.now(),
		usage: emptyUsage(),
		permissionDenials: [],
	};
	let firstTurn = true;

	while (true) {
		if (!firstTurn) {
			stream.push({ type: "turn_start" });
		} else {
			firstTurn = false;
		}

		state.pendingToolUseSummaries = flushReadyToolUseSummaries(
			state.pendingToolUseSummaries,
			currentContext.messages,
			newMessages,
			stream,
		);

		if (state.pendingMessages.length > 0) {
			for (const message of state.pendingMessages) {
				stream.push({ type: "message_start", message });
				stream.push({ type: "message_end", message });
				currentContext.messages.push(message);
				newMessages.push(message);
			}
			state.pendingMessages = [];
		}

		state.turnCount += 1;
		if (state.turnCount > maxTurns) {
			const limitMessage = createLoopLimitMessage(
				config,
				`max_turns_reached: stopped after ${maxTurns} assistant turns to prevent a runaway agent loop.`,
			);
			currentContext.messages.push(limitMessage);
			newMessages.push(limitMessage);
			stream.push({ type: "message_start", message: { ...limitMessage } });
			stream.push({ type: "message_end", message: limitMessage });
			stream.push({ type: "turn_end", message: limitMessage, toolResults: [] });
			recordTransition(state, {
				reason: "max_turns_reached",
				maxTurns,
				turnCount: state.turnCount,
			});
			state.finalStopReason = "error";
			state.finalErrorMessage = limitMessage.errorMessage;
			state.finalErrorSubtype = "max_turns_reached";
			finish(stream, newMessages, state);
			return;
		}

		const streamingToolExecutor = new StructuredAdaptiveStreamingToolExecutor(
			currentContext.tools,
			signal,
			stream,
			resolveMaxToolConcurrency(config.maxToolConcurrency),
			config.canUseTool,
		);
		const responseStartMessageCount = newMessages.length;
		const message = await streamAssistantResponse(
			currentContext,
			config,
			signal,
			stream,
			streamFn,
			state.maxOutputTokensOverride,
			streamingToolExecutor,
		);
		newMessages.push(message);
		addUsage(state.usage, message.usage);
		state.maxOutputTokensOverride = undefined;

		if (message.stopReason === "error" || message.stopReason === "aborted") {
			const errorSubtype =
				message.stopReason === "aborted"
					? "aborted"
					: isContextOverflow(message, config.model.contextWindow)
						? "context_overflow"
						: "model_error";
			const failedToolExecution =
				streamingToolExecutor.size > 0
					? await streamingToolExecutor.discardAndDrain(
							message.stopReason === "aborted" ? "assistant stream aborted" : "assistant stream error",
							message.stopReason === "aborted" ? "cancel" : "all",
						)
					: { toolResults: [], contextMessages: [], permissionDenials: [] };
			const toolResults = enforceToolResultBatchSize(
				failedToolExecution.toolResults,
				config.maxToolResultBatchSizeChars,
			);
			const interruptedToolResults = createInterruptedToolResults(
				message,
				new Set(toolResults.map((result) => result.toolCallId)),
			);
			const allToolResults = [...toolResults, ...interruptedToolResults];
			for (const result of allToolResults) {
				currentContext.messages.push(result);
				newMessages.push(result);
				stream.push({ type: "message_start", message: result });
				stream.push({ type: "message_end", message: result });
			}
			for (const contextMessage of failedToolExecution.contextMessages) {
				currentContext.messages.push(contextMessage);
				newMessages.push(contextMessage);
				stream.push({ type: "message_start", message: contextMessage });
				stream.push({ type: "message_end", message: contextMessage });
			}

			if (
				message.stopReason === "error" &&
				config.recoverModelError &&
				state.modelErrorRecoveryCount < maxModelErrorRecoveryAttempts
			) {
				const attempt = state.modelErrorRecoveryCount + 1;
				const recovery = await config.recoverModelError({
					message,
					messages: currentContext.messages,
					errorSubtype,
					attempt,
				});
				if (recovery.action === "retry") {
					stream.push({ type: "turn_end", message, toolResults: allToolResults });
					state.modelErrorRecoveryCount = attempt;
					newMessages.splice(responseStartMessageCount);
					currentContext.messages = recovery.messages;
					recordTransition(
						state,
						recovery.transition ?? {
							reason: "model_error_recovery",
							subtype: errorSubtype,
							attempt,
						},
					);
					continue;
				}
			}

			state.permissionDenials.push(...failedToolExecution.permissionDenials);
			stream.push({ type: "turn_end", message, toolResults: allToolResults });
			state.finalStopReason = message.stopReason;
			state.finalErrorMessage = message.errorMessage;
			state.finalErrorSubtype = errorSubtype;
			finish(stream, newMessages, state);
			return;
		}

		const toolCalls = message.content.filter((c) => c.type === "toolCall");
		if (toolCalls.length === 0) {
			stream.push({ type: "turn_end", message, toolResults: [] });

			if (
				message.stopReason === "length" &&
				state.maxOutputTokensRecoveryCount < maxOutputTokenRecoveryAttempts
			) {
				state.maxOutputTokensRecoveryCount += 1;
				state.maxOutputTokensOverride = computeRecoveryMaxTokens(config, message);
				state.pendingMessages = [createOutputTokenRecoveryMessage(state.maxOutputTokensRecoveryCount)];
				recordTransition(state, {
					reason: "max_output_tokens_recovery",
					attempt: state.maxOutputTokensRecoveryCount,
				});
				continue;
			}

			if (config.runStopHooks && !state.stopHookActive) {
				state.stopHookActive = true;
				const stopHookResult = await config.runStopHooks({
					message,
					messages: currentContext.messages,
				});
				state.stopHookActive = false;
				if (stopHookResult.action === "continue" && stopHookResult.messages.length > 0) {
					if (state.stopHookContinuationCount >= maxStopHookContinuations) {
						const limitMessage = createLoopLimitMessage(
							config,
							`stop_hook_limit_reached: stopped after ${maxStopHookContinuations} stop-hook continuation turns.`,
						);
						currentContext.messages.push(limitMessage);
						newMessages.push(limitMessage);
						stream.push({ type: "message_start", message: { ...limitMessage } });
						stream.push({ type: "message_end", message: limitMessage });
						stream.push({ type: "turn_end", message: limitMessage, toolResults: [] });
						recordTransition(state, {
							reason: "stop_hook_limit_reached",
							maxContinuations: maxStopHookContinuations,
							continuationCount: state.stopHookContinuationCount,
						});
						state.finalStopReason = "error";
						state.finalErrorMessage = limitMessage.errorMessage;
						state.finalErrorSubtype = "stop_hook_limit_reached";
						finish(stream, newMessages, state);
						return;
					}
					state.stopHookContinuationCount += 1;
					state.pendingMessages = stopHookResult.messages;
					recordTransition(state, {
						reason: "stop_hook_blocking",
						continuationCount: state.stopHookContinuationCount,
					});
					continue;
				}
			}

			const tokenBudgetContinuation = createTokenBudgetContinuation(
				config,
				state.usage.output,
				state.tokenBudgetContinuationCount,
			);
			if (tokenBudgetContinuation) {
				state.tokenBudgetContinuationCount += 1;
				state.pendingMessages = [tokenBudgetContinuation.message];
				recordTransition(state, {
					reason: "token_budget_continuation",
					continuationCount: state.tokenBudgetContinuationCount,
					outputTokens: tokenBudgetContinuation.outputTokens,
					targetTokens: tokenBudgetContinuation.targetTokens,
				});
				continue;
			}

			const followUpMessages = (await config.getFollowUpMessages?.()) || [];
			if (followUpMessages.length === 0) {
				break;
			}
			state.pendingMessages = followUpMessages;
			recordTransition(state, { reason: "follow_up" });
			continue;
		}

		if (state.toolCallCount + toolCalls.length > maxToolCalls) {
			const skippedToolResults = createSkippedToolCallLimitResults(
				message,
				`Tool call skipped because this prompt reached the ${maxToolCalls} tool-call limit.`,
			);
			for (const result of skippedToolResults) {
				currentContext.messages.push(result);
				newMessages.push(result);
				stream.push({ type: "message_start", message: result });
				stream.push({ type: "message_end", message: result });
			}
			const limitMessage = createLoopLimitMessage(
				config,
				`tool_call_limit_reached: stopped before executing ${toolCalls.length} tool call${
					toolCalls.length === 1 ? "" : "s"
				} because this prompt reached the ${maxToolCalls} tool-call limit.`,
			);
			currentContext.messages.push(limitMessage);
			newMessages.push(limitMessage);
			stream.push({ type: "message_start", message: { ...limitMessage } });
			stream.push({ type: "message_end", message: limitMessage });
			stream.push({ type: "turn_end", message: limitMessage, toolResults: skippedToolResults });
			recordTransition(state, {
				reason: "tool_call_limit_reached",
				maxToolCalls,
				requestedToolCalls: toolCalls.length,
				toolCallCount: state.toolCallCount,
			});
			state.finalStopReason = "error";
			state.finalErrorMessage = limitMessage.errorMessage;
			state.finalErrorSubtype = "tool_call_limit_reached";
			finish(stream, newMessages, state);
			return;
		}

		state.toolCallCount += toolCalls.length;
		const toolExecution =
			streamingToolExecutor.size > 0
				? await streamingToolExecutor.drain()
				: await runStructuredAdaptiveTools(
						toolCalls,
						currentContext.tools,
						signal,
						stream,
						config.getSteeringMessages,
						config.maxToolConcurrency,
						config.canUseTool,
					);
		const toolResults = enforceToolResultBatchSize(
			toolExecution.toolResults,
			config.maxToolResultBatchSizeChars,
		);
		state.permissionDenials.push(...toolExecution.permissionDenials);

		for (const result of toolResults) {
			currentContext.messages.push(result);
			newMessages.push(result);
			stream.push({ type: "message_start", message: result });
			stream.push({ type: "message_end", message: result });
		}
		for (const contextMessage of toolExecution.contextMessages) {
			currentContext.messages.push(contextMessage);
			newMessages.push(contextMessage);
			stream.push({ type: "message_start", message: contextMessage });
			stream.push({ type: "message_end", message: contextMessage });
		}

		const pendingSummary = startToolUseSummary(config, {
			assistantMessage: message,
			toolResults,
			contextMessages: toolExecution.contextMessages,
			messages: currentContext.messages,
		});
		if (pendingSummary) {
			state.pendingToolUseSummaries.push(pendingSummary);
		}

		stream.push({ type: "turn_end", message, toolResults });

		if (toolExecution.steeringMessages && toolExecution.steeringMessages.length > 0) {
			state.pendingMessages = toolExecution.steeringMessages;
		} else {
			state.pendingMessages = (await config.getSteeringMessages?.()) || [];
		}
		recordTransition(state, { reason: "tool_result", toolCallCount: toolCalls.length });
	}

	state.finalStopReason = state.finalStopReason ?? inferStopReason(newMessages);
	finish(stream, newMessages, state);
}

async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
	maxTokensOverride?: number,
	streamingToolExecutor?: StructuredAdaptiveStreamingToolExecutor,
): Promise<AssistantMessage> {
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	const llmMessages = await config.convertToLlm(messages);
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: llmMessages,
		tools: context.tools,
	};

	const streamFunction = streamFn || streamSimple;
	const resolvedApiKey =
		(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

	stream.push({
		type: "stream_request_start",
		model: config.model.id,
		provider: config.model.provider,
		api: config.model.api,
		messageCount: llmMessages.length,
		maxTokens: maxTokensOverride ?? config.maxTokens,
	});

	const response = await streamFunction(config.model, llmContext, {
		...config,
		maxTokens: maxTokensOverride ?? config.maxTokens,
		apiKey: resolvedApiKey,
		signal,
	});

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;

	for await (const event of response) {
		switch (event.type) {
			case "start":
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				stream.push({ type: "message_start", message: { ...partialMessage } });
				break;
			case "text_start":
			case "text_delta":
			case "text_end":
			case "thinking_start":
			case "thinking_delta":
			case "thinking_end":
			case "toolcall_start":
			case "toolcall_delta":
				if (partialMessage) {
					partialMessage = event.partial;
					context.messages[context.messages.length - 1] = partialMessage;
					stream.push({
						type: "message_update",
						assistantMessageEvent: event,
						message: { ...partialMessage },
					});
				}
				break;
			case "toolcall_end":
				if (partialMessage) {
					partialMessage = event.partial;
					context.messages[context.messages.length - 1] = partialMessage;
					stream.push({
						type: "message_update",
						assistantMessageEvent: event,
						message: { ...partialMessage },
					});
					streamingToolExecutor?.addTool(event.toolCall);
				}
				break;
			case "done":
			case "error": {
				const finalMessage = await response.result();
				if (addedPartial) {
					context.messages[context.messages.length - 1] = finalMessage;
				} else {
					context.messages.push(finalMessage);
				}
				if (!addedPartial) {
					stream.push({ type: "message_start", message: { ...finalMessage } });
				}
				stream.push({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}

	return await response.result();
}

function createLoopLimitMessage(config: AgentLoopConfig, errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "" }],
		api: config.model.api,
		provider: config.model.provider,
		model: config.model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage,
		timestamp: Date.now(),
	};
}

function endWithLoopError(
	stream: EventStream<AgentEvent, AgentMessage[]>,
	newMessages: AgentMessage[],
	config: AgentLoopConfig,
	error: unknown,
	signal: AbortSignal | undefined,
): void {
	const errorMessage = createLoopLimitMessage(
		config,
		error instanceof Error ? error.message : String(error),
	);
	if (signal?.aborted) {
		errorMessage.stopReason = "aborted";
	}
	newMessages.push(errorMessage);
	stream.push({ type: "message_start", message: { ...errorMessage } });
	stream.push({ type: "message_end", message: errorMessage });
	stream.push({ type: "turn_end", message: errorMessage, toolResults: [] });
	const state: QueryLoopState = {
		config,
		turnCount: 0,
		toolCallCount: 0,
		transition: { reason: "start" },
		transitions: [],
		pendingMessages: [],
		pendingToolUseSummaries: [],
		stopHookActive: false,
		stopHookContinuationCount: 0,
		maxOutputTokensRecoveryCount: 0,
		modelErrorRecoveryCount: 0,
		tokenBudgetContinuationCount: 0,
		hasAttemptedReactiveCompact: false,
		startedAt: Date.now(),
		usage: emptyUsage(),
		permissionDenials: [],
		finalStopReason: errorMessage.stopReason,
		finalErrorMessage: errorMessage.errorMessage,
		finalErrorSubtype: signal?.aborted ? "aborted" : "loop_error",
	};
	finish(stream, newMessages, state);
}

function finish(
	stream: EventStream<AgentEvent, AgentMessage[]>,
	newMessages: AgentMessage[],
	state: QueryLoopState,
): void {
	stream.push({
		type: "agent_result",
		stopReason: state.finalStopReason ?? inferStopReason(newMessages),
		loopFramework: resolveAgentRunLoopFramework(state.config),
		loopPolicy: buildAgentRunPolicy(state.config),
		turnCount: state.turnCount,
		toolCallCount: state.toolCallCount,
		durationMs: Date.now() - state.startedAt,
		usage: state.usage,
		permissionDenialCount: state.permissionDenials.length,
		permissionDenials: state.permissionDenials,
		transitions: state.transitions.length > 0 ? state.transitions : undefined,
		lastTransition: state.transition,
		errorMessage: state.finalErrorMessage,
		errorSubtype: state.finalErrorSubtype,
	});
	stream.push({ type: "agent_end", messages: newMessages });
	stream.end(newMessages);
}

function recordTransition(state: QueryLoopState, transition: AgentLoopTransition): void {
	state.transition = transition;
	state.transitions.push(transition);
}

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function addUsage(target: Usage, usage: Usage): void {
	target.input += usage.input;
	target.output += usage.output;
	target.cacheRead += usage.cacheRead;
	target.cacheWrite += usage.cacheWrite;
	target.totalTokens += usage.totalTokens;
	target.cost.input += usage.cost.input;
	target.cost.output += usage.cost.output;
	target.cost.cacheRead += usage.cost.cacheRead;
	target.cost.cacheWrite += usage.cost.cacheWrite;
	target.cost.total += usage.cost.total;
}

function inferStopReason(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message?.role === "assistant") {
			return message.stopReason;
		}
	}
	return "stop";
}
