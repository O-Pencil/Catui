/**
 * [WHO]: Provides bindExtensionCore() — wires AgentSession host methods to ExtensionRunner APIs, including LLM call telemetry (every ctx.completeSimple / completeSimpleWithUsage / completeJson emits one ext_llm_calls row)
 * [FROM]: Depends on ExtensionRunner, model/session/resource abstractions, slash command metadata, core/platform/telemetry (getExtCallerContext for caller attribution + LlmCallEventInput shape)
 * [TO]: Consumed by AgentSession when initializing extension runtime capabilities
 * [HERE]: core/runtime/extension-core-bindings.ts - the LLM-call instrumentation point; reads AsyncLocalStorage context pushed by runner.invokeCommand (user-initiated=true) or runner.invokeHookHandler (user-initiated=false) to attribute each call. is_user_initiated=false rows grouped by extension_name + caller_context are the idle-thinking bug detector.
 */
import type {
	ImageContent,
	Model,
	SimpleStreamOptions,
	TextContent,
	ToolCall,
	Usage,
} from "@pencil-agent/ai/types";
import type { TSchema } from "@pencil-agent/ai/schema";
import { completeSimple } from "@pencil-agent/ai";
import type { ThinkingLevel } from "@pencil-agent/agent-core";
import type { SettingsManager } from "../platform/config/settings-manager.js";
import type { ResourceLoader } from "../platform/config/resource-loader.js";
import type {
	ExtensionActions,
	ExtensionContextActions,
	ExtensionRunner,
	ToolInfo,
} from "../extensions-host/index.js";
import type { ModelRegistry } from "../model-registry.js";
import type { PromptTemplate } from "../prompt/prompt-templates.js";
import type { SessionManager } from "../session/session-manager.js";
import type { ContextUsage } from "../extensions-host/types.js";
import type { CompactionResult } from "../session/compaction/index.js";
import { getExtCallerContext, type LlmCallEventInput } from "../platform/telemetry/index.js";
import { buildExtensionSlashCommands } from "./slash-command-catalog.js";

function getStructuredToolChoice(model: Model<any>, toolName: string): unknown {
	switch (model.api) {
		case "openai-completions":
			return { type: "function", function: { name: toolName } };
		case "anthropic-messages":
		case "bedrock-converse-stream":
			return { type: "tool", name: toolName };
		case "google-generative-ai":
		case "google-gemini-cli":
		case "google-vertex":
			return "any";
		default:
			return "required";
	}
}

type SendMessage = ExtensionActions["sendMessage"];
type SendUserMessage = ExtensionActions["sendUserMessage"];

function isTextContent(block: { type: string }): block is TextContent {
	return block.type === "text";
}

function isNamedToolCall(block: { type: string }, toolName: string): block is ToolCall {
	return block.type === "toolCall" && "name" in block && block.name === toolName;
}

export interface ExtensionCoreBindingHost {
	promptTemplates: ReadonlyArray<PromptTemplate>;
	resourceLoader: ResourceLoader;
	modelRegistry: ModelRegistry;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	shutdownHandler?: () => void;
	soulManager?: unknown;

	get model(): Model<any> | undefined;
	get thinkingLevel(): ThinkingLevel;
	get isStreaming(): boolean;
	get pendingMessageCount(): number;
	get systemPrompt(): string;

	sendCustomMessage: (
		message: Parameters<SendMessage>[0],
		options?: Parameters<SendMessage>[1],
	) => Promise<void>;
	sendUserMessage: (
		content: Parameters<SendUserMessage>[0],
		options?: Parameters<SendUserMessage>[1],
	) => Promise<void>;
	executeSlashCommand(text: string): Promise<boolean>;
	getActiveToolNames(): string[];
	getAllTools(): ToolInfo[];
	setActiveToolsByName(toolNames: string[]): void;
	setModel(model: Model<any>): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
	abort(): Promise<void> | void;
	getContextUsage(): ContextUsage | undefined;
	compact(customInstructions?: string): Promise<CompactionResult>;
}

