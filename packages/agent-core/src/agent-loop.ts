/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */
/**
 * [WHO]: Provides agentLoop(), agentLoopContinue(), standard loop event emission, continuation recovery, recovered-error tombstoning, and serial tool execution.
 * [FROM]: Depends on @pencil-agent/ai streams/messages, ./types contracts, ./errors, and shared loop helpers.
 * [TO]: Consumed by agent.ts and package exports as the default agent execution loop.
 * [HERE]: packages/agent-core/src/agent-loop.ts within agent-core; standard counterpart to structured-adaptive-agent-loop.ts.
 */


import {
	type AssistantMessage,
	type Context,
	EventStream,
	isContextOverflow,
	streamSimple,
	type TextContent,
	type ToolResultMessage,
	type Usage,
	validateToolArguments,
} from "@pencil-agent/ai";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopTransition,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolPermissionDenial,
	AgentToolResult,
	StreamFn,
} from "./types.js";
import { ToolNotFoundError, ToolExecutionError, ValidationError } from "./errors.js";
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
const DEFAULT_MAX_STOP_HOOK_CONTINUATIONS = 3;
const DEFAULT_MAX_MODEL_ERROR_RECOVERY_ATTEMPTS = 1;
const DEFAULT_MAX_OUTPUT_TOKEN_RECOVERY_ATTEMPTS = 1;

