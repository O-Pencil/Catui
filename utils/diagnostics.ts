/**
 * [WHO]: Provides DiagnosticEvent types, reportDiagnostic(), subscribeDiagnostics(), isDevRuntime()
 * [FROM]: Depends only on node:events and node built-ins
 * [TO]: Imported by repo-root code (extensions/, core/, modes/) for unified background-failure reporting; mirrored by tiny shells in standalone packages (e.g. packages/mem-core/src/diagnostics.ts) that share the same Symbol.for slot at runtime
 * [HERE]: utils/diagnostics.ts - canonical diagnostic bus; explicit dev/debug mode prints to console, every mode emits to the in-process bus where the diagnostics extension subscribes and auto-uploads
 *
 * Cross-compile-boundary sharing: independent packages compile their own copy of
 * a thin shell, but every copy resolves the same `Symbol.for(...)` slot on
 * globalThis at runtime, so all reportDiagnostic() calls flow through one bus.
 */

import { EventEmitter } from "node:events";

export type DiagnosticSeverity = "debug" | "info" | "warning" | "error";

export type DiagnosticCategory =
	| "network"
	| "fallback"
	| "persistence"
	| "config"
	| "extension_timeout"
	| "schema"
	| "unknown";

export interface DiagnosticEvent {
	source: string;
	severity: DiagnosticSeverity;
	category: DiagnosticCategory;
	message: string;
	detail?: unknown;
	fingerprint?: string;
	context?: Record<string, unknown>;
}

interface BusSlot {
	bus: EventEmitter;
	queue: DiagnosticEvent[];
}

const SLOT_KEY = Symbol.for("nanopencil.diagnostic.bus.v1");
const QUEUE_LIMIT = 100;
const CHANNEL = "diagnostic:event";

function getSlot(): BusSlot {
	const holder = globalThis as unknown as Record<symbol, BusSlot | undefined>;
	let slot = holder[SLOT_KEY];
	if (!slot) {
		slot = { bus: new EventEmitter(), queue: [] };
		holder[SLOT_KEY] = slot;
	}
	return slot;
}

/**
 * Unified dev-mode predicate. True only for explicit developer intent:
 * - NODE_ENV=development, OR
 * - npm_lifecycle_event is "dev" or "test", OR
 * - NANOPENCIL_DEBUG is truthy.
 *
 * Always false when NODE_ENV=production.
 */
export function isDevRuntime(): boolean {
	if (process.env.NODE_ENV === "production") return false;
	if (process.env.NODE_ENV === "development") return true;
	const lifecycle = process.env.npm_lifecycle_event;
	if (lifecycle === "dev" || lifecycle === "test") return true;
	if (["1", "true", "yes", "on"].includes((process.env.NANOPENCIL_DEBUG ?? "").toLowerCase())) return true;
	return false;
}

export function reportDiagnostic(event: DiagnosticEvent): void {
	if (isDevRuntime()) {
		const tag = `[${event.source}]`;
		const fn =
			event.severity === "error" ? console.error :
			event.severity === "warning" ? console.warn :
			console.log;
		if (event.detail !== undefined) {
			fn(`${tag} ${event.message}`, event.detail);
		} else {
			fn(`${tag} ${event.message}`);
		}
	}
	const slot = getSlot();
	if (slot.bus.listenerCount(CHANNEL) > 0) {
		slot.bus.emit(CHANNEL, event);
	} else if (slot.queue.length < QUEUE_LIMIT) {
		slot.queue.push(event);
	}
}

/**
 * Subscribe to all diagnostic events, including those queued before the first
 * subscriber attached. Returns an unsubscribe function. Typically called once
 * by the diagnostics extension on load.
 */
export function subscribeDiagnostics(handler: (event: DiagnosticEvent) => void): () => void {
	const slot = getSlot();
	slot.bus.on(CHANNEL, handler);
	while (slot.queue.length > 0) {
		const ev = slot.queue.shift()!;
		try { handler(ev); } catch { /* ignore handler errors */ }
	}
	return () => {
		slot.bus.off(CHANNEL, handler);
	};
}
