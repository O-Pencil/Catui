/**
 * [WHO]: Provides RpcCommandHandler, RpcServerMessage, buildRpcSlashCommands(), buildRpcSessionState(), buildRpcLoopPolicyOptions()
 * [FROM]: Depends on node:crypto, core/runtime/agent-session, core/runtime/session-events, core/extensions-host, core/session/session-manager, modes/interactive/theme/theme, modes/rpc/rpc-types
 * [TO]: Consumed by modes/rpc/rpc-mode.ts (stdio transport) and modes/remote/remote-server.ts (WebSocket transport)
 * [HERE]: modes/rpc/rpc-command-handler.ts - transport-agnostic RPC protocol core shared by all RPC transports
 */
import * as crypto from "node:crypto";
import type { AgentSession } from "../../core/runtime/agent-session.js";
import type { AgentSessionEvent } from "../../core/runtime/session-events.js";
import { SessionManager } from "../../core/session/session-manager.js";
import type {
	ExtensionUIContext,
	ExtensionWidgetOptions,
} from "../../core/extensions-host/index.js";
import { buildExtensionSlashCommands } from "../../core/runtime/slash-command-catalog.js";
import { inferSlashCommandCategory, type SlashCommandInfo } from "../../core/slash-commands.js";
import { type Theme, theme } from "../interactive/theme/theme.js";
import type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
	RpcLoopPolicyOptions,
	RpcSessionListEntry,
	RpcSlashCommand,
} from "./rpc-types.js";
import type { AgentLoopPolicyOptions } from "@catui/agent-core";

type RpcSlashCommandCatalogSession = Pick<AgentSession, "extensionRunner" | "promptTemplates" | "resourceLoader">;
type RpcStateSession = Pick<
	AgentSession,
	| "model"
	| "thinkingLevel"
	| "agentLoopFramework"
	| "isStreaming"
	| "isCompacting"
	| "steeringMode"
	| "followUpMode"
	| "sessionFile"
	| "sessionId"
	| "sessionName"
	| "autoCompactionEnabled"
	| "messages"
	| "pendingMessageCount"
	| "state"
>;

/** Every message a Catui RPC server pushes to a connected client (one JSON object per transport frame). */
export type RpcServerMessage =
	| RpcResponse
	| RpcExtensionUIRequest
	| AgentSessionEvent
	| { type: "extension_error"; extensionPath: string; event: string; error: string };

function toRpcSlashCommand(command: SlashCommandInfo): RpcSlashCommand {
	return {
		name: command.name,
		description: command.description,
		source: command.source,
		category: command.category,
		location: command.location as RpcSlashCommand["location"],
		path: command.path,
	};
}

export function buildRpcSlashCommands(session: RpcSlashCommandCatalogSession): RpcSlashCommand[] {
	if (session.extensionRunner) {
		return buildExtensionSlashCommands({
			promptTemplates: session.promptTemplates,
			resourceLoader: session.resourceLoader,
			extensionRunner: session.extensionRunner,
		}).map(toRpcSlashCommand);
	}

	return [
		...session.promptTemplates.map((template) => ({
			name: template.name,
			description: template.description,
			source: "prompt" as const,
			category: inferSlashCommandCategory(template.name, "prompt"),
			location: template.source as RpcSlashCommand["location"],
			path: template.filePath,
		})),
		...session.resourceLoader.getSkills().skills.map((skill) => ({
			name: `skill:${skill.name}`,
			description: skill.description,
			source: "skill" as const,
			category: inferSlashCommandCategory(skill.name, "skill"),
			location: skill.source as RpcSlashCommand["location"],
			path: skill.filePath,
		})),
	];
}

export function buildRpcSessionState(session: RpcStateSession): RpcSessionState {
	return {
		model: session.model,
		thinkingLevel: session.thinkingLevel,
		agentLoopFramework: session.agentLoopFramework,
		isStreaming: session.isStreaming,
		isCompacting: session.isCompacting,
		steeringMode: session.steeringMode,
		followUpMode: session.followUpMode,
		lastResult: session.state.lastResult,
		sessionFile: session.sessionFile,
		sessionId: session.sessionId,
		sessionName: session.sessionName,
		autoCompactionEnabled: session.autoCompactionEnabled,
		messageCount: session.messages.length,
		pendingMessageCount: session.pendingMessageCount,
	};
}

