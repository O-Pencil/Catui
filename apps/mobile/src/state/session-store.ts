/**
 * [WHO]: Provides useSessionStore and the session mirror state/actions (messages, commands, sessions, models, dialogs, widgets, toasts)
 * [FROM]: Depends on zustand, src/protocol/client, src/protocol/types
 * [TO]: Consumed by src/state/wiring.ts, src/views/* (ChatView, Transcript, SessionDrawer, ModelSheet, ExtensionDialog, Composer, Toaster)
 * [HERE]: apps/mobile/src/state/session-store.ts - mobile-side mirror of the agent session: hydrated by get_state/get_messages/get_commands snapshots, kept live by the broadcast AgentEvent stream; reconnects resync from snapshots and missed deltas self-heal at message_end/tool_execution_end boundaries (they carry full payloads)
 */
import { create } from "zustand";
import { remoteClient, type ConnectionStatus } from "../protocol/client";
import type {
	AgentMessage,
	ModelInfo,
	RpcExtensionUIRequest,
	RpcResponse,
	RpcServerMessage,
	RpcSessionListEntry,
	RpcSessionState,
	RpcSlashCommand,
	ThinkingLevel,
} from "../protocol/types";

export interface Toast {
	id: number;
	message: string;
	kind: "info" | "warning" | "error";
}

/** Dialog requests that need an interactive answer (select/confirm/input/editor). */
export type PendingDialog = Extract<
	RpcExtensionUIRequest,
	{ method: "select" | "confirm" | "input" | "editor" | "openExternalEditor" }
>;

/** Per-endpoint pairing probe result (healthz fetch distinguishes network vs token failures). */
export interface PairingProbe {
	endpoint: string;
	status: "ok" | "badToken" | "unreachable";
	detail?: string;
}

interface SessionStore {
	status: ConnectionStatus;
	statusDetail?: string;
	/** True when the current target never reached "connected" (stale token / wrong address). */
	connectFailed: boolean;
	/** Pairing-failure diagnostics: one probe per candidate endpoint, run automatically on failure. */
	pairingProbes: PairingProbe[];
	probesState: "idle" | "running" | "done";
	state: RpcSessionState | null;
	/** Transcript messages (user/assistant/toolResult; custom messages filtered). */
	messages: AgentMessage[];
	commands: RpcSlashCommand[];
	sessions: RpcSessionListEntry[];
	models: ModelInfo[];
	dialogs: PendingDialog[];
	widgets: Record<string, string[] | undefined>;
	toasts: Toast[];
	/** Bump to scroll transcript to bottom. */
	scrollSignal: number;
	/** One-shot composer prefill set by set_editor_text requests. */
	editorPrefill?: string;

	setStatus(status: ConnectionStatus, detail?: string): void;
	handleServerMessage(message: RpcServerMessage): void;
	resync(): Promise<void>;
	refreshSessions(): Promise<void>;
	refreshModels(): Promise<void>;
	sendPrompt(text: string): Promise<void>;
	steer(text: string): Promise<void>;
	followUp(text: string): Promise<void>;
	abort(): Promise<void>;
	switchSession(sessionPath: string): Promise<void>;
	newSession(): Promise<void>;
	setModel(provider: string, modelId: string): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): Promise<void>;
	answerDialog(id: string, answer: { value?: string; confirmed?: boolean; cancelled?: true }): void;
	consumeEditorPrefill(): string | undefined;
	dismissToast(id: number): void;
}