/**
 * Build the LlmCallEventInput row for one extension-initiated LLM call. Reads
 * the AsyncLocalStorage caller context pushed by ExtensionRunner — that's how
 * we know which extension and whether the path was user-initiated. Falls back
 * to `extension_name="unknown"` + `is_user_initiated=false` when no context is
 * set (defensive: that combination shows up in dashboards as "unattributed",
 * a useful signal in itself).
 */
function buildLlmCallEvent(args: {
	host: ExtensionCoreBindingHost;
	model: Model<any> | undefined;
	startedAt: Date;
	startPerf: number;
	ok: boolean;
	errorCode: string | null;
	usage: Usage | undefined;
}): LlmCallEventInput {
	const callerCtx = getExtCallerContext();
	return {
		extensionName: callerCtx?.extensionName ?? "unknown",
		callerContext: callerCtx?.callerContext ?? "unknown",
		isUserInitiated: callerCtx?.isUserInitiated ?? false,
		modelId: args.model?.id ?? null,
		tokensIn: args.usage?.input ?? null,
		tokensOut: args.usage?.output ?? null,
		costTotal: args.usage?.cost?.total ?? null,
		durationMs: Math.round(performance.now() - args.startPerf),
		ok: args.ok,
		errorCode: args.errorCode,
		startedAt: args.startedAt,
		endedAt: new Date(),
		sessionId: callerCtx?.sessionId ?? args.host.sessionManager.getSessionId(),
		runId: callerCtx?.runId ?? null,
		variant: callerCtx?.variant ?? null,
	};
}

async function completeTextWithCurrentModel(
	runner: ExtensionRunner,
	host: ExtensionCoreBindingHost,
	systemPrompt: string,
	userMessage: string,
): Promise<string | undefined> {
	const result = await completeTextWithUsage(runner, host, systemPrompt, userMessage);
	return result?.text;
}

async function completeTextWithUsage(
	runner: ExtensionRunner,
	host: ExtensionCoreBindingHost,
	systemPrompt: string,
	userMessage: string,
): Promise<{ text: string; usage: Usage } | undefined> {
	const model = host.model;
	if (!model) return undefined;
	const apiKey = await host.modelRegistry.getApiKey(model);
	if (!apiKey) return undefined;

	const startedAt = new Date();
	const startPerf = performance.now();
	let ok = true;
	let errorCode: string | null = null;
	let usage: Usage | undefined;
	let text: string | undefined;
	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt,
				messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
			},
			{ maxTokens: 1500, temperature: 0.2, apiKey },
		);
		usage = response.usage;
		text =
			response.content
				?.filter(isTextContent)
				.map((block) => block.text ?? "")
				.join("") ?? "";
	} catch (err) {
		ok = false;
		errorCode = err instanceof Error ? err.constructor.name : "unknown";
	}
	runner.writeLlmCallEvent(buildLlmCallEvent({ host, model, startedAt, startPerf, ok, errorCode, usage }));
	if (!ok || text === undefined || usage === undefined) return undefined;
	return { text, usage };
}

async function completeJsonWithCurrentModel(
	runner: ExtensionRunner,
	host: ExtensionCoreBindingHost,
	systemPrompt: string,
	userMessage: string,
	schema: Record<string, unknown>,
	options?: { toolName?: string; resultKey?: string },
): Promise<string | undefined> {
	const model = host.model;
	if (!model) return undefined;
	const apiKey = await host.modelRegistry.getApiKey(model);
	if (!apiKey) return undefined;

	const toolName = options?.toolName || "submit_json";
	const startedAt = new Date();
	const startPerf = performance.now();
	let ok = true;
	let errorCode: string | null = null;
	let usage: Usage | undefined;
	let payloadString: string | undefined;
	try {
		const toolSchema = schema as unknown as TSchema;
		const completionOptions = {
			maxTokens: 1500,
			temperature: 0,
			apiKey,
			toolChoice: getStructuredToolChoice(model, toolName),
		} satisfies SimpleStreamOptions;

		const response = await completeSimple(
			model,
			{
				systemPrompt: `${systemPrompt}\n\nYou must call the ${toolName} tool exactly once with the final structured JSON payload. Do not answer in prose.`,
				messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
				tools: [
					{
						name: toolName,
						description: "Submit the final structured JSON payload.",
						parameters: toolSchema,
					},
				],
			},
			completionOptions,
		);
		usage = response.usage;
		const toolCall = response.content?.find((block) => isNamedToolCall(block, toolName));
		if (toolCall) {
			const payload = options?.resultKey ? toolCall.arguments?.[options.resultKey] : toolCall.arguments;
			payloadString = JSON.stringify(payload);
		}
	} catch (err) {
		ok = false;
		errorCode = err instanceof Error ? err.constructor.name : "unknown";
	}
	runner.writeLlmCallEvent(buildLlmCallEvent({ host, model, startedAt, startPerf, ok, errorCode, usage }));
	if (!ok) return undefined;
	return payloadString;
}

