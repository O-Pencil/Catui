/**
 * [WHO]: PrintModeOptions, PrintModeResult, formatPrintLoopResult(), transcript NDJSON emitters, collectPrintAssistantText(), runPrintMode(), latest trace path reporting
 * [FROM]: Depends on ai, agent-core, core/runtime/agent-session
 * [TO]: Consumed by modes/index.ts, main.ts, print mode tests
 * [HERE]: modes/print-mode.ts - non-interactive batch processing mode
 */
import type { AgentRunResult } from "@catui/agent-core";
import type { AssistantMessage, ImageContent, Message, UserMessage } from "@catui/ai/types";
import type { AgentSession, AgentSessionEvent } from "../core/runtime/agent-session.js";

/**
 * Options for print mode.
 */
export interface PrintModeOptions {
	/** Output mode: "text" for final response only, "json" for all events */
	mode: "text" | "json";
	/** Array of additional prompts to send after initialMessage */
	messages?: string[];
	/** First message to send (may contain @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
	/** In text mode, emit the final agent loop result as one JSON line on stderr */
	printLoopResult?: boolean;
	/** In text mode, emit tool-call transcript events as stderr NDJSON */
	printTranscript?: boolean;
	/** Exit non-zero when the final agent loop result is an error. */
	failOnAgentError?: boolean;
	/** Exit non-zero when the final agent loop result includes tool permission denials. */
	failOnToolDenial?: boolean;
}

export interface PrintModeResult {
	exitCode: number;
}

export function formatPrintLoopResult(result: AgentRunResult | undefined, tracePath?: string): string | undefined {
	if (!result) return undefined;
	return JSON.stringify({ type: "agent_result", ...result, ...(tracePath ? { tracePath } : {}) });
}

function isAutomaticContinuationMessage(message: Message | undefined): message is UserMessage {
	if (!message || message.role !== "user") return false;
	const content = message.content;
	const text =
		typeof content === "string"
			? content
			: content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n");
	return (
		text.includes("automatic output-token recovery attempt") ||
		text.includes("output token budget is underused")
	);
}

function assistantTextBlocks(message: AssistantMessage): string[] {
	return message.content
		.filter((content): content is Extract<(typeof message.content)[number], { type: "text" }> => content.type === "text")
		.map((content) => content.text);
}

function hasAutomaticContinuationTransition(result: AgentRunResult | undefined): boolean {
	return (
		result?.transitions?.some(
			(transition) =>
				transition.reason === "max_output_tokens_recovery" ||
				transition.reason === "token_budget_continuation",
		) ?? false
	);
}

export function collectPrintAssistantText(messages: Message[], result?: AgentRunResult): string[] {
	const lastMessage = messages[messages.length - 1];
	if (!lastMessage || lastMessage.role !== "assistant") return [];
	const assistantMessages: AssistantMessage[] = [lastMessage as AssistantMessage];

	if (!hasAutomaticContinuationTransition(result)) {
		return assistantTextBlocks(lastMessage as AssistantMessage);
	}

	let index = messages.length - 2;
	while (index >= 1 && isAutomaticContinuationMessage(messages[index])) {
		const previous = messages[index - 1];
		if (!previous || previous.role !== "assistant") break;
		assistantMessages.unshift(previous as AssistantMessage);
		index -= 2;
	}

	return assistantMessages.flatMap(assistantTextBlocks);
}

function emitPrintLoopResult(result: AgentRunResult | undefined, tracePath?: string): void {
	const loopResult = formatPrintLoopResult(result, tracePath);
	if (loopResult) console.error(loopResult);
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: string; text: string } =>
			typeof part === "object" &&
			part !== null &&
			"type" in part &&
			"text" in part &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string"
		)
		.map((part) => part.text)
		.join("\n");
}

function emitTranscriptEvent(event: Record<string, unknown>): void {
	console.error(JSON.stringify(event));
}

function emitTranscriptFromSessionEvent(event: AgentSessionEvent | unknown): void {
	if (!event || typeof event !== "object" || !("type" in event)) return;
	const typed = event as { type: string; [key: string]: unknown };
	if (typed.type === "message_end" || typed.type === "message_delta") {
		const message = typed.message;
		if (!message || typeof message !== "object" || !("role" in message) || (message as { role?: unknown }).role !== "assistant") return;
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) return;
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const block = part as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
			if (block.type !== "toolCall" || typeof block.id !== "string" || typeof block.name !== "string") continue;
			emitTranscriptEvent({
				type: "tool_use",
				id: block.id,
				name: block.name,
				input: block.arguments ?? {},
			});
		}
		return;
	}
	if (typed.type === "tool_execution_end" || typed.type === "tool_result") {
		const result = typed.result as { content?: unknown } | undefined;
		emitTranscriptEvent({
			type: "tool_result",
			toolUseId: typed.toolCallId,
			name: typed.toolName ?? typed.name,
			output: textFromContent(result?.content ?? typed.content),
			isError: typed.isError === true ? true : undefined,
		});
	}
}

