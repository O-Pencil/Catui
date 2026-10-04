/**
 * NotificationQueue - Priority-based notification system with auto-dismiss and dedup.
 * Renders up to 3 visible notifications at a time, newest first.
 * Each notification has a priority level that controls its auto-dismiss timeout.
 * Notifications with the same key replace each other (dedup).
 * [WHO]: NotificationPriority, NotificationType, NotificationOptions, NotificationQueue
 * [FROM]: @catui/tui
 * [TO]: Consumed by modes/interactive/components/index.ts, modes/interactive/controllers/status-display-controller.ts, modes/interactive/interactive-mode.ts
 * [HERE]: modes/interactive/components/notification-queue.ts - owned by modes/interactive/AGENT.md
 */


import { Container, Spacer, Text, type TUI } from "@catui/tui";
import type { Theme } from "../theme/theme.js";

export type NotificationPriority = "immediate" | "high" | "medium" | "low";
export type NotificationType = "info" | "warning" | "error";

export interface NotificationOptions {
	/** Dedup key — replacing existing notification with the same key. */
	key?: string;
	priority?: NotificationPriority;
	type?: NotificationType;
	/** Auto-dismiss timeout in ms. 0 = never auto-dismiss. Default based on priority. */
	duration?: number;
}

interface NotificationItem {
	key: string | undefined;
	message: string;
	priority: NotificationPriority;
	type: NotificationType;
	createdAt: number;
	timer: ReturnType<typeof setTimeout> | undefined;
}

/** Default auto-dismiss durations per priority (ms) */
const PRIORITY_DURATION: Record<NotificationPriority, number> = {
	immediate: 3000,
	high: 5000,
	medium: 8000,
	low: 12000,
};

/** Priority sort order (higher number = higher priority) */
const PRIORITY_ORDER: Record<NotificationPriority, number> = {
	immediate: 4,
	high: 3,
	medium: 2,
	low: 1,
};

const MAX_VISIBLE = 3;

export class NotificationQueue extends Container {
	private tui: TUI;
	private theme: Theme;
	private items: NotificationItem[] = [];
	private textComponents: Text[] = [];

	constructor(tui: TUI, theme: Theme) {
		super();
		this.tui = tui;
		this.theme = theme;

		// Pre-create text components for visible notifications
		for (let i = 0; i < MAX_VISIBLE; i++) {
			const text = new Text("", 0, 0);
			this.textComponents.push(text);
		}
		this.rebuildChildren();
	}

	/**
	 * Show a notification.
	 */
	notify(message: string, options?: NotificationOptions): void {
		const priority = options?.priority ?? "medium";
		const type = options?.type ?? "info";
		const key = options?.key;

		// Dedup: replace existing notification with same key
		if (key) {
			const existing = this.items.find((item) => item.key === key);
			if (existing) {
				if (existing.timer) clearTimeout(existing.timer);
				existing.message = message;
				existing.priority = priority;
				existing.type = type;
				existing.createdAt = Date.now();
				existing.timer = this.scheduleDismiss(existing);
				this.renderVisible();
				return;
			}
		}

		const item: NotificationItem = {
			key,
			message,
			priority,
			type,
			createdAt: Date.now(),
			timer: undefined,
		};

		// Schedule auto-dismiss
		const duration = options?.duration ?? PRIORITY_DURATION[priority];
		if (duration > 0) {
			item.timer = this.scheduleDismiss(item);
		}

		// Insert at front (newest first), sorted by priority within same timestamp
		this.items.unshift(item);

		// Trim old items (keep at most 20 in the queue)
		while (this.items.length > 20) {
			const removed = this.items.pop();
			if (removed?.timer) clearTimeout(removed.timer);
		}

		this.renderVisible();
	}

	private scheduleDismiss(item: NotificationItem): ReturnType<typeof setTimeout> {
		const duration = PRIORITY_DURATION[item.priority];
		return setTimeout(() => {
			this.removeItem(item);
		}, duration);
	}

	private removeItem(item: NotificationItem): void {
		if (item.timer) {
			clearTimeout(item.timer);
			item.timer = undefined;
		}
		const index = this.items.indexOf(item);
		if (index !== -1) {
			this.items.splice(index, 1);
		}
		this.renderVisible();
	}

	private renderVisible(): void {
		// Sort by priority (descending), then by timestamp (newest first)
		const sorted = [...this.items].sort((a, b) => {
			const pDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
			if (pDiff !== 0) return pDiff;
			return b.createdAt - a.createdAt;
		});

		const visible = sorted.slice(0, MAX_VISIBLE);

		for (let i = 0; i < MAX_VISIBLE; i++) {
			const textComp = this.textComponents[i]!;
			if (i < visible.length) {
				const item = visible[i]!;
				const prefix = this.getTypePrefix(item.type);
				const age = Math.floor((Date.now() - item.createdAt) / 1000);
				const suffix = age > 0 ? this.theme.fg("dim", ` ${age}s`) : "";
				textComp.setText(`${prefix} ${item.message}${suffix}`);
			} else {
				textComp.setText("");
			}
		}

		this.tui.requestRender();
	}

	private getTypePrefix(type: NotificationType): string {
		switch (type) {
			case "error":
				return this.theme.fg("error", "!");
			case "warning":
				return this.theme.fg("warning", "!");
			default:
				return this.theme.fg("accent", "i");
		}
	}

	private rebuildChildren(): void {
		this.clear();
		this.addChild(new Spacer(1));
		for (const text of this.textComponents) {
			this.addChild(text);
		}
	}

	/**
	 * Clear all notifications.
	 */
	clearAll(): void {
		for (const item of this.items) {
			if (item.timer) clearTimeout(item.timer);
		}
		this.items = [];
		this.renderVisible();
	}

	/**
	 * Get the number of active notifications.
	 */
	get count(): number {
		return this.items.length;
	}
}
