/**
 * [WHO]: Provides EvalVariant, EvalEventType, EvalEventEnvelope, EvalSink, CreateEvalSinkOptions, EvalAdapterId, createEvalEvent
 * [FROM]: Depends on node:crypto for randomUUID
 * [TO]: Consumed by extensions/defaults/sal/eval/{insforge,jsonl,noop}-sink.ts and eval/index.ts factory; re-exported by eval/index.ts barrel
 * [HERE]: extensions/defaults/sal/eval/types.ts - transport-agnostic event types and the EvalSink contract; concrete adapters live in sibling files
 */

import { randomUUID } from "node:crypto";

// ----------------------------------------------------------------------------
// Event domain
// ----------------------------------------------------------------------------

export type EvalVariant = "sal" | "control" | "baseline" | "self-diagnosis";

export type EvalEventType = "run_start" | "run_end" | "turn_anchor" | "memory_recalls" | "tool_trace";

/** Wire format for eval events. Adapter implementations decide how to materialize. */
export interface EvalEventEnvelope {
	run_id: string;
	event_id: string;
	event_type: EvalEventType;
	variant: EvalVariant;
	ts: string;
	payload: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Sink contract
// ----------------------------------------------------------------------------

export interface EvalSink {
	readonly enabled: boolean;
	sendEvent(event: EvalEventEnvelope): Promise<void>;
	flush(): Promise<void>;
	close(): Promise<void>;
}

// ----------------------------------------------------------------------------
// Factory options
// ----------------------------------------------------------------------------

/** Adapter selector. When omitted, the factory infers from endpoint shape. */
export type EvalAdapterId = "insforge" | "jsonl" | "noop";

export interface CreateEvalSinkOptions {
	enabled: boolean;
	/** Explicit adapter selection. When omitted, inferred from endpoint scheme. */
	adapter?: EvalAdapterId;
	/**
	 * Adapter-dependent destination:
	 * - insforge: HTTPS URL like `https://app.region.insforge.app`
	 * - jsonl:   Filesystem path or `file://` URL
	 */
	endpoint?: string;
	runId: string;
	/** Custom headers passed through to HTTP adapters. */
	headers?: Record<string, string>;
	/** Ingestion key (ik_…) — InsForge: sent as x-api-key header. */
	apiKey?: string;
	apiKeyHeader?: string;
	/** Anon/JWT key — InsForge PostgREST auth: sent as apikey + Authorization: Bearer. */
	anonKey?: string;
	/** Skip TLS certificate verification (self-signed / private CA). */
	allowSelfSigned?: boolean;
	/** Flush interval ms (default 2000). */
	batchIntervalMs?: number;
	/** Optional extension-owned diagnostic publisher. Eval sinks must not import UI or reporter code. */
	onDiagnostic?: (event: {
		source: string;
		severity: "debug" | "info" | "warning" | "error";
		category: "network" | "fallback" | "persistence" | "config" | "extension_timeout" | "schema" | "unknown";
		message: string;
		detail?: unknown;
		fingerprint?: string;
		context?: Record<string, unknown>;
	}) => void;
}

// ----------------------------------------------------------------------------
// Event constructor
// ----------------------------------------------------------------------------

export function createEvalEvent(
	eventType: EvalEventType,
	runId: string,
	variant: EvalVariant,
	payload: Record<string, unknown>,
	metadata: Record<string, unknown> = {},
): EvalEventEnvelope {
	return {
		run_id: runId,
		event_id: randomUUID(),
		event_type: eventType,
		variant,
		ts: new Date().toISOString(),
		payload,
		metadata,
	};
}
