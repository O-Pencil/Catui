/**
 * [WHO]: ExtensionRunner class, lifecycle management, event emission, slash-command dispatch chokepoint (invokeCommand), telemetry sink wiring (setTelemetrySink)
 * [FROM]: Depends on agent-core, ai, tui, modes/theme, session-manager, types.ts, core/telemetry (ExtensionTelemetrySink + classifyArgsSignature for the P1 ext_command_events writer)
 * [TO]: Consumed by core/extensions/index.ts, core/extensions/wrapper.ts, core/runtime/agent-session.ts (delegates command dispatch via invokeCommand)
 * [HERE]: core/extensions/runner.ts - extension execution and lifecycle management; owns the single try/catch around command.handler so telemetry can wrap every invocation regardless of caller mode
 */
import type { AgentMessage } from "@pencil-agent/agent-core";
import type { ImageContent, Model } from "@pencil-agent/ai";
import type { KeyId } from "@pencil-agent/tui";
import { type Theme, theme } from "../../modes/interactive/theme/theme.js";
import type { ResourceDiagnostic } from "../diagnostics.js";
import type { KeyAction, KeybindingsConfig } from "../keybindings.js";
import type { ModelRegistry } from "../model-registry.js";
import type { SessionManager } from "../session/session-manager.js";
import {
	classifyArgsSignature,
	type CommandOutcome,
	type ExtCallerContext,
	type ExtensionTelemetrySink,
	HOOK_SAMPLE_RATES,
	type LlmCallEventInput,
	runWithExtCallerContext,
} from "../telemetry/index.js";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	CompactOptions,
	CompletionResult,
	ContextEvent,
	ContextEventResult,
	ContextUsage,
	Extension,
	ExtensionActions,
	ExtensionCommandContext,
	ExtensionCommandContextActions,
	ExtensionContext,
	ExtensionContextActions,
	ExtensionError,
	ExtensionEvent,
	ExtensionFlag,
	ExtensionRuntime,
	ExtensionShortcut,
	ExtensionUIContext,
	InputEvent,
	InputEventResult,
	InputSource,
	MessageRenderer,
	RegisteredCommand,
	RegisteredTool,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	SessionBeforeCompactResult,
	SessionBeforeForkResult,
	SessionBeforeSwitchResult,
	SessionBeforeTreeResult,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	UserBashEvent,
	UserBashEventResult,
} from "./types.js";

// Keybindings for these actions cannot be overridden by extensions
const RESERVED_ACTIONS_FOR_EXTENSION_CONFLICTS: ReadonlyArray<KeyAction> = [
	"interrupt",
	"clear",
	"exit",
	"suspend",
	"cycleThinkingLevel",
	"cycleModelForward",
	"cycleModelBackward",
	"selectModel",
	"selectProviderThenModel",
	"expandTools",
	"toggleThinking",
	"externalEditor",
	"followUp",
	"submit",
	"selectConfirm",
	"selectCancel",
	"copy",
	"deleteToLineEnd",
];

type BuiltInKeyBindings = Partial<Record<KeyId, { action: KeyAction; restrictOverride: boolean }>>;

const buildBuiltinKeybindings = (effectiveKeybindings: Required<KeybindingsConfig>): BuiltInKeyBindings => {
	const builtinKeybindings = {} as BuiltInKeyBindings;
	for (const [action, keys] of Object.entries(effectiveKeybindings)) {
		const keyAction = action as KeyAction;
		const keyList = Array.isArray(keys) ? keys : [keys];
		const restrictOverride = RESERVED_ACTIONS_FOR_EXTENSION_CONFLICTS.includes(keyAction);
		for (const key of keyList) {
			const normalizedKey = key.toLowerCase() as KeyId;
			builtinKeybindings[normalizedKey] = {
				action: keyAction,
				restrictOverride: restrictOverride,
			};
		}
	}
	return builtinKeybindings;
};

/** Combined result from all before_agent_start handlers */
interface BeforeAgentStartCombinedResult {
	messages?: NonNullable<BeforeAgentStartEventResult["message"]>[];
	systemPrompt?: string;
}

/**
 * Events handled by the generic emit() method.
 * Events with dedicated emitXxx() methods are excluded for stronger type safety.
 */
type RunnerEmitEvent = Exclude<
	ExtensionEvent,
	| ToolCallEvent
	| ToolResultEvent
	| UserBashEvent
	| ContextEvent
	| BeforeAgentStartEvent
	| ResourcesDiscoverEvent
	| InputEvent
>;

type SessionBeforeEvent = Extract<
	RunnerEmitEvent,
	{ type: "session_before_switch" | "session_before_fork" | "session_before_compact" | "session_before_tree" }
>;