type StandardLoopFinishOptions = {
	config: AgentLoopConfig;
	turnCount: number;
	toolCallCount: number;
	startedAt: number;
	usage: Usage;
	permissionDenials: AgentToolPermissionDenial[];
	stopReason?: string;
	transitions?: AgentLoopTransition[];
	lastTransition?: AgentLoopTransition;
	errorMessage?: string;
	errorSubtype?: string;
};

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
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

			await runLoop(currentContext, newMessages, config, signal, stream, streamFn);
		} catch (error: unknown) {
			endWithLoopError(stream, newMessages, config, error, signal);
		}
	})();

	return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(
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

			await runLoop(currentContext, newMessages, config, signal, stream, streamFn);
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
	finishStandardLoop(stream, newMessages, {
		config,
		turnCount: 0,
		toolCallCount: 0,
		startedAt: Date.now(),
		usage: emptyUsage(),
		permissionDenials: [],
		stopReason: errorMessage.stopReason,
		errorMessage: errorMessage.errorMessage,
		errorSubtype: signal?.aborted ? "aborted" : "loop_error",
	});
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
	currentContext: AgentContext,
	newMessages: AgentMessage[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
): Promise<void> {
	let firstTurn = true;
	let turnCount = 0;
	let toolCallCount = 0;
	const startedAt = Date.now();
	const usage = emptyUsage();
	const permissionDenials: AgentToolPermissionDenial[] = [];
	const maxTurns = config.maxTurnsPerPrompt ?? DEFAULT_MAX_TURNS_PER_PROMPT;
	const maxToolCalls = config.maxToolCallsPerPrompt ?? DEFAULT_MAX_TOOL_CALLS_PER_PROMPT;
	const maxStopHookContinuations = config.maxStopHookContinuations ?? DEFAULT_MAX_STOP_HOOK_CONTINUATIONS;
	const maxModelErrorRecoveryAttempts =
		config.maxModelErrorRecoveryAttempts ?? DEFAULT_MAX_MODEL_ERROR_RECOVERY_ATTEMPTS;
	const maxOutputTokenRecoveryAttempts =
		config.maxOutputTokenRecoveryAttempts ?? DEFAULT_MAX_OUTPUT_TOKEN_RECOVERY_ATTEMPTS;
	let modelErrorRecoveryCount = 0;
	let maxOutputTokensRecoveryCount = 0;
	let tokenBudgetContinuationCount = 0;
	let maxOutputTokensOverride: number | undefined;
	let lastTransition: AgentLoopTransition = { reason: "start" };
	const transitions: AgentLoopTransition[] = [];
	const recordTransition = (transition: AgentLoopTransition): AgentLoopTransition => {
		lastTransition = transition;
		transitions.push(transition);
		return transition;
	};
	let pendingToolUseSummaries: PendingToolUseSummary[] = [];
	let stopHookActive = false;
	let stopHookContinuationCount = 0;
	// Check for steering messages at start (user may have typed while waiting)
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

	// Outer loop: continues when queued follow-up messages arrive after agent would stop
	while (true) {
		let hasMoreToolCalls = true;
		let steeringAfterTools: AgentMessage[] | null = null;

		// Inner loop: process tool calls and steering messages
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			if (!firstTurn) {
				stream.push({ type: "turn_start" });
			} else {
				firstTurn = false;
			}

			pendingToolUseSummaries = flushReadyToolUseSummaries(
				pendingToolUseSummaries,
				currentContext.messages,
				newMessages,
				stream,
			);

			// Process pending messages (inject before next assistant response)
			if (pendingMessages.length > 0) {
				for (const message of pendingMessages) {
					stream.push({ type: "message_start", message });
					stream.push({ type: "message_end", message });
					currentContext.messages.push(message);
					newMessages.push(message);
				}
				pendingMessages = [];
			}

			turnCount++;
			if (turnCount > maxTurns) {
				const limitMessage = createLoopLimitMessage(
					config,
					`Stopped after ${maxTurns} assistant turns to prevent a runaway agent loop.`,
				);
				currentContext.messages.push(limitMessage);
				newMessages.push(limitMessage);
				stream.push({ type: "message_start", message: { ...limitMessage } });
				stream.push({ type: "message_end", message: limitMessage });
				stream.push({ type: "turn_end", message: limitMessage, toolResults: [] });
				finishStandardLoop(stream, newMessages, {
					config,
					turnCount,
					toolCallCount,
					startedAt,
					usage,
					permissionDenials,
					stopReason: limitMessage.stopReason,
					transitions,
					lastTransition: recordTransition({
						reason: "max_turns_reached",
						maxTurns,
						turnCount,
					}),
					errorMessage: limitMessage.errorMessage,
					errorSubtype: "max_turns_reached",
				});
				return;
			}

			// Stream assistant response
			const responseStartMessageCount = newMessages.length;
			const message = await streamAssistantResponse(
				currentContext,
				config,
				signal,
				stream,
				streamFn,
				maxOutputTokensOverride,
			);
			addUsage(usage, message.usage);
			maxOutputTokensOverride = undefined;
			newMessages.push(message);

			if (message.stopReason === "error" || message.stopReason === "aborted") {
				const errorSubtype =
					message.stopReason === "aborted"
						? "aborted"
						: isContextOverflow(message, config.model.contextWindow)
							? "context_overflow"
							: "model_error";
				const interruptedToolResults = createInterruptedToolResults(message);
				for (const result of interruptedToolResults) {
					currentContext.messages.push(result);
					newMessages.push(result);
					stream.push({ type: "message_start", message: result });
					stream.push({ type: "message_end", message: result });
				}

				if (
					message.stopReason === "error" &&
					config.recoverModelError &&
					modelErrorRecoveryCount < maxModelErrorRecoveryAttempts
				) {
					const attempt = modelErrorRecoveryCount + 1;
					const recovery = await config.recoverModelError({
						message,
						messages: currentContext.messages,
						errorSubtype,
						attempt,
					});
					if (recovery.action === "retry") {
						stream.push({ type: "turn_end", message, toolResults: interruptedToolResults });
						modelErrorRecoveryCount = attempt;
						newMessages.splice(responseStartMessageCount);
						currentContext.messages = recovery.messages;
						recordTransition(
							recovery.transition ?? {
								reason: "model_error_recovery",
								subtype: errorSubtype,
								attempt,
							},
						);
						continue;
					}
				}

				stream.push({ type: "turn_end", message, toolResults: interruptedToolResults });
				finishStandardLoop(stream, newMessages, {
					config,
					turnCount,
					toolCallCount,
					startedAt,
					usage,
					permissionDenials,
					stopReason: message.stopReason,
					transitions,
					lastTransition,
					errorMessage: message.errorMessage,
					errorSubtype,
				});
				return;
			}

			// Check for tool calls
			const toolCalls = message.content.filter((c) => c.type === "toolCall");
			hasMoreToolCalls = toolCalls.length > 0;

			const toolResults: ToolResultMessage[] = [];
			if (hasMoreToolCalls) {
				if (toolCallCount + toolCalls.length > maxToolCalls) {
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
						`Stopped before executing ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"} because this prompt reached the ${maxToolCalls} tool-call limit.`,
					);
					currentContext.messages.push(limitMessage);
					newMessages.push(limitMessage);
					stream.push({ type: "message_start", message: { ...limitMessage } });
					stream.push({ type: "message_end", message: limitMessage });
					stream.push({ type: "turn_end", message: limitMessage, toolResults: skippedToolResults });
					finishStandardLoop(stream, newMessages, {
						config,
						turnCount,
						toolCallCount,
						startedAt,
						usage,
						permissionDenials,
						stopReason: limitMessage.stopReason,
						transitions,
						lastTransition: recordTransition({
							reason: "tool_call_limit_reached",
							maxToolCalls,
							requestedToolCalls: toolCalls.length,
							toolCallCount,
						}),
						errorMessage: limitMessage.errorMessage,
						errorSubtype: "tool_call_limit_reached",
					});
					return;
				}
				toolCallCount += toolCalls.length;
				const toolExecution = await executeToolCalls(
					currentContext.tools,
					message,
					signal,
					stream,
					config.getSteeringMessages,
					config.canUseTool,
				);
				toolResults.push(
					...enforceToolResultBatchSize(toolExecution.toolResults, config.maxToolResultBatchSizeChars),
				);
				permissionDenials.push(...collectPermissionDenials(toolExecution.toolResults));
				steeringAfterTools = toolExecution.steeringMessages ?? null;

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
					pendingToolUseSummaries.push(pendingSummary);
				}
				recordTransition({ reason: "tool_result", toolCallCount: toolCalls.length });
			}

			stream.push({ type: "turn_end", message, toolResults });

			if (
				!hasMoreToolCalls &&
				message.stopReason === "length" &&
				maxOutputTokensRecoveryCount < maxOutputTokenRecoveryAttempts
			) {
				maxOutputTokensRecoveryCount += 1;
				maxOutputTokensOverride = computeRecoveryMaxTokens(config, message);
				pendingMessages = [createOutputTokenRecoveryMessage(maxOutputTokensRecoveryCount)];
				recordTransition({
					reason: "max_output_tokens_recovery",
					attempt: maxOutputTokensRecoveryCount,
				});
				continue;
			}

			if (!hasMoreToolCalls && config.runStopHooks && !stopHookActive) {
				stopHookActive = true;
				const stopHookResult = await config.runStopHooks({
					message,
					messages: currentContext.messages,
				});
				stopHookActive = false;
				if (stopHookResult.action === "continue" && stopHookResult.messages.length > 0) {
					if (stopHookContinuationCount >= maxStopHookContinuations) {
						const limitMessage = createLoopLimitMessage(
							config,
							`stop_hook_limit_reached: stopped after ${maxStopHookContinuations} stop-hook continuation turns.`,
						);
						currentContext.messages.push(limitMessage);
						newMessages.push(limitMessage);
						stream.push({ type: "message_start", message: { ...limitMessage } });
						stream.push({ type: "message_end", message: limitMessage });
						stream.push({ type: "turn_end", message: limitMessage, toolResults: [] });
						finishStandardLoop(stream, newMessages, {
							config,
							turnCount,
							toolCallCount,
							startedAt,
							usage,
							permissionDenials,
							stopReason: limitMessage.stopReason,
							transitions,
							lastTransition: recordTransition({
								reason: "stop_hook_limit_reached",
								maxContinuations: maxStopHookContinuations,
								continuationCount: stopHookContinuationCount,
							}),
							errorMessage: limitMessage.errorMessage,
							errorSubtype: "stop_hook_limit_reached",
						});
						return;
					}
					stopHookContinuationCount += 1;
					pendingMessages = stopHookResult.messages;
					recordTransition({
						reason: "stop_hook_blocking",
						continuationCount: stopHookContinuationCount,
					});
					continue;
				}
			}

			if (!hasMoreToolCalls) {
				const tokenBudgetContinuation = createTokenBudgetContinuation(
					config,
					usage.output,
					tokenBudgetContinuationCount,
				);
				if (tokenBudgetContinuation) {
					tokenBudgetContinuationCount += 1;
					pendingMessages = [tokenBudgetContinuation.message];
					recordTransition({
						reason: "token_budget_continuation",
						continuationCount: tokenBudgetContinuationCount,
						outputTokens: tokenBudgetContinuation.outputTokens,
						targetTokens: tokenBudgetContinuation.targetTokens,
					});
					continue;
				}
			}

			// Get steering messages after turn completes
			if (steeringAfterTools && steeringAfterTools.length > 0) {
				pendingMessages = steeringAfterTools;
				steeringAfterTools = null;
			} else {
				pendingMessages = (await config.getSteeringMessages?.()) || [];
			}
		}

		// Agent would stop here. Check for follow-up messages.
		const followUpMessages = (await config.getFollowUpMessages?.()) || [];
		if (followUpMessages.length > 0) {
			// Set as pending so inner loop processes them
			pendingMessages = followUpMessages;
			recordTransition({ reason: "follow_up" });
			continue;
		}

		// No more messages, exit
		break;
	}

	finishStandardLoop(stream, newMessages, {
		config,
		turnCount,
		toolCallCount,
		startedAt,
		usage,
		permissionDenials,
		stopReason: inferStopReason(newMessages),
		transitions,
		lastTransition,
	});
}

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
	maxTokensOverride?: number,
): Promise<AssistantMessage> {
	// Apply context transform if configured (AgentMessage[] → AgentMessage[])
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	// Convert to LLM-compatible messages (AgentMessage[] → Message[])
	const llmMessages = await config.convertToLlm(messages);

	// Build LLM context
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: llmMessages,
		tools: context.tools,
	};

	const streamFunction = streamFn || streamSimple;

	// Resolve API key (important for expiring tokens)
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
			case "toolcall_end":
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

	const finalMessage = await response.result();
	if (addedPartial) {
		context.messages[context.messages.length - 1] = finalMessage;
	} else {
		context.messages.push(finalMessage);
		stream.push({ type: "message_start", message: { ...finalMessage } });
	}
	stream.push({ type: "message_end", message: finalMessage });
	return finalMessage;
}

