/**
 * [WHO]: runAcpMode(), AcpMode class
 * [FROM]: Depends on @agentclientprotocol/sdk, agent-core, ai
 * [TO]: Consumed by modes/index.ts
 * [HERE]: modes/acp/acp-mode.ts - ACP protocol integration
 */
import * as acp from "@agentclientprotocol/sdk";
import type { AgentMessage, AgentTool } from "@pencil-agent/agent-core";
import type { Model } from "@pencil-agent/ai";
import type {
	AuthenticateRequest,
	AuthenticateResponse,
	AvailableCommand,
	CancelNotification,
	ContentBlock,
	InitializeRequest,
	InitializeResponse,
	ListSessionsRequest,
	ListSessionsResponse,
	LoadSessionRequest,
	LoadSessionResponse,
	ModelInfo,
	NewSessionRequest,
	NewSessionResponse,
	PermissionOption,
	PromptRequest,
	PromptResponse,
	SessionInfo,
	SessionMode,
	SessionModeState,
	SessionModelState,
	SetSessionModeRequest,
	SetSessionModeResponse,
	SetSessionModelRequest,
	SetSessionModelResponse,
	ToolKind,
	ToolCallContent,
} from "@agentclientprotocol/sdk";
import type { AgentSession, ExtensionBindings } from "../../core/runtime/agent-session.js";
import type { AgentSessionEvent } from "../../core/runtime/agent-session.js";
import type { ExtensionUIContext } from "../../core/extensions/types.js";
import { BUILTIN_SLASH_COMMANDS } from "../../core/slash-commands.js";
import { SessionManager } from "../../core/session/session-manager.js";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { theme } from "../interactive/theme/theme.js";

type AcpModeId = "ask" | "read-only" | "bypass";

interface AcpSessionState {
	sessionId: string;
	sessionFile?: string;
	cwd: string;
	title?: string;
	modeId: AcpModeId;
	abortController: AbortController | null;
	allowAllMutations: boolean;
	rejectAllMutations: boolean;
}

interface AcpModeOptions {
	createSessionForCwd?: (cwd: string) => Promise<AgentSession>;
}

const ACP_MODES: SessionMode[] = [
	{
		id: "ask",
		name: "Ask before write",
		description: "Request permission before mutating files or running commands.",
	},
	{
		id: "read-only",
		name: "Read-only",
		description: "Disable editing tools and command execution.",
	},
	{
		id: "bypass",
		name: "Bypass permissions",
		description: "Allow normal coding actions without permission prompts.",
	},
];

const MUTATING_TOOL_NAMES = new Set(["edit", "write", "bash"]);
const BUILTIN_SLASH_COMMAND_NAME_SET = new Set(
	BUILTIN_SLASH_COMMANDS.map((command) => command.name.toLowerCase()),
);
const ACP_SUPPORTED_BUILTIN_COMMANDS = new Set([
	"compact",
	"agent-loop",
	"model",
	"name",
	"new",
	"reload",
	"resume",
	"session",
	"thinking",
	"usage",
]);
const ACP_COMMAND_INPUT_HINTS = new Map<string, string>([
	["compact", "Optional compaction instructions"],
	["agent-loop", "standard or weak-model-compatible"],
	["model", "provider/model or model id"],
	["name", "New session name"],
	["resume", "Session id or title"],
	["thinking", "Thinking level"],
]);

/**
 * Map nanoPencil tool names to ACP tool kinds.
 */
function mapToolKind(toolName: string): ToolKind {
	switch (toolName) {
		case "read":
			return "read";
		case "edit":
			return "edit";
		case "write":
			return "edit";
		case "bash":
			return "execute";
		case "grep":
			return "search";
		case "find":
			return "search";
		case "ls":
			return "read";
		default:
			return "other";
	}
}

function createMessageId(): string {
	return randomUUID();
}

function textToContent(text: string): ContentBlock {
	return { type: "text", text };
}