type SessionBeforeEventResult =
	| SessionBeforeSwitchResult
	| SessionBeforeForkResult
	| SessionBeforeCompactResult
	| SessionBeforeTreeResult;

type RunnerEmitResult<TEvent extends RunnerEmitEvent> = TEvent extends { type: "session_before_switch" }
	? SessionBeforeSwitchResult | undefined
	: TEvent extends { type: "session_before_fork" }
		? SessionBeforeForkResult | undefined
		: TEvent extends { type: "session_before_compact" }
			? SessionBeforeCompactResult | undefined
			: TEvent extends { type: "session_before_tree" }
				? SessionBeforeTreeResult | undefined
				: undefined;

export type ExtensionErrorListener = (error: ExtensionError) => void;

export type NewSessionHandler = (options?: {
	parentSession?: string;
	setup?: (sessionManager: SessionManager) => Promise<void>;
}) => Promise<{ cancelled: boolean }>;

export type ForkHandler = (entryId: string) => Promise<{ cancelled: boolean }>;

export type NavigateTreeHandler = (
	targetId: string,
	options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
) => Promise<{ cancelled: boolean }>;

export type SwitchSessionHandler = (sessionPath: string) => Promise<{ cancelled: boolean }>;

export type ReloadHandler = () => Promise<void>;

export type ShutdownHandler = () => void;

/**
 * Helper function to emit session_shutdown event to extensions.
 * Returns true if the event was emitted, false if there were no handlers.
 */
export async function emitSessionShutdownEvent(extensionRunner: ExtensionRunner | undefined): Promise<boolean> {
	if (extensionRunner?.hasHandlers("session_shutdown")) {
		await extensionRunner.emit({
			type: "session_shutdown",
		});
		return true;
	}
	return false;
}

const noOpUIContext: ExtensionUIContext = {
	select: async () => undefined,
	confirm: async () => false,
	input: async () => undefined,
	notify: () => {},
	onTerminalInput: () => () => {},
	setStatus: () => {},
	setWorkingMessage: () => {},
	setWidget: () => {},
	setFooter: () => {},
	setHeader: () => {},
	setTitle: () => {},
	custom: async () => undefined as never,
	pasteToEditor: () => {},
	setEditorText: () => {},
	getEditorText: () => "",
	editor: async () => undefined,
	openExternalEditor: async () => false,
	setEditorComponent: () => {},
	get theme() {
		return theme;
	},
	getAllThemes: () => [],
	getTheme: () => undefined,
	setTheme: (_theme: string | Theme) => ({ success: false, error: "UI not available" }),
	getToolsExpanded: () => false,
	setToolsExpanded: () => {},
};

export class ExtensionRunner {
	private extensions: Extension[];
	private runtime: ExtensionRuntime;
	private uiContext: ExtensionUIContext;
	private cwd: string;
	private agentDir: string;
	private sessionManager: SessionManager;
	private modelRegistry: ModelRegistry;
	private errorListeners: Set<ExtensionErrorListener> = new Set();
	private getModel: () => Model<any> | undefined = () => undefined;
	private completeSimpleFn: (systemPrompt: string, userMessage: string) => Promise<string | undefined> = async () =>
		undefined;
	private completeSimpleWithUsageFn: (
		systemPrompt: string,
		userMessage: string,
	) => Promise<CompletionResult | undefined> = async () => undefined;
	private completeJsonFn:
		| ((
				systemPrompt: string,
				userMessage: string,
				schema: Record<string, unknown>,
				options?: { toolName?: string; resultKey?: string },
		  ) => Promise<string | undefined>)
		| undefined;
	private isIdleFn: () => boolean = () => true;
	private waitForIdleFn: () => Promise<void> = async () => {};
	private abortFn: () => void = () => {};
	private hasPendingMessagesFn: () => boolean = () => false;
	private getContextUsageFn: () => ContextUsage | undefined = () => undefined;
	private compactFn: (options?: CompactOptions) => void = () => {};
	private getSystemPromptFn: () => string = () => "";
	private getSoulManagerFn: () => unknown | undefined = () => undefined;
	private getSettingsFn: () => import("../config/settings-manager.js").Settings = () => ({});
	private getSkillsFn: () => readonly import("../skills.js").Skill[] = () => [];
	private newSessionHandler: NewSessionHandler = async () => ({ cancelled: false });
	private forkHandler: ForkHandler = async () => ({ cancelled: false });
	private navigateTreeHandler: NavigateTreeHandler = async () => ({ cancelled: false });
	private switchSessionHandler: SwitchSessionHandler = async () => ({ cancelled: false });
	private reloadHandler: ReloadHandler = async () => {};
	private shutdownHandler: ShutdownHandler = () => {};
	private shortcutDiagnostics: ResourceDiagnostic[] = [];
	private commandDiagnostics: ResourceDiagnostic[] = [];
	private telemetrySink?: ExtensionTelemetrySink;
	private _beforeAgentStartTimeoutMs: number | undefined = 1500;
	private get beforeAgentStartTimeoutMs(): number { return this._beforeAgentStartTimeoutMs ?? 1500; }
	private readonly beforeAgentStartTimeoutSentinel = Symbol("before_agent_start_timeout");
	private beforeAgentStartTimeoutLastReported = new Map<string, number>();