function isTranscriptMessage(message: AgentMessage): boolean {
	return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

/** Upsert by timestamp (streaming events reuse the message timestamp). */
function upsertMessage(messages: AgentMessage[], incoming: AgentMessage): AgentMessage[] {
	const index = messages.findIndex((m) => m.timestamp === incoming.timestamp && m.role === incoming.role);
	if (index === -1) {
		return [...messages, incoming];
	}
	const next = messages.slice();
	next[index] = incoming;
	return next;
}

let toastId = 1;

export const useSessionStore = create<SessionStore>()((set, get) => ({
	status: "idle",
	connectFailed: false,
	pairingProbes: [],
	probesState: "idle",
	state: null,
	messages: [],
	commands: [],
	sessions: [],
	models: [],
	dialogs: [],
	widgets: {},
	toasts: [],
	scrollSignal: 0,

	setStatus: (status, detail) => set({ status, statusDetail: detail }),

	handleServerMessage: (message) => {
		switch (message.type) {
			case "extension_ui_request": {
				if (message.method === "notify") {
					set((s) => ({
						toasts: [
							...s.toasts,
							{ id: toastId++, message: message.message, kind: message.notifyType ?? "info" },
						],
					}));
					return;
				}
				if (message.method === "setStatus" || message.method === "setWidget") {
					const key = message.method === "setStatus" ? message.statusKey : message.widgetKey;
					const lines = message.method === "setStatus"
						? (message.statusText ? [message.statusText] : undefined)
						: message.widgetLines;
					set((s) => ({ widgets: { ...s.widgets, [key]: lines } }));
					return;
				}
				if (message.method === "setTitle") {
					document.title = message.title;
					return;
				}
				if (message.method === "set_editor_text") {
					set({ editorPrefill: message.text });
					return;
				}
				// Interactive dialogs queue up; oldest renders first (server keeps its own timeout)
				set((s) => ({ dialogs: [...s.dialogs, message] }));
				return;
			}

			case "extension_error": {
				set((s) => ({
					toasts: [
						...s.toasts,
						{ id: toastId++, message: `Extension error (${message.event}): ${message.error}`, kind: "error" },
					],
				}));
				return;
			}

			case "message_start":
			case "message_update":
			case "message_end": {
				if (!isTranscriptMessage(message.message)) return;
				set((s) => ({
					messages: upsertMessage(s.messages, message.message),
					scrollSignal: s.scrollSignal + 1,
				}));
				return;
			}

			case "session_state_changed": {
				// Cheap local phase tracking; full state refresh happens at boundaries
				set((s) => ({
					state: s.state
						? { ...s.state, isStreaming: message.state === "running", isCompacting: message.state === "compacting" }
						: s.state,
				}));
				return;
			}

			case "agent_result":
			case "agent_end": {
				void get().resync();
				return;
			}

			case "auto_compaction_start": {
				set((s) => ({
					toasts: [...s.toasts, { id: toastId++, message: "Compacting context…", kind: "info" }],
				}));
				return;
			}

			case "sdk:mcp_ready": {
				set((s) => ({
					toasts: [...s.toasts, { id: toastId++, message: `MCP ready (${message.toolCount} tools)`, kind: "info" }],
				}));
				return;
			}

			case "response": {
				// Snapshot responses that arrive outside resync() (rare) — no-op for MVP
				return;
			}

			default:
				return;
		}
	},

	resync: async () => {
		if (!remoteClient.connected) return;
		const [stateResponse, messagesResponse, commandsResponse] = await Promise.allSettled([
			remoteClient.send({ type: "get_state" }),
			remoteClient.send({ type: "get_messages" }),
			remoteClient.send({ type: "get_commands" }),
		]);
		const patch: {
			state?: RpcSessionState;
			messages?: AgentMessage[];
			commands?: RpcSlashCommand[];
			scrollSignal?: number;
		} = {};
		if (stateResponse.status === "fulfilled" && stateResponse.value.success) {
			patch.state = (stateResponse.value.data as RpcSessionState | undefined) ?? undefined;
		}
		if (messagesResponse.status === "fulfilled" && messagesResponse.value.success) {
			const data = messagesResponse.value.data as { messages?: AgentMessage[] } | undefined;
			patch.messages = (data?.messages ?? []).filter(isTranscriptMessage);
			patch.scrollSignal = get().scrollSignal + 1;
		}
		if (commandsResponse.status === "fulfilled" && commandsResponse.value.success) {
			const data = commandsResponse.value.data as { commands?: RpcSlashCommand[] } | undefined;
			patch.commands = data?.commands ?? [];
		}
		if (Object.keys(patch).length > 0) {
			set(patch);
		}
	},

	refreshSessions: async () => {
		try {
			const response = await remoteClient.send<RpcResponse & { data?: { sessions: RpcSessionListEntry[] } }>({
				type: "list_sessions",
			});
			if (response.success) {
				set({ sessions: response.data?.sessions ?? [] });
			}
		} catch {
			// disconnected mid-request; drawer shows stale list
		}
	},

	refreshModels: async () => {
		try {
			const response = await remoteClient.send<RpcResponse & { data?: { models: ModelInfo[] } }>({
				type: "get_available_models",
			});
			if (response.success) {
				set({ models: response.data?.models ?? [] });
			}
		} catch {
			// ignore
		}
	},

	sendPrompt: async (text) => {
		try {
			await remoteClient.send({ type: "prompt", message: text });
		} catch (e) {
			set((s) => ({
				toasts: [...s.toasts, { id: toastId++, message: `Send failed: ${(e as Error).message}`, kind: "error" }],
			}));
		}
	},

	steer: async (text) => {
		try {
			await remoteClient.send({ type: "steer", message: text });
		} catch {
			// ignore
		}
	},

	followUp: async (text) => {
		try {
			await remoteClient.send({ type: "follow_up", message: text });
		} catch {
			// ignore
		}
	},

	abort: async () => {
		try {
			await remoteClient.send({ type: "abort" });
		} catch {
			// ignore
		}
	},

	switchSession: async (sessionPath) => {
		try {
			await remoteClient.send({ type: "switch_session", sessionPath });
			await get().resync();
			await get().refreshSessions();
		} catch (e) {
			set((s) => ({
				toasts: [...s.toasts, { id: toastId++, message: `Switch failed: ${(e as Error).message}`, kind: "error" }],
			}));
		}
	},

	newSession: async () => {
		try {
			await remoteClient.send({ type: "new_session" });
			set({ messages: [] });
			await get().resync();
			await get().refreshSessions();
		} catch (e) {
			set((s) => ({
				toasts: [...s.toasts, { id: toastId++, message: `New session failed: ${(e as Error).message}`, kind: "error" }],
			}));
		}
	},

	setModel: async (provider, modelId) => {
		try {
			await remoteClient.send({ type: "set_model", provider, modelId });
			await get().resync();
		} catch (e) {
			set((s) => ({
				toasts: [...s.toasts, { id: toastId++, message: `Model switch failed: ${(e as Error).message}`, kind: "error" }],
			}));
		}
	},

	setThinkingLevel: async (level) => {
		try {
			await remoteClient.send({ type: "set_thinking_level", level });
			await get().resync();
		} catch {
			// ignore
		}
	},

	answerDialog: (id, answer) => {
		set((s) => ({ dialogs: s.dialogs.filter((dialog) => dialog.id !== id) }));
		if (answer.cancelled) {
			remoteClient.sendRaw({ type: "extension_ui_response", id, cancelled: true });
		} else if (answer.confirmed !== undefined) {
			remoteClient.sendRaw({ type: "extension_ui_response", id, confirmed: answer.confirmed });
		} else if (answer.value !== undefined) {
			remoteClient.sendRaw({ type: "extension_ui_response", id, value: answer.value });
		}
	},

	consumeEditorPrefill: () => {
		const prefill = get().editorPrefill;
		if (prefill !== undefined) {
			set({ editorPrefill: undefined });
		}
		return prefill;
	},

	dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((toast) => toast.id !== id) })),
}));