function asText(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function toolPayloadToText(value: unknown): string {
	if (
		value &&
		typeof value === "object" &&
		"content" in value &&
		Array.isArray((value as { content?: unknown }).content)
	) {
		const text = (value as { content: Array<{ type?: string; text?: string }> }).content
			.filter((block) => block?.type === "text" && typeof block.text === "string")
			.map((block) => block.text)
			.join("\n");
		if (text.trim()) {
			return text;
		}
	}
	return asText(value);
}

type AcpSlashCommandDescriptor = {
	name: string;
	description?: string | null;
};

function normalizeAcpCommandName(name: string): string {
	return name.trim().replace(/^\/+/, "");
}

function isAdvertisableAcpCommand(name: string): boolean {
	const normalized = normalizeAcpCommandName(name).toLowerCase();
	if (!normalized) return false;
	if (!BUILTIN_SLASH_COMMAND_NAME_SET.has(normalized)) return true;
	return ACP_SUPPORTED_BUILTIN_COMMANDS.has(normalized);
}

function createAvailableCommandInput(
	name: string,
): AvailableCommand["input"] | undefined {
	const normalized = normalizeAcpCommandName(name).toLowerCase();
	const hint = ACP_COMMAND_INPUT_HINTS.get(normalized);
	if (hint) return { hint };
	if (ACP_SUPPORTED_BUILTIN_COMMANDS.has(normalized)) return undefined;
	return { hint: "Enter command arguments" };
}

function buildAcpAvailableCommands(
	commands: ReadonlyArray<AcpSlashCommandDescriptor>,
): AvailableCommand[] {
	const seen = new Set<string>();

	return commands
		.filter((command) => {
			const key = normalizeAcpCommandName(command.name).toLowerCase();
			if (!isAdvertisableAcpCommand(key)) return false;
			if (!key) return false;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.map((command) => ({
			name: normalizeAcpCommandName(command.name),
			description: command.description ?? `Run /${command.name}`,
			input: createAvailableCommandInput(command.name),
		}));
}

function createSlashCommandsUpdate(session: AgentSession): AvailableCommand[] {
	return buildAcpAvailableCommands(session.getSlashCommands());
}

function deferAcpNotification(task: () => Promise<void> | void): void {
	queueMicrotask(() => {
		void Promise.resolve()
			.then(task)
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				process.stderr.write(`[acp_session_bootstrap_error] ${message}\n`);
			});
	});
}

function getMessageText(message: AgentMessage): string {
	if (!("content" in message) || !Array.isArray(message.content)) {
		return "";
	}
	return message.content
		.map((block) => {
			if (typeof block === "string") return block;
			if ("type" in block && block.type === "text") return block.text;
			return "";
		})
		.filter((part) => part.length > 0)
		.join("\n");
}

function isVisibleCustomMessage(message: AgentMessage): boolean {
	return (
		typeof message === "object" &&
		message !== null &&
		"role" in message &&
		(message as { role?: unknown }).role === "custom" &&
		"display" in message &&
		(message as { display?: unknown }).display === true
	);
}

function isMutatingTool(tool: AgentTool<any>): boolean {
	if (MUTATING_TOOL_NAMES.has(tool.name)) return true;
	if (/^mcp_.*(?:use_figma|generate_figma_design)$/i.test(tool.name)) return true;
	return false;
}

function unsupportedAcpUi(feature: string): never {
	throw new Error(
		`${feature} is not available in ACP mode yet. In Zed or other ACP clients, use argument-driven commands when available, or run this command in the terminal nanoPencil UI.`,
	);
}

function formatMoney(value: number): string {
	return value.toFixed(4);
}

/**
 * Create an extension UI context for ACP mode.
 * Returns silent defaults since ACP mode has no interactive UI.
 */
function createAcpExtensionUIContext(): ExtensionUIContext {
	return {
		__nonInteractive: true,
		// ACP has no interactive UI surface; degrade rather than throw so that
		// extensions like `interview` can keep contributing memory/context instead
		// of aborting on the first prompt. Callers that strictly need interaction
		// should detect __nonInteractive and skip themselves.
		select: async (options: any) => {
			const choices = options?.choices ?? options?.options ?? [];
			return choices[0]?.value ?? choices[0] ?? undefined;
		},
		confirm: async (options: any) => options?.default ?? true,
		input: async (options: any) => options?.default ?? "",
		editor: async (options: any) => options?.default ?? "",
		openExternalEditor: async () => false,

		notify(message: string, type?: "info" | "warning" | "error"): void {
			process.stderr.write(`[${type ?? "info"}] ${message}\n`);
		},

		setStatus(): void {},
		setWorkingMessage(): void {},
		setWidget(): void {},
		setFooter(): void {},
		setHeader(): void {},
		setTitle(): void {},
		setEditorComponent(): void {},
		pasteToEditor(): void {},
		setEditorText(): void {},
		getEditorText: () => "",

		async custom(): Promise<never> {
			return unsupportedAcpUi("Custom interactive UI");
		},

		onTerminalInput(): () => void {
			return () => {};
		},

		get theme() {
			return theme;
		},

		getAllThemes() {
			return [];
		},

		getTheme(_name: string) {
			return undefined;
		},

		setTheme(_theme: string | unknown) {
			return { success: false, error: "Theme not supported in ACP mode" };
		},

		getToolsExpanded() {
			return false;
		},

		setToolsExpanded(): void {},
	} as ExtensionUIContext;
}

/**
 * NanoPencilAgent - implements ACP Agent interface
 *
 * Wraps nanoPencil's AgentSession as an ACP Agent,
 * communicating with ACP Clients via stdin/stdout.
 */
class NanoPencilAgent implements acp.Agent {
	private connection: acp.AgentSideConnection;
	private session: AgentSession;
	private sessions = new Map<string, AcpSessionState>();
	private currentSessionId?: string;
	private readonly createSessionForCwd?: (cwd: string) => Promise<AgentSession>;
	private readonly extensionBindings: ExtensionBindings;
	private ready: Promise<void>;

	constructor(
		connection: acp.AgentSideConnection,
		session: AgentSession,
		options: AcpModeOptions = {},
	) {
		this.connection = connection;
		this.session = session;
		this.createSessionForCwd = options.createSessionForCwd;
		this.extensionBindings = {
			uiContext: createAcpExtensionUIContext(),
			commandContextActions: {
				waitForIdle: () => this.session.agent.waitForIdle(),
				newSession: async (options) => {
					const success = await this.session.newSession(options);
					return { cancelled: !success };
				},
				fork: async (entryId) => {
					const result = await this.session.fork(entryId);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await this.session.navigateTree(targetId, options);
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath) => {
					const success = await this.session.switchSession(sessionPath);
					return { cancelled: !success };
				},
				reload: async () => {
					await this.session.reload();
				},
			},
			shutdownHandler: () => {
				void (async () => {
					await this.session.extensionRunner?.emit({ type: "session_shutdown" });
					process.exit(0);
				})();
			},
			onError: (err) => {
				process.stderr.write(`[extension_error] ${err.extensionPath}: ${err.error}\n`);
			},
		};
		this.ready = this.bindSession(this.session);
	}

	async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
		await this.ready;
		return {
			protocolVersion: acp.PROTOCOL_VERSION,
			agentInfo: {
				name: "nanoPencil",
				version: "acp",
			},
			agentCapabilities: {
				loadSession: true,
				sessionCapabilities: {
					list: {},
				},
			},
		};
	}

	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		await this.ready;
		await this.ensureWorkspaceSession(params.cwd);
		await this.session.newSession();

		const sessionId = this.session.sessionManager.getSessionId();
		const state = this.createStateFromCurrentSession(sessionId, params.cwd);
		this.sessions.set(sessionId, state);
		this.currentSessionId = sessionId;

		await this.applySessionMode(state);
		this.scheduleSessionBootstrap(sessionId);

		return {
			sessionId,
			models: this.buildModelState(),
			modes: this.buildModeState(state.modeId),
		};
	}

	async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
		await this.ready;
		const info = await this.findSessionInfo(params.sessionId, params.cwd);
		if (!info) {
			throw new Error(`Session ${params.sessionId} not found`);
		}

		await this.ensureWorkspaceSession(info.cwd || params.cwd);
		const switched = await this.session.switchSession(info.path);
		if (!switched) {
			throw new Error(`Failed to load session ${params.sessionId}`);
		}

		const existing = this.sessions.get(params.sessionId);
		const state: AcpSessionState = {
			sessionId: params.sessionId,
			sessionFile: info.path,
			cwd: info.cwd || params.cwd,
			title: info.name || info.firstMessage || existing?.title,
			modeId: existing?.modeId ?? "ask",
			abortController: null,
			allowAllMutations: existing?.allowAllMutations ?? false,
			rejectAllMutations: existing?.rejectAllMutations ?? false,
		};

		this.sessions.set(params.sessionId, state);
		this.currentSessionId = params.sessionId;

		await this.applySessionMode(state);
		this.scheduleSessionBootstrap(params.sessionId, { replayHistory: true });

		return {
			models: this.buildModelState(),
			modes: this.buildModeState(state.modeId),
		};
	}

	async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
		await this.ready;
		const infos = params.cwd
			? await SessionManager.list(params.cwd)
			: await SessionManager.listAll();
		const merged = new Map<string, SessionInfo>();

		for (const info of infos) {
			merged.set(info.id, {
				sessionId: info.id,
				cwd: info.cwd,
				title: info.name || info.firstMessage || undefined,
				updatedAt: info.modified.toISOString(),
			});
		}

		for (const state of this.sessions.values()) {
			if (params.cwd && state.cwd !== params.cwd) continue;
			if (!merged.has(state.sessionId)) {
				merged.set(state.sessionId, {
					sessionId: state.sessionId,
					cwd: state.cwd,
					title: state.title,
					updatedAt: new Date().toISOString(),
				});
			}
		}

		return {
			sessions: Array.from(merged.values()),
		};
	}

	async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse | void> {
		await this.ready;
		return;
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		await this.ready;
		const sessionState = this.requireSession(params.sessionId);
		await this.activateSession(sessionState);

		sessionState.abortController?.abort();
		sessionState.abortController = new AbortController();

		const userText = params.prompt
			.filter((block) => "text" in block && typeof (block as any).text === "string")
			.map((block) => (block as any).text as string)
			.join("\n");

		const builtinHandled = await this.handleBuiltinSlashCommand(
			params.sessionId,
			sessionState,
			userText,
		);
		if (builtinHandled) {
			return { stopReason: "end_turn" };
		}

		const unsubscribe = this.session.subscribe((event) => {
			this.mapEventToAcp(params.sessionId, event);
		});

		try {
			const extensionHandled = await this.session.tryExecuteExtensionCommand(userText);
			if (extensionHandled) {
				await this.emitSessionMetadata(sessionState);
				return { stopReason: "end_turn" };
			}

			// @ts-expect-error - source is for internal use
			await this.session.prompt(userText, { source: "acp" });
			await this.emitSessionMetadata(sessionState);
			return { stopReason: "end_turn" };
		} catch (error) {
			if (sessionState.abortController.signal.aborted) {
				return { stopReason: "cancelled" };
			}
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`[error] ${message}\n`);
			await this.sendAssistantText(params.sessionId, `Command failed: ${message}`);
			return { stopReason: "end_turn" };
		} finally {
			unsubscribe();
			sessionState.abortController = null;
		}
	}

	async cancel(params: CancelNotification): Promise<void> {
		await this.ready;
		const sessionState = this.sessions.get(params.sessionId);
		if (sessionState) {
			await this.activateSession(sessionState);
			sessionState.abortController?.abort();
			await this.session.abort();
		}
	}

	async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void> {
		await this.ready;
		const sessionState = this.requireSession(params.sessionId);
		if (!ACP_MODES.some((mode) => mode.id === params.modeId)) {
			throw new Error(`Unknown ACP mode: ${params.modeId}`);
		}

		sessionState.modeId = params.modeId as AcpModeId;
		sessionState.allowAllMutations = false;
		sessionState.rejectAllMutations = false;

		await this.activateSession(sessionState);
		await this.connection.sessionUpdate({
			sessionId: params.sessionId,
			update: {
				sessionUpdate: "current_mode_update",
				currentModeId: sessionState.modeId,
			},
		});
		return {};
	}

	async unstable_setSessionModel(
		params: SetSessionModelRequest,
	): Promise<SetSessionModelResponse | void> {
		await this.ready;
		const sessionState = this.requireSession(params.sessionId);
		await this.activateSession(sessionState);

		const model = this.parseAcpModelId(params.modelId);
		if (!model) {
			throw new Error(`Unknown model: ${params.modelId}`);
		}

		await this.session.setModel(model);
		await this.emitSessionMetadata(sessionState);
		return {};
	}

	private requireSession(sessionId: string): AcpSessionState {
		const state = this.sessions.get(sessionId);
		if (!state) {
			throw new Error(`Session ${sessionId} not found`);
		}
		return state;
	}

	private createStateFromCurrentSession(sessionId: string, cwd: string): AcpSessionState {
		const sessionFile = this.session.sessionManager.getSessionFile();
		return {
			sessionId,
			sessionFile,
			cwd,
			title: this.getCurrentSessionTitle(),
			modeId: "ask",
			abortController: null,
			allowAllMutations: false,
			rejectAllMutations: false,
		};
	}

	private getCurrentSessionTitle(): string | undefined {
		return (
			this.session.sessionManager.getSessionName() ||
			this.session.agent.state.messages.find((message) => message.role === "user")
				? getMessageText(
						this.session.agent.state.messages.find((message) => message.role === "user") as AgentMessage,
					).slice(0, 80)
				: undefined
		);
	}

	private async findSessionInfo(sessionId: string, cwd: string) {
		const existing = this.sessions.get(sessionId);
		if (existing?.sessionFile) {
			return {
				id: existing.sessionId,
				path: existing.sessionFile,
				cwd: existing.cwd,
				name: existing.title,
				firstMessage: "",
			};
		}

		const cwdSessions = await SessionManager.list(cwd);
		const direct = cwdSessions.find((info) => info.id === sessionId);
		if (direct) return direct;

		const allSessions = await SessionManager.listAll();
		return allSessions.find((info) => info.id === sessionId);
	}

	private async findSessionByQuery(query: string, cwd: string) {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) return undefined;

		const cwdSessions = await SessionManager.list(cwd);
		const allSessions = await SessionManager.listAll();
		const candidates = [...cwdSessions, ...allSessions].filter(
			(info, index, array) => array.findIndex((other) => other.id === info.id) === index,
		);

		return candidates.find((info) => {
			const title = (info.name || info.firstMessage || "").toLowerCase();
			return (
				info.id.toLowerCase() === trimmed ||
				info.id.toLowerCase().startsWith(trimmed) ||
				title.includes(trimmed)
			);
		});
	}

	private buildModeState(currentModeId: AcpModeId): SessionModeState {
		return {
			availableModes: ACP_MODES,
			currentModeId,
		};
	}

	private buildModelState(): SessionModelState {
		const models = this.session.modelRegistry.getAvailable();
		const current = this.session.model;
		const availableModels = models.map(
			(model) =>
				({
					modelId: this.toAcpModelId(model),
					name: model.name || `${model.provider}/${model.id}`,
					description: `${model.provider} / ${model.id}`,
				}) satisfies ModelInfo,
		);

		return {
			availableModels,
			currentModelId: current ? this.toAcpModelId(current) : availableModels[0]?.modelId ?? "unknown/unknown",
		};
	}

	private toAcpModelId(model: Model<any>): string {
		return `${model.provider}/${model.id}`;
	}

	private parseAcpModelId(modelId: string): Model<any> | undefined {
		const slashIndex = modelId.indexOf("/");
		if (slashIndex === -1) return undefined;
		const provider = modelId.slice(0, slashIndex);
		const id = modelId.slice(slashIndex + 1);
		return this.session.modelRegistry.find(provider, id);
	}

	private async emitAvailableCommands(sessionId: string): Promise<void> {
		await this.connection.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "available_commands_update",
				availableCommands: createSlashCommandsUpdate(this.session),
			},
		});
	}

	private async emitSessionMetadata(state: AcpSessionState): Promise<void> {
		state.title = this.getCurrentSessionTitle() ?? state.title;
		await this.connection.sessionUpdate({
			sessionId: state.sessionId,
			update: {
				sessionUpdate: "session_info_update",
				title: state.title ?? null,
				updatedAt: new Date().toISOString(),
			},
		});
	}

	private scheduleSessionBootstrap(
		sessionId: string,
		options: { replayHistory?: boolean } = {},
	): void {
		deferAcpNotification(async () => {
			const state = this.sessions.get(sessionId);
			if (!state) return;
			await this.emitSessionMetadata(state);
			await this.emitAvailableCommands(sessionId);
			if (options.replayHistory) {
				await this.replayHistory(sessionId);
			}
		});
	}

	private async replayHistory(sessionId: string): Promise<void> {
		for (const message of this.session.agent.state.messages) {
			if (message.role !== "user" && message.role !== "assistant") continue;
			const text = getMessageText(message);
			if (!text.trim()) continue;

			await this.connection.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate:
						message.role === "user" ? "user_message_chunk" : "agent_message_chunk",
					content: textToContent(text),
					messageId: createMessageId(),
				},
			});
		}
	}

	private async activateSession(state: AcpSessionState): Promise<void> {
		await this.ensureWorkspaceSession(state.cwd);
		const currentFile = this.session.sessionManager.getSessionFile();
		if (state.sessionFile && state.sessionFile !== currentFile) {
			const switched = await this.session.switchSession(state.sessionFile);
			if (!switched) {
				throw new Error(`Failed to switch to session ${state.sessionId}`);
			}
			// Re-emit session_ready after switching so extensions rebuild
			// memory/soul/presence context against the freshly loaded history.
			await this.session.extensionRunner?.emit({ type: "session_ready" });
		}
		this.currentSessionId = state.sessionId;
		await this.applySessionMode(state);
	}

	private async bindSession(session: AgentSession): Promise<void> {
		await session.bindExtensions(this.extensionBindings);
		// Mirror interactive-mode: emit session_ready so memory/soul/presence/
		// interview extensions can install per-session state and inject context
		// into the system prompt. Without this, ACP loses memory continuity.
		await session.extensionRunner?.emit({ type: "session_ready" });
	}

	private async ensureWorkspaceSession(cwd: string): Promise<void> {
		if (!cwd || this.session.cwd === cwd || !this.createSessionForCwd) {
			return;
		}

		await this.session.extensionRunner?.emit({ type: "session_shutdown" });
		const nextSession = await this.createSessionForCwd(cwd);
		this.session = nextSession;
		await this.bindSession(nextSession);
	}

	private async handleBuiltinSlashCommand(
		sessionId: string,
		state: AcpSessionState,
		text: string,
	): Promise<boolean> {
		const trimmed = text.trim();
		if (!trimmed.startsWith("/")) return false;
		const commandName = normalizeAcpCommandName(trimmed.split(/\s+/, 1)[0] ?? "").toLowerCase();

		if (
			commandName &&
			BUILTIN_SLASH_COMMAND_NAME_SET.has(commandName) &&
			!ACP_SUPPORTED_BUILTIN_COMMANDS.has(commandName)
		) {
			await this.sendAssistantText(
				sessionId,
				`/${commandName} is not supported in ACP clients like Zed yet. Use the terminal nanoPencil UI for this command.`,
			);
			return true;
		}

		if (trimmed === "/new") {
			await this.session.newSession();
			state.sessionFile = this.session.sessionManager.getSessionFile();
			state.title = this.getCurrentSessionTitle();
			await this.emitSessionMetadata(state);
			await this.sendAssistantText(sessionId, "Started a new session.");
			return true;
		}

		if (trimmed === "/reload") {
			await this.session.reload();
			await this.activateSession(state);
			await this.emitAvailableCommands(sessionId);
			await this.sendAssistantText(sessionId, "Reloaded extensions, skills, prompts, and themes.");
			return true;
		}

		if (trimmed === "/session") {
			const stats = this.session.getSessionStats();
			const context = this.session.getContextUsage();
			const current = this.session.model;
			const lines = [
				`Session ID: ${stats.sessionId}`,
				`Session name: ${this.session.sessionManager.getSessionName() || "(unnamed)"}`,
				`Session file: ${stats.sessionFile ?? "(in-memory)"}`,
				`Model: ${current ? `${current.provider}/${current.id}` : "none"}`,
				`Thinking: ${this.session.thinkingLevel}`,
				`Agent loop: ${this.session.agentLoopFramework}`,
				`Messages: ${stats.totalMessages} total (${stats.userMessages} user, ${stats.assistantMessages} assistant, ${stats.toolResults} tool results)`,
				`Tool calls: ${stats.toolCalls}`,
			];
			if (context) {
				lines.push(
					`Context: ${context.tokens ?? "unknown"} / ${context.contextWindow} tokens${context.percent != null ? ` (${context.percent.toFixed(1)}%)` : ""}`,
				);
			}
			await this.sendAssistantText(sessionId, lines.join("\n"));
			return true;
		}

		if (trimmed === "/usage") {
			const stats = this.session.getSessionStats();
			const lines = [
				"Usage summary",
				`Input tokens: ${stats.tokens.input}`,
				`Output tokens: ${stats.tokens.output}`,
				`Cache read: ${stats.tokens.cacheRead}`,
				`Cache write: ${stats.tokens.cacheWrite}`,
				`Total tokens: ${stats.tokens.total}`,
				`Estimated cost: $${formatMoney(stats.cost)}`,
			];
			await this.sendAssistantText(sessionId, lines.join("\n"));
			return true;
		}

		if (trimmed === "/name" || trimmed.startsWith("/name ")) {
			const arg = trimmed.slice("/name".length).trim();
			if (!arg) {
				await this.sendAssistantText(
					sessionId,
					`Current session name: ${this.session.sessionManager.getSessionName() || "(unnamed)"}`,
				);
				return true;
			}

			this.session.sessionManager.appendSessionInfo(arg);
			state.title = arg;
			await this.emitSessionMetadata(state);
			await this.sendAssistantText(sessionId, `Session name set to "${arg}".`);
			return true;
		}

		if (trimmed === "/resume" || trimmed.startsWith("/resume ")) {
			const arg = trimmed.slice("/resume".length).trim();
			if (!arg) {
				const sessions = await SessionManager.list(state.cwd);
				const summary = sessions
					.slice(0, 10)
					.map((info) => `- ${info.id} | ${info.name || info.firstMessage || "(untitled)"}`)
					.join("\n");
				await this.sendAssistantText(
					sessionId,
					summary
						? `Recent sessions for this workspace:\n${summary}\n\nUse /resume <session-id-or-title>.`
						: "No saved sessions were found for this workspace.",
				);
				return true;
			}

			const target = await this.findSessionByQuery(arg, state.cwd);
			if (!target) {
				await this.sendAssistantText(
					sessionId,
					`No saved session matched "${arg}". Use /resume with no arguments to list recent sessions.`,
				);
				return true;
			}

			const switched = await this.session.switchSession(target.path);
			if (!switched) {
				await this.sendAssistantText(sessionId, `Failed to load session ${target.id}.`);
				return true;
			}

			state.sessionFile = target.path;
			state.cwd = target.cwd;
			state.title = target.name || target.firstMessage || state.title;
			await this.emitSessionMetadata(state);
			await this.emitAvailableCommands(sessionId);
			await this.sendAssistantText(
				sessionId,
				`Resumed session ${target.id}${state.title ? ` (${state.title})` : ""}. Future turns now use that saved conversation context.`,
			);
			return true;
		}

		if (trimmed === "/thinking" || trimmed.startsWith("/thinking ")) {
			const arg = trimmed.slice("/thinking".length).trim().toLowerCase();
			if (!arg) {
				const levels = this.session.getAvailableThinkingLevels().join(", ");
				await this.sendAssistantText(
					sessionId,
					`Current thinking level: ${this.session.thinkingLevel}\nAvailable levels: ${levels}`,
				);
				return true;
			}

			const levels = this.session.getAvailableThinkingLevels();
			if (!levels.includes(arg as any)) {
				await this.sendAssistantText(
					sessionId,
					`Unknown thinking level: ${arg}\nAvailable levels: ${levels.join(", ")}`,
				);
				return true;
			}

			this.session.setThinkingLevel(arg as any);
			await this.sendAssistantText(sessionId, `Thinking level set to ${this.session.thinkingLevel}.`);
			return true;
		}

		if (trimmed === "/agent-loop" || trimmed.startsWith("/agent-loop ")) {
			const arg = trimmed.slice("/agent-loop".length).trim().toLowerCase();
			const choices = ["standard", "weak-model-compatible"] as const;
			const normalized =
				arg === "high-intelligence" ? "standard" :
				arg === "low-intelligence" || arg === "structured-adaptive" ? "weak-model-compatible" :
				arg;
			if (!arg) {
				await this.sendAssistantText(
					sessionId,
					`Current agent loop: ${this.session.agentLoopFramework}\nAvailable frameworks: ${choices.join(", ")}`,
				);
				return true;
			}
			if (!choices.includes(normalized as any)) {
				await this.sendAssistantText(
					sessionId,
					`Unknown agent loop framework: ${arg}\nAvailable frameworks: ${choices.join(", ")}`,
				);
				return true;
			}
			this.session.setAgentLoopFramework(normalized as any);
			await this.sendAssistantText(sessionId, `Agent loop framework set to ${this.session.agentLoopFramework}.`);
			return true;
		}

		if (trimmed === "/model" || trimmed.startsWith("/model ")) {
			const arg = trimmed.slice("/model".length).trim();
			if (!arg) {
				const current = this.session.model;
				const summary = this.session.modelRegistry
					.getAvailable()
					.slice(0, 20)
					.map((model) => `- ${model.provider}/${model.id}`)
					.join("\n");
				await this.sendAssistantText(
					sessionId,
					`Current model: ${current ? `${current.provider}/${current.id}` : "none"}\nAvailable models:\n${summary}`,
				);
				return true;
			}

			const model = this.findExactModelMatch(arg);
			if (!model) {
				const matches = this.session.modelRegistry
					.getAvailable()
					.filter((candidate) => {
						const full = `${candidate.provider}/${candidate.id}`.toLowerCase();
						return full.includes(arg.toLowerCase()) || candidate.id.toLowerCase().includes(arg.toLowerCase());
					})
					.slice(0, 10)
					.map((candidate) => `- ${candidate.provider}/${candidate.id}`)
					.join("\n");
				await this.sendAssistantText(
					sessionId,
					matches
						? `No exact model match for "${arg}". Closest matches:\n${matches}`
						: `No model match for "${arg}".`,
				);
				return true;
			}

			await this.session.setModel(model);
			await this.sendAssistantText(
				sessionId,
				`Model switched to ${model.provider}/${model.id}.`,
			);
			return true;
		}

		if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
			const instructions = trimmed.slice("/compact".length).trim() || undefined;
			const result = await this.session.compact(instructions);
			await this.sendAssistantText(
				sessionId,
				`Compaction completed.\nFirst kept entry: ${result.firstKeptEntryId}\nTokens before: ${result.tokensBefore}`,
			);
			return true;
		}

		return false;
	}

	private findExactModelMatch(searchTerm: string): Model<any> | undefined {
		const term = searchTerm.trim().toLowerCase();
		if (!term) return undefined;

		let provider: string | undefined;
		let modelId = term;
		if (term.includes("/")) {
			const [rawProvider, rawModelId] = term.split("/", 2);
			provider = rawProvider?.trim();
			modelId = rawModelId?.trim() ?? "";
		}

		if (!modelId) return undefined;

		return this.session.modelRegistry.getAvailable().find((model) => {
			if (provider && model.provider.toLowerCase() !== provider) return false;
			return model.id.toLowerCase() === modelId;
		});
	}

	private async sendAssistantText(sessionId: string, text: string): Promise<void> {
		await this.connection.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: textToContent(text),
				messageId: createMessageId(),
			},
		});
	}

	private async applySessionMode(state: AcpSessionState): Promise<void> {
		const allToolNames = this.session.getAllTools().map((tool) => tool.name);

		if (state.modeId === "read-only") {
			const readOnlyToolNames = allToolNames.filter((name) =>
				["read", "grep", "find", "ls", "time"].includes(name),
			);
			this.session.setActiveToolsByName(readOnlyToolNames);
			return;
		}

		this.session.setActiveToolsByName(allToolNames);
		if (state.modeId === "ask") {
			const wrapped = this.wrapToolsForAskMode(this.session.agent.state.tools, state);
			this.session.agent.setTools(wrapped);
		}
	}

	private wrapToolsForAskMode(tools: AgentTool<any>[], state: AcpSessionState): AgentTool<any>[] {
		return tools.map((tool) => {
			if (!isMutatingTool(tool)) return tool;

			return {
				...tool,
				execute: async (toolCallId, params, signal, onUpdate) => {
					await this.requestPermissionIfNeeded(state, tool, toolCallId, params);
					return tool.execute(toolCallId, params, signal, onUpdate);
				},
			};
		});
	}

	private async requestPermissionIfNeeded(
		state: AcpSessionState,
		tool: AgentTool<any>,
		toolCallId: string,
		params: unknown,
	): Promise<void> {
		if (state.allowAllMutations) return;
		if (state.rejectAllMutations) {
			throw new Error("Permission denied for mutating tools in this session.");
		}

		const options: PermissionOption[] = [
			{ optionId: "allow_once", name: "Allow once", kind: "allow_once" },
			{ optionId: "allow_always", name: "Always allow", kind: "allow_always" },
			{ optionId: "reject_once", name: "Reject once", kind: "reject_once" },
			{ optionId: "reject_always", name: "Always reject", kind: "reject_always" },
		];

		const response = await this.connection.requestPermission({
			sessionId: state.sessionId,
			options,
			toolCall: {
				toolCallId,
				title: `Run ${tool.name}`,
				kind: mapToolKind(tool.name),
				status: "pending",
				locations: [],
				rawInput: params,
			},
		});

		if (response.outcome.outcome === "cancelled") {
			throw new Error("Permission request was cancelled.");
		}

		switch (response.outcome.optionId) {
			case "allow_once":
				return;
			case "allow_always":
				state.allowAllMutations = true;
				return;
			case "reject_always":
				state.rejectAllMutations = true;
				throw new Error("Permission denied for mutating tools in this session.");
			case "reject_once":
			default:
				throw new Error("Permission denied for this tool call.");
		}
	}

	/**
	 * Map nanoPencil AgentSessionEvent to ACP session/update notifications.
	 */
	private mapEventToAcp(sessionId: string, event: AgentSessionEvent): void {
		switch (event.type) {
			case "message_update": {
				const sub = event.assistantMessageEvent;
				switch (sub.type) {
					case "text_delta":
						void this.connection.sessionUpdate({
							sessionId,
							update: {
								sessionUpdate: "agent_message_chunk",
								content: textToContent(sub.delta),
								messageId: createMessageId(),
							},
						});
						break;

					case "thinking_delta":
						void this.connection.sessionUpdate({
							sessionId,
							update: {
								sessionUpdate: "agent_thought_chunk",
								content: textToContent(sub.delta),
								messageId: createMessageId(),
							},
						});
						break;
				}
				break;
			}

			case "message_end":
				if (isVisibleCustomMessage(event.message)) {
					const text = getMessageText(event.message);
					if (text.trim()) {
						void this.connection.sessionUpdate({
							sessionId,
							update: {
								sessionUpdate: "agent_message_chunk",
								content: textToContent(text),
								messageId: createMessageId(),
							},
						});
					}
				}
				break;

			case "tool_execution_start":
				void this.connection.sessionUpdate({
					sessionId,
					update: {
						sessionUpdate: "tool_call",
						toolCallId: event.toolCallId,
						title: `${event.toolName}`,
						kind: mapToolKind(event.toolName),
						status: "pending",
						locations: [],
						rawInput: event.args,
					},
				});
				break;

			case "tool_execution_update":
				void this.connection.sessionUpdate({
					sessionId,
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: event.toolCallId,
						status: "pending",
						content: [
							{
								type: "content",
								content: {
									type: "text",
									text: toolPayloadToText(event.partialResult),
								},
							},
						] satisfies ToolCallContent[],
						rawOutput: event.partialResult,
					},
				});
				break;

			case "tool_execution_end":
				void this.connection.sessionUpdate({
					sessionId,
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: event.toolCallId,
						status: event.isError ? "failed" : "completed",
						content: [
							{
								type: "content",
								content: {
									type: "text",
									text: toolPayloadToText(event.result),
								},
							},
						] satisfies ToolCallContent[],
						rawOutput: event.result,
					},
				});
				break;
		}
	}
}

/**
 * Run in ACP mode.
 * Listens for JSON-RPC 2.0 messages on stdin, outputs JSON-RPC responses/events on stdout.
 */
export async function runAcpMode(session: AgentSession, options: AcpModeOptions = {}): Promise<never> {
	// Set up ACP connection via stdin/stdout
	const input = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
	const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
	const stream = acp.ndJsonStream(input, output);

	new acp.AgentSideConnection((conn) => new NanoPencilAgent(conn, session, options), stream);

	// Keep process alive
	return new Promise(() => {});
}

export const __testUtils = {
	buildAcpAvailableCommands,
	createAvailableCommandInput,
	deferAcpNotification,
	isAdvertisableAcpCommand,
	normalizeAcpCommandName,
};