	constructor(
		extensions: Extension[],
		runtime: ExtensionRuntime,
		cwd: string,
		agentDir: string,
		sessionManager: SessionManager,
		modelRegistry: ModelRegistry,
	) {
		this.extensions = extensions;
		this.runtime = runtime;
		this.uiContext = noOpUIContext;
		this.cwd = cwd;
		this.agentDir = agentDir;
		this.sessionManager = sessionManager;
		this.modelRegistry = modelRegistry;
	}

	private async withTimeout<T>(
		valueOrPromise: T | PromiseLike<T>,
		timeoutMs: number,
	): Promise<T | typeof this.beforeAgentStartTimeoutSentinel> {
		return new Promise((resolve) => {
			const timer = setTimeout(() => resolve(this.beforeAgentStartTimeoutSentinel), timeoutMs);
			Promise.resolve(valueOrPromise)
				.then((value) => {
					clearTimeout(timer);
					resolve(value);
				})
				.catch(() => {
					clearTimeout(timer);
					resolve(this.beforeAgentStartTimeoutSentinel);
				});
		});
	}

	private reportBeforeAgentStartTimeout(extensionPath: string): void {
		const now = Date.now();
		const last = this.beforeAgentStartTimeoutLastReported.get(extensionPath) ?? 0;
		// Rate-limit to once per minute per extension.
		if (now - last < 60_000) return;
		this.beforeAgentStartTimeoutLastReported.set(extensionPath, now);
		// Soft warning only; do not surface as user-facing extension error.
		console.warn(
			`Extension before_agent_start timed out (${this.beforeAgentStartTimeoutMs}ms): ${extensionPath}`,
		);
	}

	bindCore(actions: ExtensionActions, contextActions: ExtensionContextActions): void {
		// Copy actions into the shared runtime (all extension APIs reference this)
		this.runtime.sendMessage = actions.sendMessage;
		this.runtime.sendUserMessage = actions.sendUserMessage;
		this.runtime.executeCommand = actions.executeCommand;
		this.runtime.appendEntry = actions.appendEntry;
		this.runtime.setSessionName = actions.setSessionName;
		this.runtime.getSessionName = actions.getSessionName;
		this.runtime.setLabel = actions.setLabel;
		this.runtime.getActiveTools = actions.getActiveTools;
		this.runtime.getAllTools = actions.getAllTools;
		this.runtime.setActiveTools = actions.setActiveTools;
		this.runtime.getCommands = actions.getCommands;
		this.runtime.setModel = actions.setModel;
		this.runtime.getThinkingLevel = actions.getThinkingLevel;
		this.runtime.setThinkingLevel = actions.setThinkingLevel;

		// Context actions (required)
		this.getModel = contextActions.getModel;
		this.completeSimpleFn = contextActions.completeSimple;
		this.completeSimpleWithUsageFn = contextActions.completeSimpleWithUsage;
		this.completeJsonFn = contextActions.completeJson;
		this.isIdleFn = contextActions.isIdle;
		this.runtime.isIdle = () => this.isIdleFn();
		this.abortFn = contextActions.abort;
		this.hasPendingMessagesFn = contextActions.hasPendingMessages;
		this.shutdownHandler = contextActions.shutdown;
		this.getContextUsageFn = contextActions.getContextUsage;
		this.compactFn = contextActions.compact;
		this.getSystemPromptFn = contextActions.getSystemPrompt;
		this.getSoulManagerFn = contextActions.getSoulManager;
		this.getSettingsFn = contextActions.getSettings;
		this.getSkillsFn = contextActions.getSkills;

		// Process provider registrations queued during extension loading
		for (const { name, config } of this.runtime.pendingProviderRegistrations) {
			this.modelRegistry.registerProvider(name, config);
		}
		this.runtime.pendingProviderRegistrations = [];
	}

	bindCommandContext(actions?: ExtensionCommandContextActions): void {
		if (actions) {
			this.waitForIdleFn = actions.waitForIdle;
			this.newSessionHandler = actions.newSession;
			this.forkHandler = actions.fork;
			this.navigateTreeHandler = actions.navigateTree;
			this.switchSessionHandler = actions.switchSession;
			this.reloadHandler = actions.reload;
			return;
		}

		this.waitForIdleFn = async () => {};
		this.newSessionHandler = async () => ({ cancelled: false });
		this.forkHandler = async () => ({ cancelled: false });
		this.navigateTreeHandler = async () => ({ cancelled: false });
		this.switchSessionHandler = async () => ({ cancelled: false });
		this.reloadHandler = async () => {};
	}

