/**
 * [WHO]: Provides bindExtensionCore()
 * [FROM]: Depends on ExtensionRunner, model/session/resource abstractions, slash command metadata
 * [TO]: Consumed by AgentSession when initializing extension runtime capabilities
 * [HERE]: core/runtime/extension-core-bindings.ts - adapts AgentSession host methods to ExtensionRunner APIs
 */
import type { ImageContent, Model, TextContent } from "@pencil-agent/ai";
import { completeSimple, type ToolCall } from "@pencil-agent/ai";
import type { ThinkingLevel } from "@pencil-agent/agent-core";
import type { SettingsManager } from "../config/settings-manager.js";
import type { ResourceLoader } from "../config/resource-loader.js";
import type {
	ExtensionActions,
	ExtensionContextActions,
	ExtensionRunner,
	ToolInfo,
} from "../extensions/index.js";
import type { ModelRegistry } from "../model-registry.js";
import type { PromptTemplate } from "../prompt/prompt-templates.js";
import type { SessionManager } from "../session/session-manager.js";
import {
	BUILTIN_SLASH_COMMANDS,
	type SlashCommandInfo,
	type SlashCommandLocation,
} from "../slash-commands.js";
import type { ContextUsage } from "../extensions/types.js";
import type { CompactionResult } from "../session/compaction/index.js";

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

function normalizeLocation(source: string): SlashCommandLocation | undefined {
	if (source === "user" || source === "project" || source === "path") {
		return source;
	}
	return undefined;
}

function buildCommandList(runner: ExtensionRunner, host: ExtensionCoreBindingHost): SlashCommandInfo[] {
	const reservedBuiltins = new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
	const extensionCommands: SlashCommandInfo[] = runner
		.getRegisteredCommandsWithPaths()
		.filter(({ command }) => !reservedBuiltins.has(command.name))
		.map(({ command, extensionPath }) => ({
			name: command.name,
			description: command.description,
			source: "extension",
			path: extensionPath,
		}));

	const templates: SlashCommandInfo[] = host.promptTemplates.map((template) => ({
		name: template.name,
		description: template.description,
		source: "prompt",
		location: normalizeLocation(template.source),
		path: template.filePath,
	}));

	const skills: SlashCommandInfo[] = host.resourceLoader.getSkills().skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill",
		location: normalizeLocation(skill.source),
		path: skill.filePath,
	}));

	return [...extensionCommands, ...templates, ...skills];
}

async function completeTextWithCurrentModel(
	host: ExtensionCoreBindingHost,
	systemPrompt: string,
	userMessage: string,
): Promise<string | undefined> {
	const model = host.model;
	if (!model) return undefined;
	const apiKey = await host.modelRegistry.getApiKey(model);
	if (!apiKey) return undefined;
	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt,
				messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
			},
			{ maxTokens: 1500, temperature: 0.2, apiKey },
		);
		return response.content
			?.filter((block) => block.type === "text")
			.map((block) => (block as TextContent).text ?? "")
			.join("") ?? "";
	} catch {
		return undefined;
	}
}

async function completeJsonWithCurrentModel(
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
	try {
		const response = await completeSimple(
			model,
			{
				systemPrompt: `${systemPrompt}\n\nYou must call the ${toolName} tool exactly once with the final structured JSON payload. Do not answer in prose.`,
				messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
				tools: [
					{
						name: toolName,
						description: "Submit the final structured JSON payload.",
						parameters: schema as any,
					},
				],
			},
			{
				maxTokens: 1500,
				temperature: 0,
				apiKey,
				toolChoice: getStructuredToolChoice(model, toolName),
			} as any,
		);
		const toolCall = response.content?.find(
			(block) => block.type === "toolCall" && (block as ToolCall).name === toolName,
		) as ToolCall | undefined;
		if (!toolCall) return undefined;
		const payload = options?.resultKey ? toolCall.arguments?.[options.resultKey] : toolCall.arguments;
		return JSON.stringify(payload);
	} catch {
		return undefined;
	}
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
			getCommands: () => buildCommandList(runner, host),
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
				completeTextWithCurrentModel(host, systemPrompt, userMessage),
			completeJson: (systemPrompt, userMessage, schema, options) =>
				completeJsonWithCurrentModel(host, systemPrompt, userMessage, schema, options),
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
		} satisfies ExtensionContextActions,
	);
}