export function bindExtensionCore(runner: ExtensionRunner, host: ExtensionCoreBindingHost): void {
	runner.bindCore(
		{
			sendMessage: (message, options) => {
				host.sendCustomMessage(message, options).catch((err) => {
					runner.emitError({
						extensionPath: "<runtime>",
						event: "send_message",
						error: err instanceof Error ? err.message : String(err),
					});
				});
			},
			sendUserMessage: (content, options) => {
				host.sendUserMessage(content as string | (TextContent | ImageContent)[], options).catch((err) => {
					runner.emitError({
						extensionPath: "<runtime>",
						event: "send_user_message",
						error: err instanceof Error ? err.message : String(err),
					});
				});
			},
			executeCommand: async (text) => {
				try {
					return await host.executeSlashCommand(text);
				} catch (err) {
					runner.emitError({
						extensionPath: "<runtime>",
						event: "execute_command",
						error: err instanceof Error ? err.message : String(err),
					});
					return false;
				}
			},
			appendEntry: (customType, data) => {
				host.sessionManager.appendCustomEntry(customType, data);
			},
			setSessionName: (name) => {
				host.sessionManager.appendSessionInfo(name);
			},
			getSessionName: () => host.sessionManager.getSessionName(),
			setLabel: (entryId, label) => {
				host.sessionManager.appendLabelChange(entryId, label);
			},
			getActiveTools: () => host.getActiveToolNames(),
			getAllTools: () => host.getAllTools(),
			setActiveTools: (toolNames) => host.setActiveToolsByName(toolNames),
			getCommands: () =>
				buildExtensionSlashCommands({
					promptTemplates: host.promptTemplates,
					resourceLoader: host.resourceLoader,
					extensionRunner: runner,
				}),
			setModel: async (model) => {
				const key = await host.modelRegistry.getApiKey(model);
				if (!key) return false;
				await host.setModel(model);
				return true;
			},
			getThinkingLevel: () => host.thinkingLevel,
			setThinkingLevel: (level) => host.setThinkingLevel(level),
		},
		{
			getModel: () => host.model,
			completeSimple: (systemPrompt, userMessage) =>
				completeTextWithCurrentModel(runner, host, systemPrompt, userMessage),
			completeSimpleWithUsage: (systemPrompt, userMessage) =>
				completeTextWithUsage(runner, host, systemPrompt, userMessage),
			completeJson: (systemPrompt, userMessage, schema, options) =>
				completeJsonWithCurrentModel(runner, host, systemPrompt, userMessage, schema, options),
			getSettings: () => host.settingsManager.getSettings(),
			isIdle: () => !host.isStreaming,
			abort: () => {
				void host.abort();
			},
			hasPendingMessages: () => host.pendingMessageCount > 0,
			shutdown: () => {
				host.shutdownHandler?.();
			},
			getContextUsage: () => host.getContextUsage(),
			compact: (options) => {
				void (async () => {
					try {
						const result = await host.compact(options?.customInstructions);
						options?.onComplete?.(result);
					} catch (error) {
						const err = error instanceof Error ? error : new Error(String(error));
						options?.onError?.(err);
					}
				})();
			},
			getSystemPrompt: () => host.systemPrompt,
			getSoulManager: () => host.soulManager,
			getSkills: () => host.resourceLoader.getSkills().skills,
		} satisfies ExtensionContextActions,
	);
}