	setUIContext(uiContext?: ExtensionUIContext): void {
		this.uiContext = uiContext ?? noOpUIContext;
	}

	getUIContext(): ExtensionUIContext {
		return this.uiContext;
	}

	hasUI(): boolean {
		if (this.uiContext === noOpUIContext) {
			return false;
		}
		return (this.uiContext as { __nonInteractive?: boolean }).__nonInteractive !== true;
	}

	getExtensionPaths(): string[] {
		return this.extensions.map((e) => e.path);
	}

	/** Get all registered tools from all extensions (first registration per name wins). */
	getAllRegisteredTools(): RegisteredTool[] {
		const toolsByName = new Map<string, RegisteredTool>();
		for (const ext of this.extensions) {
			for (const tool of ext.tools.values()) {
				if (!toolsByName.has(tool.definition.name)) {
					toolsByName.set(tool.definition.name, tool);
				}
			}
		}
		return Array.from(toolsByName.values());
	}

	/** Get a tool definition by name. Returns undefined if not found. */
	getToolDefinition(toolName: string): RegisteredTool["definition"] | undefined {
		for (const ext of this.extensions) {
			const tool = ext.tools.get(toolName);
			if (tool) {
				return tool.definition;
			}
		}
		return undefined;
	}

	getFlags(): Map<string, ExtensionFlag> {
		const allFlags = new Map<string, ExtensionFlag>();
		for (const ext of this.extensions) {
			for (const [name, flag] of ext.flags) {
				if (!allFlags.has(name)) {
					allFlags.set(name, flag);
				}
			}
		}
		return allFlags;
	}

	setFlagValue(name: string, value: boolean | string): void {
		this.runtime.flagValues.set(name, value);
	}

	getFlagValues(): Map<string, boolean | string> {
		return new Map(this.runtime.flagValues);
	}

	getShortcuts(effectiveKeybindings: Required<KeybindingsConfig>): Map<KeyId, ExtensionShortcut> {
		this.shortcutDiagnostics = [];
		const builtinKeybindings = buildBuiltinKeybindings(effectiveKeybindings);
		const extensionShortcuts = new Map<KeyId, ExtensionShortcut>();

		const addDiagnostic = (message: string, extensionPath: string) => {
			this.shortcutDiagnostics.push({ type: "warning", message, path: extensionPath });
			if (!this.hasUI()) {
				console.warn(message);
			}
		};

		for (const ext of this.extensions) {
			for (const [key, shortcut] of ext.shortcuts) {
				const normalizedKey = key.toLowerCase() as KeyId;

				const builtInKeybinding = builtinKeybindings[normalizedKey];
				if (builtInKeybinding?.restrictOverride === true) {
					addDiagnostic(
						`Extension shortcut '${key}' from ${shortcut.extensionPath} conflicts with built-in shortcut. Skipping.`,
						shortcut.extensionPath,
					);
					continue;
				}

				if (builtInKeybinding?.restrictOverride === false) {
					addDiagnostic(
						`Extension shortcut conflict: '${key}' is built-in shortcut for ${builtInKeybinding.action} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
						shortcut.extensionPath,
					);
				}

				const existingExtensionShortcut = extensionShortcuts.get(normalizedKey);
				if (existingExtensionShortcut) {
					addDiagnostic(
						`Extension shortcut conflict: '${key}' registered by both ${existingExtensionShortcut.extensionPath} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
						shortcut.extensionPath,
					);
				}
				extensionShortcuts.set(normalizedKey, shortcut);
			}
		}
		return extensionShortcuts;
	}

	getShortcutDiagnostics(): ResourceDiagnostic[] {
		return this.shortcutDiagnostics;
	}

	onError(listener: ExtensionErrorListener): () => void {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}

	emitError(error: ExtensionError): void {
		for (const listener of this.errorListeners) {
			listener(error);
		}
	}

	/** Set the timeout for before_agent_start extension hooks (default: 1500ms). */
	setBeforeAgentStartTimeout(ms: number): void {
		this._beforeAgentStartTimeoutMs = ms;
	}

	/** Clean up all handlers, listeners, and diagnostics. Call on session shutdown. */
	dispose(): void {
		this.errorListeners.clear();
		this.beforeAgentStartTimeoutLastReported.clear();
		this.shortcutDiagnostics = [];
		this.commandDiagnostics = [];
		for (const ext of this.extensions) {
			ext.handlers.clear();
		}
	}

