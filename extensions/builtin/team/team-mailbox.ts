/**
 * [WHO]: TeamMailbox, MailboxMessage, MailboxMessageType, MailboxDirection
 * [FROM]: No external deps
 * [TO]: Consumed by team-runtime.ts, index.ts
 * [HERE]: extensions/builtin/team/team-mailbox.ts - Phase B B.3 mailbox protocol
 *
 * Per refactor plan §B.3: mailbox is the single channel between the leader
 * and teammates; no direct callbacks are allowed. The implementation is a
 * typed append-only log with subscribe() for live observers and JSONL-backed
 * replay across restarts.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type MailboxMessageType =
	| "task_request"
	| "task_progress"
	| "task_result"
	| "permission_request"
	| "permission_response"
	| "plan_approval_request"
	| "plan_approval_response"
	| "teammate_message"
	| "handoff"
	| "task_claim"
	| "task_update"
	| "mode_change"
	| "shutdown_request"
	| "shutdown_ack";

export type MailboxDirection = "leader_to_teammate" | "teammate_to_leader" | "teammate_to_teammate";

export interface MailboxMessage {
	id: string;
	teammateId: string;
	teammateName: string;
	targetTeammateId?: string;
	targetTeammateName?: string;
	type: MailboxMessageType;
	direction: MailboxDirection;
	payload: Record<string, unknown>;
	timestamp: number;
}

export type MailboxListener = (message: MailboxMessage) => void;

/**
 * Append-only typed mailbox shared by all teammates. Bounded by
 * `maxMessages` to prevent unbounded growth in long-lived sessions; oldest
 * messages drop first.
 */
export class TeamMailbox {
	private messages: MailboxMessage[] = [];
	private listeners: Set<MailboxListener> = new Set();
	private readonly maxMessages: number;
	private readonly filePath?: string;

	constructor(maxMessages = 1000, filePath?: string) {
		this.maxMessages = maxMessages;
		this.filePath = filePath;
	}

	/** Load persisted JSONL messages. Corrupt lines are ignored. */
	async load(): Promise<void> {
		if (!this.filePath) return;
		try {
			const raw = await readFile(this.filePath, "utf-8");
			const loaded: MailboxMessage[] = [];
			for (const line of raw.split("\n")) {
				if (!line.trim()) continue;
				try {
					const parsed = JSON.parse(line) as MailboxMessage;
					if (parsed?.id && parsed?.type) loaded.push(parsed);
				} catch {
					// Ignore corrupt lines; mailbox replay should not block startup.
				}
			}
			this.messages = loaded.slice(-this.maxMessages);
		} catch {
			this.messages = [];
		}
	}

	/** Post a new message and notify listeners. */
	post(message: Omit<MailboxMessage, "id" | "timestamp">): MailboxMessage {
		const full: MailboxMessage = {
			...message,
			id: crypto.randomUUID(),
			timestamp: Date.now(),
		};
		this.messages.push(full);
		if (this.messages.length > this.maxMessages) {
			this.messages.splice(0, this.messages.length - this.maxMessages);
		}
		void this.persist();
		for (const listener of this.listeners) {
			try {
				listener(full);
			} catch {
				// Listener errors must not poison the mailbox.
			}
		}
		return full;
	}

	/** All messages, optionally filtered by teammate id. */
	list(teammateId?: string): MailboxMessage[] {
		if (!teammateId) return [...this.messages];
		return this.messages.filter((m) => m.teammateId === teammateId || m.targetTeammateId === teammateId);
	}

	/** Subscribe to live mailbox events. Returns an unsubscribe handle. */
	subscribe(listener: MailboxListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Drop all messages owned by a teammate (called on terminate). */
	clearTeammate(teammateId: string): void {
		this.messages = this.messages.filter((m) => m.teammateId !== teammateId && m.targetTeammateId !== teammateId);
		void this.persist();
	}

	private async persist(): Promise<void> {
		if (!this.filePath) return;
		try {
			await mkdir(dirname(this.filePath), { recursive: true });
			const body = this.messages.map((message) => JSON.stringify(message)).join("\n");
			await writeFile(this.filePath, body ? `${body}\n` : "", "utf-8");
		} catch {
			// Mailbox persistence is best-effort; live routing remains authoritative.
		}
	}

	/** Remove persisted mailbox data. Intended for tests and full team reset flows. */
	async clearAll(): Promise<void> {
		this.messages = [];
		if (!this.filePath) return;
		await rm(this.filePath, { force: true }).catch(() => {});
	}
}
