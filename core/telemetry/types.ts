/**
 * [WHO]: Provides TelemetryDiagnostic event shape, DiagnosticHandler callback, InsforgeHttpResult, PostJsonOptions — shared types for all telemetry sinks
 * [FROM]: No internal deps; only TypeScript-level type primitives
 * [TO]: Consumed by core/telemetry/credentials.ts, insforge-base.ts, batching-dispatcher.ts; mirrored by sinks (SAL eval, future extension telemetry)
 * [HERE]: core/telemetry/types.ts - foundational type surface for the telemetry layer; identical diagnostic shape to SAL's onDiagnostic so SAL can adopt without callsite churn
 */

/**
 * Diagnostic event emitted by any telemetry component. The shape is intentionally
 * identical to SAL's eval onDiagnostic signature so SAL adopts the base layer
 * without changing any of its existing diagnostic handlers.
 */
export interface TelemetryDiagnostic {
	source: string;
	severity: "debug" | "info" | "warning" | "error";
	category: "network" | "fallback" | "persistence" | "config" | "extension_timeout" | "schema" | "unknown";
	message: string;
	detail?: unknown;
	fingerprint?: string;
	context?: Record<string, unknown>;
}

export type DiagnosticHandler = (event: TelemetryDiagnostic) => void;

export interface InsforgeHttpResult {
	ok: boolean;
	statusCode?: number;
	body?: string;
	errorCode?: string;
}

export interface PostJsonOptions {
	/** PostgREST Prefer header. e.g. "resolution=merge-duplicates". */
	prefer?: string;
	/** Error codes (e.g. "PGRST204") to suppress from onDiagnostic. */
	quietErrorCodes?: string[];
}