function finishStandardLoop(
	stream: EventStream<AgentEvent, AgentMessage[]>,
	newMessages: AgentMessage[],
	options: StandardLoopFinishOptions,
): void {
	stream.push({
		type: "agent_result",
		stopReason: options.stopReason ?? inferStopReason(newMessages),
		loopFramework: resolveAgentRunLoopFramework(options.config),
		loopPolicy: buildAgentRunPolicy(options.config),
		turnCount: options.turnCount,
		toolCallCount: options.toolCallCount,
		durationMs: Date.now() - options.startedAt,
		usage: options.usage,
		permissionDenialCount: options.permissionDenials.length,
		permissionDenials: options.permissionDenials,
		transitions: options.transitions && options.transitions.length > 0 ? options.transitions : undefined,
		lastTransition: options.lastTransition,
		errorMessage: options.errorMessage,
		errorSubtype: options.errorSubtype,
	});
	stream.push({ type: "agent_end", messages: newMessages });
	stream.end(newMessages);
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
			return message.stopReason ?? "stop";
		}
	}
	return "stop";
}

function collectPermissionDenials(toolResults: ToolResultMessage[]): AgentToolPermissionDenial[] {
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

/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(
	tools: AgentTool<any>[] | undefined,
	assistantMessage: AssistantMessage,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	getSteeringMessages?: AgentLoopConfig["getSteeringMessages"],
	canUseTool?: AgentLoopConfig["canUseTool"],
): Promise<{ toolResults: ToolResultMessage[]; contextMessages: AgentMessage[]; steeringMessages?: AgentMessage[] }> {
	const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
	const toolByName = buildToolMap(tools);
	const results: ToolResultMessage[] = [];
	const contextMessages: AgentMessage[] = [];
	let steeringMessages: AgentMessage[] | undefined;

	for (let index = 0; index < toolCalls.length; index++) {
		const toolCall = toolCalls[index];
		const tool = toolByName.get(toolCall.name);
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
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
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

		const toolResultMessage: ToolResultMessage = {
			role: "toolResult",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			content: result.content,
			details: result.details,
			isError,
			timestamp: Date.now(),
		};

		results.push(toolResultMessage);
		contextMessages.push(...(result.contextMessages ?? []));

		// Check for steering messages - skip remaining tools if user interrupted
		if (getSteeringMessages) {
			const steering = await getSteeringMessages();
			if (steering.length > 0) {
				steeringMessages = steering;
				const remainingCalls = toolCalls.slice(index + 1);
				for (const skipped of remainingCalls) {
					results.push(skipToolCall(skipped, stream));
				}
				break;
			}
		}
	}

	return { toolResults: results, contextMessages, steeringMessages };
}

function buildToolMap(tools: AgentTool<any>[] | undefined): Map<string, AgentTool<any>> {
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

function isPermissionDeniedMessage(message: string): boolean {
	return /^Permission (denied|request was cancelled)/i.test(message.trim());
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

function skipToolCall(
	toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }>,
	stream: EventStream<AgentEvent, AgentMessage[]>,
): ToolResultMessage {
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
	});

	const toolResultMessage: ToolResultMessage = {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: result.content,
		details: {},
		isError: true,
		timestamp: Date.now(),
	};

	return toolResultMessage;
}