function emitAssistantTranscriptText(messages: Message[], result: AgentRunResult | undefined): void {
	for (const text of collectPrintAssistantText(messages, result)) {
		emitTranscriptEvent({ type: "assistant_text", text });
	}
}

function emitTranscriptResult(result: AgentRunResult | undefined, tracePath?: string): void {
	if (!result) return;
	emitTranscriptEvent({
		type: "result",
		success: result.stopReason !== "error" && result.stopReason !== "aborted" && !result.errorSubtype,
		stopReason: result.stopReason,
		turnCount: result.turnCount,
		toolCallCount: result.toolCallCount,
		durationMs: result.durationMs,
		...(tracePath ? { tracePath } : {}),
	});
}

function shouldFailForLoopResult(result: AgentRunResult | undefined, options: PrintModeOptions): boolean {
	if (!result) return false;
	if (options.failOnAgentError && (result.stopReason === "error" || result.stopReason === "aborted" || result.errorSubtype)) {
		return true;
	}
	if (options.failOnToolDenial && (result.permissionDenialCount ?? 0) > 0) {
		return true;
	}
	return false;
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
export async function runPrintMode(session: AgentSession, options: PrintModeOptions): Promise<PrintModeResult> {
	const { mode, messages = [], initialMessage, initialImages } = options;
	let exitCode = 0;
	if (mode === "json") {
		const header = session.sessionManager.getHeader();
		if (header) {
			console.log(JSON.stringify(header));
		}
	}
	// Set up extensions for print mode (no UI)
	await session.bindExtensions({
		commandContextActions: {
			waitForIdle: () => session.agent.waitForIdle(),
			newSession: async (options) => {
				const success = await session.newSession({ parentSession: options?.parentSession });
				if (success && options?.setup) {
					await options.setup(session.sessionManager);
				}
				return { cancelled: !success };
			},
			fork: async (entryId) => {
				const result = await session.fork(entryId);
				return { cancelled: result.cancelled };
			},
			navigateTree: async (targetId, options) => {
				const result = await session.navigateTree(targetId, {
					summarize: options?.summarize,
					customInstructions: options?.customInstructions,
					replaceInstructions: options?.replaceInstructions,
					label: options?.label,
				});
				return { cancelled: result.cancelled };
			},
			switchSession: async (sessionPath) => {
				const success = await session.switchSession(sessionPath);
				return { cancelled: !success };
			},
			reload: async () => {
				await session.reload();
			},
		},
		onError: (err) => {
			console.error(`Extension error (${err.extensionPath}): ${err.error}`);
		},
	});

	// Always subscribe to enable session persistence via _handleAgentEvent
	session.subscribe((event) => {
		if (mode === "text" && options.printTranscript) {
			emitTranscriptFromSessionEvent(event);
		}
		// In JSON mode, output all events
		if (mode === "json") {
			console.log(JSON.stringify(event));
		}
	});

	// Send initial message with attachments
	if (initialMessage) {
		await session.prompt(initialMessage, { images: initialImages });
	}

	// Send remaining messages
	for (const message of messages) {
		await session.prompt(message);
	}

	// Mirror other modes so extensions can flush per-session finalizers
	// (for example SAL eval run_end and pending batched uploads).
	const extensionRunner = session.extensionRunner;
	if (extensionRunner?.hasHandlers("session_shutdown")) {
		await extensionRunner.emit({ type: "session_shutdown" });
	}

	// In text mode, output final response
	if (mode === "text") {
		const state = session.state;
		const lastMessage = state.messages[state.messages.length - 1];

		if (lastMessage?.role === "assistant") {
			const assistantMsg = lastMessage as AssistantMessage;
			const tracePath = session.getLastRunTracePath?.();

			// Check for error/aborted
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
				console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
				if (options.printLoopResult) {
					emitPrintLoopResult(state.lastResult, tracePath);
				}
				if (options.printTranscript) emitTranscriptResult(state.lastResult, tracePath);
				exitCode = 1;
			} else {
				// Output text content
				for (const text of collectPrintAssistantText(state.messages as Message[], state.lastResult)) {
					console.log(text);
				}
				if (options.printTranscript) {
					emitAssistantTranscriptText(state.messages as Message[], state.lastResult);
				}

				if (options.printLoopResult) {
					emitPrintLoopResult(state.lastResult, tracePath);
				}
				if (options.printTranscript) emitTranscriptResult(state.lastResult, tracePath);
			}
		}
	}

	if (shouldFailForLoopResult(session.state.lastResult, options)) {
		exitCode = 1;
	}

	// Ensure stdout is fully flushed before returning
	// This prevents race conditions where the process exits before all output is written
	await new Promise<void>((resolve, reject) => {
		process.stdout.write("", (err) => {
			if (err) reject(err);
			else resolve();
		});
	});

	return { exitCode };
}