export function buildRpcLoopPolicyOptions(policy: RpcLoopPolicyOptions): Partial<AgentLoopPolicyOptions> {
	const out: Partial<AgentLoopPolicyOptions> = {};
	if ("maxToolResultBatchSizeChars" in policy) {
		out.maxToolResultBatchSizeChars = policy.maxToolResultBatchSizeChars ?? undefined;
	}
	if ("maxModelErrorRecoveryAttempts" in policy) {
		out.maxModelErrorRecoveryAttempts = policy.maxModelErrorRecoveryAttempts ?? undefined;
	}
	if ("maxOutputTokenRecoveryAttempts" in policy) {
		out.maxOutputTokenRecoveryAttempts = policy.maxOutputTokenRecoveryAttempts ?? undefined;
	}
	if ("outputTokenBudget" in policy) {
		out.outputTokenBudget = policy.outputTokenBudget ?? undefined;
	}
	if ("maxStopHookContinuations" in policy) {
		out.maxStopHookContinuations = policy.maxStopHookContinuations ?? undefined;
	}
	if ("maxToolConcurrency" in policy) {
		out.maxToolConcurrency = policy.maxToolConcurrency ?? undefined;
	}
	if ("maxTurnsPerPrompt" in policy) {
		out.maxTurnsPerPrompt = policy.maxTurnsPerPrompt ?? undefined;
	}
	if ("maxToolCallsPerPrompt" in policy) {
		out.maxToolCallsPerPrompt = policy.maxToolCallsPerPrompt ?? undefined;
	}
	return out;
}

export interface RpcCommandHandlerOptions {
	session: AgentSession;
	/**
	 * Default sink for session events, extension UI requests, and extension errors.
	 * stdio transport: stdout. Remote transport: fan-out to all connected clients.
	 */
	send: (message: RpcServerMessage) => void;
}

/**
 * Transport-agnostic RPC protocol core.
 * Owns command dispatch, session event forwarding, and extension UI bridging.
 * Transports (stdio JSON-lines, WebSocket) provide the send sinks and lifecycle.
 */