	hasHandlers(eventType: string): boolean {
		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(eventType);
			if (handlers && handlers.length > 0) {
				return true;
			}
		}
		return false;
	}

	getMessageRenderer(customType: string): MessageRenderer | undefined {
		for (const ext of this.extensions) {
			const renderer = ext.messageRenderers.get(customType);
			if (renderer) {
				return renderer;
			}
		}
		return undefined;
	}

	getRegisteredCommands(reserved?: Set<string>): RegisteredCommand[] {
		this.commandDiagnostics = [];

		const commands: RegisteredCommand[] = [];
		const commandOwners = new Map<string, string>();
		for (const ext of this.extensions) {
			for (const command of ext.commands.values()) {
				if (reserved?.has(command.name)) {
					const message = `Extension command '${command.name}' from ${ext.path} conflicts with built-in commands. Skipping.`;
					this.commandDiagnostics.push({ type: "warning", message, path: ext.path });
					if (!this.hasUI()) {
						console.warn(message);
					}
					continue;
				}

				const existingOwner = commandOwners.get(command.name);
				if (existingOwner) {
					const message = `Extension command '${command.name}' from ${ext.path} conflicts with ${existingOwner}. Skipping.`;
					this.commandDiagnostics.push({ type: "warning", message, path: ext.path });
					if (!this.hasUI()) {
						console.warn(message);
					}
					continue;
				}

				commandOwners.set(command.name, ext.path);
				commands.push(command);
			}
		}
		return commands;
	}

	getCommandDiagnostics(): ResourceDiagnostic[] {
		return this.commandDiagnostics;
	}

	getRegisteredCommandsWithPaths(): Array<{ command: RegisteredCommand; extensionPath: string }> {
		const result: Array<{ command: RegisteredCommand; extensionPath: string }> = [];
		for (const ext of this.extensions) {
			for (const command of ext.commands.values()) {
				result.push({ command, extensionPath: ext.path });
			}
		}
		return result;
	}

	getCommand(name: string): RegisteredCommand | undefined {
		for (const ext of this.extensions) {
			const command = ext.commands.get(name);
			if (command) {
				return command;
			}
		}
		return undefined;
	}

	/**
	 * Returns the owning Extension for a given slash command name. Used by the
	 * telemetry middleware to stamp `extension_name` on each ext_command_events
	 * row. Falls back to undefined when no extension claims the command.
	 */
	private findCommandOwner(name: string): Extension | undefined {
		for (const ext of this.extensions) {
			if (ext.commands.has(name)) return ext;
		}
		return undefined;
	}

	/**
	 * Derive a short, stable extension name from an Extension record. For
	 * built-ins (extensions/defaults/<name>) and most user extensions
	 * (packages/<name>) the directory basename is the right answer.
	 */
	private deriveExtensionName(ext: Extension): string {
		const path = ext.path || ext.resolvedPath || "";
		const segments = path.replace(/\/+$/, "").split(/[\\/]/);
		return segments[segments.length - 1] || "unknown";
	}

	/**
	 * Attach (or replace) the extension telemetry sink. The runner owns sink
	 * lifecycle from this point — invokeCommand() will fire-and-forget one
	 * `ext_command_events` row per invocation, and writeLlmCallEvent() (called
	 * from extension-core-bindings) writes one `ext_llm_calls` row per
	 * extension-initiated LLM call. Passing the noop sink (the factory's
	 * default when no insforge credentials exist) is the safe way to disable
	 * telemetry without scattering null-checks at the call sites.
	 */
	setTelemetrySink(sink: ExtensionTelemetrySink): void {
		this.telemetrySink = sink;
	}

	/**
	 * Passthrough used by core/runtime/extension-core-bindings.ts after each
	 * extension-initiated LLM call. The runner owns the sink; the binding
	 * doesn't import it directly to keep its concerns scoped to LLM plumbing.
	 */
	writeLlmCallEvent(input: LlmCallEventInput): void {
		try {
			this.telemetrySink?.writeLlmCallEvent(input);
		} catch {
			// Telemetry must never destabilize the LLM call path.
		}
	}

	/**
	 * Wrap an extension hook handler invocation in three layers:
	 *
	 *   1. AsyncLocalStorage frame so any LLM call placed by the handler gets
	 *      attributed to this extension + hook + isUserInitiated=false in
	 *      ext_llm_calls.
	 *   2. Wall-clock timing measurement (only when the sample roll passes).
	 *   3. One fire-and-forget ext_hook_events row per sampled invocation,
	 *      capturing duration_ms + ok + error_code + sample_rate.
	 *
	 * High-frequency hooks (tool_*) are sampled at 10% so the table doesn't
	 * drown in tool-execution rows; the sample_rate column on each row lets
	 * dashboards extrapolate with `count(*) * 1/sample_rate`. Sampling decision
	 * sits inside the AsyncLocalStorage frame so even skipped-emit hooks still
	 * attribute their LLM calls.
	 */
	private invokeHookHandler<T>(
		ext: Extension,
		hookName: string,
		fn: () => Promise<T> | T,
	): Promise<T> {
		const extensionName = this.deriveExtensionName(ext);
		const ctx: ExtCallerContext = {
			extensionName,
			callerContext: `hook:${hookName}`,
			isUserInitiated: false,
		};
		return runWithExtCallerContext(ctx, async () => {
			const sampleRate = HOOK_SAMPLE_RATES[hookName] ?? 1.0;
			if (sampleRate < 1.0 && Math.random() >= sampleRate) {
				return await fn();
			}
			const recordedAt = new Date();
			const startPerf = performance.now();
			let ok = true;
			let errorCode: string | null = null;
			try {
				return await fn();
			} catch (err) {
				ok = false;
				errorCode = err instanceof Error ? err.constructor.name : "unknown";
				throw err;
			} finally {
				try {
					this.telemetrySink?.writeHookEvent({
						extensionName,
						hookName,
						durationMs: Math.round(performance.now() - startPerf),
						ok,
						errorCode,
						sampleRate,
						recordedAt,
					});
				} catch {
					// Telemetry never destabilizes hook dispatch.
				}
			}
		});
	}

	/**
	 * Single chokepoint for slash command dispatch. All modes (interactive /
	 * print / rpc / acp) funnel through agent-session._tryExecuteExtensionCommand,
	 * which calls this method. The wrapper measures wall-clock duration,
	 * captures outcome (ok / error / cancelled), and emits one telemetry row
	 * per invocation. Errors are still routed through emitError() so existing
	 * UI surfaces (toasts, logs) keep working unchanged.
	 *
	 * Returns `{ found: false }` when no extension owns the command, letting
	 * the caller fall through to built-in command handling without emitting a
	 * telemetry row for an unknown command.
	 */
	async invokeCommand(
		commandName: string,
		args: string,
		ctx: ExtensionCommandContext,
		metadata?: { sessionId?: string | null; runId?: string | null; variant?: string | null },
	): Promise<{ found: boolean }> {
		const command = this.getCommand(commandName);
		if (!command) return { found: false };

		const ownerExt = this.findCommandOwner(commandName);
		const extensionName = ownerExt ? this.deriveExtensionName(ownerExt) : "unknown";
		const startedAt = new Date();
		const startPerf = performance.now();
		let outcome: CommandOutcome = "ok";
		let errorCode: string | null = null;
		let thrown: unknown;

		const argsSig = classifyArgsSignature(args);
		const callerCtx: ExtCallerContext = {
			extensionName,
			callerContext: argsSig === "no-args" ? `command:/${commandName}` : `command:/${commandName} ${argsSig}`,
			isUserInitiated: true,
			sessionId: metadata?.sessionId ?? null,
			runId: metadata?.runId ?? null,
			variant: metadata?.variant ?? null,
		};
		try {
			await runWithExtCallerContext(callerCtx, () => command.handler(args, ctx));
		} catch (err) {
			outcome = "error";
			errorCode = err instanceof Error ? err.constructor.name : "unknown";
			thrown = err;
			this.emitError({
				extensionPath: `command:${commandName}`,
				event: "command",
				error: err instanceof Error ? err.message : String(err),
			});
		}

		const durationMs = Math.round(performance.now() - startPerf);
		const endedAt = new Date();

		try {
			this.telemetrySink?.writeCommandEvent({
				extensionName,
				commandName,
				argsSignature: argsSig,
				argsLength: args.length,
				outcome,
				errorCode,
				durationMs,
				startedAt,
				endedAt,
				sessionId: metadata?.sessionId ?? null,
				runId: metadata?.runId ?? null,
				variant: metadata?.variant ?? null,
			});
		} catch {
			// Sink emission must never bring down command dispatch.
		}

		// Even though we logged the error to telemetry + emitError, callers
		// expecting the thrown error (e.g. AgentSession previously re-caught it
		// silently) won't see it. This matches the original behaviour: the old
		// _tryExecuteExtensionCommand swallowed the error after emitError too.
		void thrown;
		return { found: true };
	}

	/**
	 * Request a graceful shutdown. Called by extension tools and event handlers.
	 * The actual shutdown behavior is provided by the mode via bindExtensions().
	 */
	shutdown(): void {
		this.shutdownHandler();
	}

	/**
	 * Create an ExtensionContext for use in event handlers and tool execution.
	 * Context values are resolved at call time, so changes via bindCore/bindUI are reflected.
	 */
	createContext(): ExtensionContext {
		const getModel = this.getModel;
		return {
			ui: this.uiContext,
			hasUI: this.hasUI(),
			cwd: this.cwd,
			agentDir: this.agentDir,
			sessionManager: this.sessionManager,
			modelRegistry: this.modelRegistry,
			get model() {
				return getModel();
			},
			completeSimple: (systemPrompt: string, userMessage: string) =>
				this.completeSimpleFn(systemPrompt, userMessage),
			completeSimpleWithUsage: (systemPrompt: string, userMessage: string) =>
				this.completeSimpleWithUsageFn(systemPrompt, userMessage),
			completeJson: this.completeJsonFn
				? (systemPrompt, userMessage, schema, options) =>
						this.completeJsonFn!(systemPrompt, userMessage, schema, options)
				: undefined,
			isIdle: () => this.isIdleFn(),
			abort: () => this.abortFn(),
			hasPendingMessages: () => this.hasPendingMessagesFn(),
			shutdown: () => this.shutdownHandler(),
			getContextUsage: () => this.getContextUsageFn(),
			compact: (options) => this.compactFn(options),
			getSystemPrompt: () => this.getSystemPromptFn(),
			getSoulManager: () => this.getSoulManagerFn(),
			getSettings: () => this.getSettingsFn(),
			getSkills: () => this.getSkillsFn(),
		};
	}

	createCommandContext(): ExtensionCommandContext {
		return {
			...this.createContext(),
			waitForIdle: () => this.waitForIdleFn(),
			newSession: (options) => this.newSessionHandler(options),
			fork: (entryId) => this.forkHandler(entryId),
			navigateTree: (targetId, options) => this.navigateTreeHandler(targetId, options),
			switchSession: (sessionPath) => this.switchSessionHandler(sessionPath),
			reload: () => this.reloadHandler(),
		};
	}

	private isSessionBeforeEvent(event: RunnerEmitEvent): event is SessionBeforeEvent {
		return (
			event.type === "session_before_switch" ||
			event.type === "session_before_fork" ||
			event.type === "session_before_compact" ||
			event.type === "session_before_tree"
		);
	}

	async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>> {
		const ctx = this.createContext();
		let result: SessionBeforeEventResult | undefined;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(event.type);
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const handlerResult = await this.invokeHookHandler(ext, event.type, () => handler(event, ctx));

					if (this.isSessionBeforeEvent(event) && handlerResult) {
						result = handlerResult as SessionBeforeEventResult;
						if (result.cancel) {
							return result as RunnerEmitResult<TEvent>;
						}
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: event.type,
						error: message,
						stack,
					});
				}
			}
		}

		return result as RunnerEmitResult<TEvent>;
	}

	async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
		const ctx = this.createContext();
		const currentEvent: ToolResultEvent = { ...event };
		let modified = false;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("tool_result");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const handlerResult = (await this.invokeHookHandler(ext, "tool_result", () => handler(currentEvent, ctx))) as ToolResultEventResult | undefined;
					if (!handlerResult) continue;

					if (handlerResult.content !== undefined) {
						currentEvent.content = handlerResult.content;
						modified = true;
					}
					if (handlerResult.details !== undefined) {
						currentEvent.details = handlerResult.details;
						modified = true;
					}
					if (handlerResult.isError !== undefined) {
						currentEvent.isError = handlerResult.isError;
						modified = true;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: "tool_result",
						error: message,
						stack,
					});
				}
			}
		}

		if (!modified) {
			return undefined;
		}

		return {
			content: currentEvent.content,
			details: currentEvent.details,
			isError: currentEvent.isError,
		};
	}

	async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
		const ctx = this.createContext();
		let result: ToolCallEventResult | undefined;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("tool_call");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				const handlerResult = await this.invokeHookHandler(ext, "tool_call", () => handler(event, ctx));

				if (handlerResult) {
					result = handlerResult as ToolCallEventResult;
					if (result.block) {
						return result;
					}
				}
			}
		}

		return result;
	}

	async emitUserBash(event: UserBashEvent): Promise<UserBashEventResult | undefined> {
		const ctx = this.createContext();

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("user_bash");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const handlerResult = await this.invokeHookHandler(ext, "user_bash", () => handler(event, ctx));
					if (handlerResult) {
						return handlerResult as UserBashEventResult;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: "user_bash",
						error: message,
						stack,
					});
				}
			}
		}

		return undefined;
	}

	async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		const ctx = this.createContext();
		let currentMessages = structuredClone(messages);

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("context");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const event: ContextEvent = { type: "context", messages: currentMessages };
					const handlerResult = await this.invokeHookHandler(ext, "context", () => handler(event, ctx));

					if (handlerResult && (handlerResult as ContextEventResult).messages) {
						currentMessages = (handlerResult as ContextEventResult).messages!;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: "context",
						error: message,
						stack,
					});
				}
			}
		}

		return currentMessages;
	}

	async emitBeforeAgentStart(
		prompt: string,
		images: ImageContent[] | undefined,
		systemPrompt: string,
	): Promise<BeforeAgentStartCombinedResult | undefined> {
		const ctx = this.createContext();
		const messages: NonNullable<BeforeAgentStartEventResult["message"]>[] = [];
		let currentSystemPrompt = systemPrompt;
		let systemPromptModified = false;

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("before_agent_start");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const event: BeforeAgentStartEvent = {
						type: "before_agent_start",
						prompt,
						images,
						systemPrompt: currentSystemPrompt,
					};
					const handlerResult = await this.withTimeout(
						this.invokeHookHandler(ext, "before_agent_start", () => handler(event, ctx)),
						this.beforeAgentStartTimeoutMs,
					);
					if (handlerResult === this.beforeAgentStartTimeoutSentinel) {
						this.reportBeforeAgentStartTimeout(ext.path);
						continue;
					}

					if (handlerResult) {
						const result = handlerResult as BeforeAgentStartEventResult;
						if (result.message) {
							messages.push(result.message);
						}
						if (result.systemPrompt !== undefined) {
							currentSystemPrompt = result.systemPrompt;
							systemPromptModified = true;
						}
						if (result.appendSystemPrompt !== undefined) {
							currentSystemPrompt = this.appendSystemPrompt(
								currentSystemPrompt,
								result.appendSystemPrompt,
							);
							systemPromptModified = true;
						}
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: "before_agent_start",
						error: message,
						stack,
					});
				}
			}
		}

		if (messages.length > 0 || systemPromptModified) {
			return {
				messages: messages.length > 0 ? messages : undefined,
				systemPrompt: systemPromptModified ? currentSystemPrompt : undefined,
			};
		}

		return undefined;
	}

	private appendSystemPrompt(base: string, addition: string): string {
		const normalized = addition.trim();
		if (!normalized) return base;
		return `${base}\n\n${normalized}`;
	}

	async emitResourcesDiscover(
		cwd: string,
		reason: ResourcesDiscoverEvent["reason"],
	): Promise<{
		skillPaths: Array<{ path: string; extensionPath: string }>;
		promptPaths: Array<{ path: string; extensionPath: string }>;
		themePaths: Array<{ path: string; extensionPath: string }>;
	}> {
		const ctx = this.createContext();
		const skillPaths: Array<{ path: string; extensionPath: string }> = [];
		const promptPaths: Array<{ path: string; extensionPath: string }> = [];
		const themePaths: Array<{ path: string; extensionPath: string }> = [];

		for (const ext of this.extensions) {
			const handlers = ext.handlers.get("resources_discover");
			if (!handlers || handlers.length === 0) continue;

			for (const handler of handlers) {
				try {
					const event: ResourcesDiscoverEvent = { type: "resources_discover", cwd, reason };
					const handlerResult = await this.invokeHookHandler(ext, "resources_discover", () => handler(event, ctx));
					const result = handlerResult as ResourcesDiscoverResult | undefined;

					if (result?.skillPaths?.length) {
						skillPaths.push(...result.skillPaths.map((path) => ({ path, extensionPath: ext.path })));
					}
					if (result?.promptPaths?.length) {
						promptPaths.push(...result.promptPaths.map((path) => ({ path, extensionPath: ext.path })));
					}
					if (result?.themePaths?.length) {
						themePaths.push(...result.themePaths.map((path) => ({ path, extensionPath: ext.path })));
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({
						extensionPath: ext.path,
						event: "resources_discover",
						error: message,
						stack,
					});
				}
			}
		}

		return { skillPaths, promptPaths, themePaths };
	}

	/** Emit input event. Transforms chain, "handled" short-circuits. */
	async emitInput(text: string, images: ImageContent[] | undefined, source: InputSource): Promise<InputEventResult> {
		const ctx = this.createContext();
		let currentText = text;
		let currentImages = images;

		for (const ext of this.extensions) {
			for (const handler of ext.handlers.get("input") ?? []) {
				try {
					const event: InputEvent = { type: "input", text: currentText, images: currentImages, source };
					const result = (await this.invokeHookHandler(ext, "input", () => handler(event, ctx))) as InputEventResult | undefined;
					if (result?.action === "handled") return result;
					if (result?.action === "transform") {
						currentText = result.text;
						currentImages = result.images ?? currentImages;
					}
				} catch (err) {
					this.emitError({
						extensionPath: ext.path,
						event: "input",
						error: err instanceof Error ? err.message : String(err),
						stack: err instanceof Error ? err.stack : undefined,
					});
				}
			}
		}
		return currentText !== text || currentImages !== images
			? { action: "transform", text: currentText, images: currentImages }
			: { action: "continue" };
	}
}
