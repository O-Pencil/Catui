/**
 * [WHO]: EventBus, EventBusController, createEventBus()
 * [FROM]: Depends on node:events
 * [TO]: Consumed by index.ts, core/extensions-host/loader.ts, extensions/builtin/loop/index.ts
 * [HERE]: core/runtime/event-bus.ts - typed event emission system
 */
import { EventEmitter } from "node:events";

export interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface EventBusController extends EventBus {
	clear(): void;
}

export function createEventBus(): EventBusController {
	const emitter = new EventEmitter();
	return {
		emit: (channel, data) => {
			emitter.emit(channel, data);
		},
		on: (channel, handler) => {
			const safeHandler = async (data: unknown) => {
				try {
					await handler(data);
				} catch (err) {
					// Emit internal error event for user subscription
					emitter.emit("eventbus:handler-error", { channel, error: err });
				}
			};
			emitter.on(channel, safeHandler);
			return () => emitter.off(channel, safeHandler);
		},
		clear: () => {
			emitter.removeAllListeners();
		},
	};
}