export class RpcCommandHandler {
	private readonly session: AgentSession;
	private readonly output: (message: RpcServerMessage) => void;
	private readonly pendingExtensionRequests = new Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void }
	>();
	private _shutdownRequested = false;
	private _bound = false;

	constructor(options: RpcCommandHandlerOptions) {
		this.session = options.session;
		this.output = options.send;
	}

	get shutdownRequested(): boolean {
		return this._shutdownRequested;
	}

	private readonly success = <T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null,
	): RpcResponse => {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	private readonly error = (id: string | undefined, command: string, message: string): RpcResponse => {
		return { id, type: "response", command, success: false, error: message };
	};

	/**
	 * Bind extensions with the protocol-backed UI context and subscribe to session events.
	 * Idempotent. Must be called before handleCommand.
	 */
	async bind(): Promise<void> {
		if (this._bound) return;
		this._bound = true;

		// Set up extensions with protocol-based UI context
		await this.session.bindExtensions({
			uiContext: this.createExtensionUIContext(),
			commandContextActions: {
				waitForIdle: () => this.session.agent.waitForIdle(),
				newSession: async (options) => {
					// Delegate to AgentSession (handles setup + agent state sync)
					const success = await this.session.newSession(options);
					return { cancelled: !success };
				},
				fork: async (entryId) => {
					const result = await this.session.fork(entryId);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await this.session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
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
				this._shutdownRequested = true;
			},
			onError: (err) => {
				this.output({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
			},
		});

		// Forward all agent events
		this.session.subscribe((event) => {
			this.output(event);
		});
	}

	/** Helper for dialog methods with signal/timeout support */
	private createDialogPromise<T>(
		opts: { signal?: AbortSignal; timeout?: number } | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				this.pendingExtensionRequests.delete(id);
			};

			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}

			this.pendingExtensionRequests.set(id, {
				resolve: (response: RpcExtensionUIResponse) => {
					cleanup();
					resolve(parseResponse(response));
				},
				reject,
			});
			this.output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
		});
	}

	/**
	 * Create an extension UI context that uses the RPC protocol.
	 */
	private createExtensionUIContext(): ExtensionUIContext {
		// Closure aliases so object-literal methods see the handler, not the literal
		const output = this.output;
		const pendingExtensionRequests = this.pendingExtensionRequests;
		return {
			select: (title, options, opts) =>
				this.createDialogPromise(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, (r) =>
					"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
				),

			confirm: (title, message, opts) =>
				this.createDialogPromise(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, (r) =>
					"cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false,
				),

			input: (title, placeholder, opts) =>
				this.createDialogPromise(opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }, (r) =>
					"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
				),

			notify(message: string, type?: "info" | "warning" | "error"): void {
				// Fire and forget - no response needed
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "notify",
					message,
					notifyType: type,
				} as RpcExtensionUIRequest);
			},

			onTerminalInput(): () => void {
				// Raw terminal input not supported in RPC mode
				return () => {};
			},

			setStatus(key: string, text: string | undefined): void {
				// Fire and forget - no response needed
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setStatus",
					statusKey: key,
					statusText: text,
				} as RpcExtensionUIRequest);
			},

			setWorkingMessage(_message?: string): void {
				// Working message not supported in RPC mode - requires TUI loader access
			},

			setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
				// Only support string arrays in RPC mode - factory functions are ignored
				if (content === undefined || Array.isArray(content)) {
					output({
						type: "extension_ui_request",
						id: crypto.randomUUID(),
						method: "setWidget",
						widgetKey: key,
						widgetLines: content as string[] | undefined,
						widgetPlacement: options?.placement,
					} as RpcExtensionUIRequest);
				}
				// Component factories are not supported in RPC mode - would need TUI access
			},

			setFooter(_factory: unknown): void {
				// Custom footer not supported in RPC mode - requires TUI access
			},

			setHeader(_factory: unknown): void {
				// Custom header not supported in RPC mode - requires TUI access
			},

			setTitle(title: string): void {
				// Fire and forget - host can implement terminal title control
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setTitle",
					title,
				} as RpcExtensionUIRequest);
			},

			async custom() {
				// Custom UI not supported in RPC mode
				return undefined as never;
			},

			pasteToEditor(text: string): void {
				// Paste handling not supported in RPC mode - falls back to setEditorText
				this.setEditorText(text);
			},

			setEditorText(text: string): void {
				// Fire and forget - host can implement editor control
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "set_editor_text",
					text,
				} as RpcExtensionUIRequest);
			},

			getEditorText(): string {
				// Synchronous method can't wait for RPC response
				// Host should track editor state locally if needed
				return "";
			},

			async editor(title: string, prefill?: string): Promise<string | undefined> {
				const id = crypto.randomUUID();
				return new Promise((resolve, reject) => {
					pendingExtensionRequests.set(id, {
						resolve: (response: RpcExtensionUIResponse) => {
							if ("cancelled" in response && response.cancelled) {
								resolve(undefined);
							} else if ("value" in response) {
								resolve(response.value);
							} else {
								resolve(undefined);
							}
						},
						reject,
					});
					output({ type: "extension_ui_request", id, method: "editor", title, prefill } as RpcExtensionUIRequest);
				});
			},

			async openExternalEditor(filePath: string, title?: string): Promise<boolean> {
				const id = crypto.randomUUID();
				return new Promise((resolve, reject) => {
					pendingExtensionRequests.set(id, {
						resolve: (response: RpcExtensionUIResponse) => {
							resolve("confirmed" in response ? response.confirmed : false);
						},
						reject,
					});
					output({ type: "extension_ui_request", id, method: "openExternalEditor", title, filePath } as RpcExtensionUIRequest);
				});
			},

			setEditorComponent(): void {
				// Custom editor components not supported in RPC mode
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

			setTheme(_theme: string | Theme) {
				// Theme switching not supported in RPC mode
				return { success: false, error: "Theme switching not supported in RPC mode" };
			},

			getToolsExpanded() {
				// Tool expansion not supported in RPC mode - no TUI
				return false;
			},

			setToolsExpanded(_expanded: boolean) {
				// Tool expansion not supported in RPC mode - no TUI
			},
		};
	}

	/**
	 * Resolve a pending extension UI request. First response wins.
	 * Returns false for unknown or already-resolved request ids.
	 */
	handleExtensionUIResponse(response: RpcExtensionUIResponse): boolean {
		const pending = this.pendingExtensionRequests.get(response.id);
		if (!pending) return false;
		this.pendingExtensionRequests.delete(response.id);
		pending.resolve(response);
		return true;
	}

	/**
	 * Handle a single command.
	 * @param send Optional per-call sink for async errors (e.g. prompt failures) so replies
	 * route back to the requesting client instead of the broadcast sink.
	 */
	async handleCommand(command: RpcCommand, send?: (message: RpcServerMessage) => void): Promise<RpcResponse> {
		const id = command.id;
		const replySink = send ?? this.output;
		const { session } = this;

		switch (command.type) {
			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				// Don't await - events will stream
				// Extension commands are executed immediately, file prompt templates are expanded
				// If streaming and streamingBehavior specified, queues via steer/followUp
				session
					.prompt(command.message, {
						images: command.images,
						streamingBehavior: command.streamingBehavior,
						source: "rpc",
					})
					.catch((e) => replySink(this.error(id, "prompt", e.message)));
				return this.success(id, "prompt");
			}

			case "steer": {
				await session.steer(command.message, command.images);
				return this.success(id, "steer");
			}

			case "follow_up": {
				await session.followUp(command.message, command.images);
				return this.success(id, "follow_up");
			}

			case "abort": {
				await session.abort();
				return this.success(id, "abort");
			}

			case "new_session": {
				const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
				const cancelled = !(await session.newSession(options));
				return this.success(id, "new_session", { cancelled });
			}

			// =================================================================
			// State
			// =================================================================

			case "get_state": {
				return this.success(id, "get_state", buildRpcSessionState(session));
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = await session.modelRegistry.getAvailable();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					return this.error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return this.success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel();
				if (!result) {
					return this.success(id, "cycle_model", null);
				}
				return this.success(id, "cycle_model", result);
			}

			case "get_available_models": {
				const models = await session.modelRegistry.getAvailable();
				return this.success(id, "get_available_models", { models });
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return this.success(id, "set_thinking_level");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return this.success(id, "cycle_thinking_level", null);
				}
				return this.success(id, "cycle_thinking_level", { level });
			}

			// =================================================================
			// Agent Loop
			// =================================================================

			case "set_agent_loop_framework": {
				session.setAgentLoopFramework(command.framework ?? undefined);
				return this.success(id, "set_agent_loop_framework");
			}

			case "set_loop_policy": {
				session.setLoopPolicy(buildRpcLoopPolicyOptions(command.policy));
				return this.success(id, "set_loop_policy");
			}

			// =================================================================
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return this.success(id, "set_steering_mode");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return this.success(id, "set_follow_up_mode");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return this.success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return this.success(id, "set_auto_compaction");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return this.success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return this.success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const result = await session.executeBash(command.command);
				return this.success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return this.success(id, "abort_bash");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return this.success(id, "get_session_stats", stats);
			}

			case "export_html": {
				const path = await session.exportToHtml(command.outputPath);
				return this.success(id, "export_html", { path });
			}

			case "switch_session": {
				const cancelled = !(await session.switchSession(command.sessionPath));
				return this.success(id, "switch_session", { cancelled });
			}

			case "list_sessions": {
				const manager = session.sessionManager;
				const sessions = await SessionManager.list(manager.getCwd(), manager.getSessionDir());
				const entries: RpcSessionListEntry[] = sessions.map((s) => ({
					path: s.path,
					id: s.id,
					cwd: s.cwd,
					name: s.name,
					parentSessionPath: s.parentSessionPath,
					created: s.created.toISOString(),
					modified: s.modified.toISOString(),
					messageCount: s.messageCount,
					firstMessage: s.firstMessage,
				}));
				return this.success(id, "list_sessions", { sessions: entries });
			}

			case "fork": {
				const result = await session.fork(command.entryId);
				return this.success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
			}

			case "get_fork_messages": {
				const messages = session.getUserMessagesForForking();
				return this.success(id, "get_fork_messages", { messages });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return this.success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return this.error(id, "set_session_name", "Session name cannot be empty");
				}
				session.setSessionName(name);
				return this.success(id, "set_session_name");
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return this.success(id, "get_messages", { messages: session.messages });
			}

			// =================================================================
			// Commands (available for invocation via prompt)
			// =================================================================

			case "get_commands": {
				return this.success(id, "get_commands", { commands: buildRpcSlashCommands(session) });
			}

			default: {
				const unknownCommand = command as { type: string };
				return this.error(undefined, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	}

	/**
	 * Emit session_shutdown extension hooks. Call once at transport teardown
	 * when an extension invoked the shutdown handler.
	 */
	async runShutdownHooks(): Promise<void> {
		const currentRunner = this.session.extensionRunner;
		if (currentRunner?.hasHandlers("session_shutdown")) {
			await currentRunner.emit({ type: "session_shutdown" });
		}
	}
}
