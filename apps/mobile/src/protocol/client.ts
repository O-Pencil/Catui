/**
 * [WHO]: Provides RemoteClient, remoteClient singleton, ConnectionStatus
 * [FROM]: Depends on src/protocol/types (type-only), global WebSocket
 * [TO]: Consumed by src/state/wiring.ts, src/state/session-store.ts (status via wiring)
 * [HERE]: apps/mobile/src/protocol/client.ts - WebSocket transport for the Catui RPC protocol: one JSON object per text frame (commands up, responses/events down), id correlation, multi-endpoint fallback rotation (initial pairing), exponential backoff reconnect (1s -> 30s), status transitions for store resync
 */
import type { RpcCommand, RpcExtensionUIResponse, RpcResponse, RpcServerMessage } from "./types";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected";

type MessageHandler = (message: RpcServerMessage) => void;
type StatusHandler = (status: ConnectionStatus, detail?: string) => void;

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** Omit that distributes over unions (plain Omit collapses union keys). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class RemoteClient {
	private ws: WebSocket | null = null;
	/** Candidate endpoints, best-first (primary + deep-link alternates). */
	private endpoints: string[] = [];
	private endpointIndex = 0;
	/** True once any endpoint has opened; stops first-pairing rotation after a live drop. */
	private everOpened = false;
	private token = "";
	private pending = new Map<string, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }>();
	private messageHandlers = new Set<MessageHandler>();
	private statusHandlers = new Set<StatusHandler>();
	private nextId = 1;
	private attempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private manualClose = false;

	get connected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	onMessage(handler: MessageHandler): () => void {
		this.messageHandlers.add(handler);
		return () => this.messageHandlers.delete(handler);
	}

	onStatus(handler: StatusHandler): () => void {
		this.statusHandlers.add(handler);
		return () => this.statusHandlers.delete(handler);
	}

	/**
	 * Connect with fallback rotation: try endpoints in order until one opens.
	 * Rotation only applies before the first successful open (initial pairing);
	 * later drops reconnect to the endpoint that worked.
	 */
	connect(endpoints: string[], token: string): void {
		this.endpoints = endpoints.filter(Boolean);
		this.endpointIndex = 0;
		this.everOpened = false;
		this.token = token;
		this.manualClose = false;
		this.clearReconnectTimer();
		this.open();
	}

	disconnect(): void {
		this.manualClose = true;
		this.clearReconnectTimer();
		for (const entry of this.pending.values()) {
			entry.reject(new Error("Disconnected"));
		}
		this.pending.clear();
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.emitStatus("idle");
	}

	/** Send a command; resolves with the matching response (check `success`). */
	send<T extends RpcResponse = RpcResponse>(command: DistributiveOmit<RpcCommand, "id">): Promise<T> {
		if (!this.connected) {
			return Promise.reject(new Error("Not connected"));
		}
		const id = `c${this.nextId++}`;
		const full = { ...command, id } as RpcCommand;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (response: RpcResponse) => void, reject });
			this.ws!.send(JSON.stringify(full));
		});
	}

	/** Send a frame without id correlation (extension UI responses). */
	sendRaw(message: RpcExtensionUIResponse): void {
		if (this.connected) {
			this.ws!.send(JSON.stringify(message));
		}
	}

	private open(): void {
		const endpoint = this.endpoints[this.endpointIndex];
		if (!endpoint) {
			// All candidates exhausted (or none given) — back off, then retry from the top.
			this.endpointIndex = 0;
			this.emitStatus("disconnected");
			this.scheduleReconnect();
			return;
		}
		this.emitStatus("connecting");
		const separator = endpoint.includes("?") ? "&" : "?";
		const url = `${endpoint}${separator}token=${encodeURIComponent(this.token)}`;
		const ws = new WebSocket(url);
		this.ws = ws;

		ws.onopen = () => {
			this.attempts = 0;
			this.everOpened = true;
			// Remember the endpoint that worked: move it to the front for reconnects.
			if (this.endpointIndex > 0) {
				const [working] = this.endpoints.splice(this.endpointIndex, 1);
				this.endpoints.unshift(working);
				this.endpointIndex = 0;
			}
			this.emitStatus("connected");
		};

		ws.onmessage = (event) => {
			let message: RpcServerMessage;
			try {
				message = JSON.parse(event.data as string);
			} catch {
				return;
			}
			// Route responses to their awaiting send() callers
			if (message.type === "response" && message.id && this.pending.has(message.id)) {
				const entry = this.pending.get(message.id)!;
				this.pending.delete(message.id);
				entry.resolve(message as RpcResponse);
				// Also fan out to stores (they may track commands generically)
			}
			for (const handler of this.messageHandlers) {
				handler(message);
			}
		};

		ws.onclose = () => {
			for (const entry of this.pending.values()) {
				entry.reject(new Error("Connection closed"));
			}
			this.pending.clear();
			if (this.ws === ws) {
				this.ws = null;
			}
			if (this.manualClose) {
				this.emitStatus("idle");
				return;
			}
			// Initial pairing never opened: try the next candidate endpoint immediately
			// (no backoff — this is host discovery, not flaky-network retry).
			if (!this.everOpened && this.endpointIndex < this.endpoints.length - 1) {
				this.endpointIndex += 1;
				this.open();
				return;
			}
			this.endpointIndex = 0; // next retry starts from the best candidate again
			this.emitStatus("disconnected");
			this.scheduleReconnect();
		};

		ws.onerror = () => {
			// onclose follows; nothing to do here
		};
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer !== null || this.manualClose) return;
		const delay = Math.min(RECONNECT_MIN_MS * 2 ** this.attempts, RECONNECT_MAX_MS);
		this.attempts += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.open();
		}, delay);
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private emitStatus(status: ConnectionStatus, detail?: string): void {
		for (const handler of this.statusHandlers) {
			handler(status, detail);
		}
	}
}

/** Module-level singleton shared by all stores/views. */
export const remoteClient = new RemoteClient();
