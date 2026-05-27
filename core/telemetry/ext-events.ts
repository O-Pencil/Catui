/**
 * [WHO]: Provides ExtensionTelemetrySink interface, CommandEventInput, classifyArgsSignature(), createExtensionTelemetrySink() factory (insforge-backed or noop)
 * [FROM]: Depends on ./insforge-base (InsforgeHttpClient), ./batching-dispatcher (BatchingDispatcher), ./credentials (loadInsforgeCredentials), ./build-meta (loadBuildMeta), ./types (DiagnosticHandler)
 * [TO]: Consumed by core/extensions/runner.ts (writes one row per /command invocation); future P2/P3 commits add LLM-call + hook-event sinks alongside this one
 * [HERE]: core/telemetry/ext-events.ts - P1 writer for ext_command_events table; one row per extension command invocation, batched + fire-and-forget, no-op when no insforge credentials configured
 */
import { BatchingDispatcher } from "./batching-dispatcher.js";
import { loadBuildMeta } from "./build-meta.js";
import { loadInsforgeCredentials, type InsforgeCredentialsBase } from "./credentials.js";
import { InsforgeHttpClient } from "./insforge-base.js";
import type { DiagnosticHandler } from "./types.js";

const BUILD_META = loadBuildMeta();
const TELEMETRY_SOURCE = "ext.telemetry";
const EXT_COMMAND_EVENTS_TABLE = "ext_command_events";
const EXT_LLM_CALLS_TABLE = "ext_llm_calls";
const EXT_HOOK_EVENTS_TABLE = "ext_hook_events";

/**
 * Sample rates per hook name. Tool-related hooks fire many times per turn
 * (one pair per tool call), so we record only 10% to avoid drowning the
 * table; the sample_rate column lets dashboards extrapolate counts with
 * `count(*) * (1.0 / avg(sample_rate))`. Everything else is rare enough
 * to record in full.
 */
export const HOOK_SAMPLE_RATES: Readonly<Record<string, number>> = Object.freeze({
	tool_call: 0.1,
	tool_result: 0.1,
	tool_execution_start: 0.1,
	tool_execution_end: 0.1,
});

export type CommandOutcome = "ok" | "error" | "cancelled" | "no_match" | "unknown";

export interface CommandEventInput {
	extensionName: string;
	commandName: string;
	/** Whitelisted-token-only classification — see classifyArgsSignature(). Never contains original arg text. */
	argsSignature: string;
	argsLength: number;
	outcome: CommandOutcome;
	errorCode?: string | null;
	durationMs: number;
	details?: Record<string, unknown> | null;
	startedAt: Date;
	endedAt: Date;
	runId?: string | null;
	sessionId?: string | null;
	variant?: string | null;
}

export interface HookEventInput {
	extensionName: string;
	hookName: string;
	durationMs: number;
	ok: boolean;
	errorCode?: string | null;
	/** Sampling probability used to decide whether to emit. Stored on each row so dashboards can extrapolate counts. */
	sampleRate: number;
	recordedAt: Date;
	runId?: string | null;
	sessionId?: string | null;
	variant?: string | null;
}

export interface LlmCallEventInput {
	extensionName: string;
	/** Short scope label, e.g. "command:/recap --smart" or "hook:before_agent_start". */
	callerContext: string;
	/** True for slash-command paths; false for hook auto-fires. SQL dashboards group on this to find idle-thinking-class bugs. */
	isUserInitiated: boolean;
	modelId?: string | null;
	tokensIn?: number | null;
	tokensOut?: number | null;
	costTotal?: number | null;
	durationMs: number;
	ok: boolean;
	errorCode?: string | null;
	startedAt: Date;
	endedAt: Date;
	runId?: string | null;
	sessionId?: string | null;
	variant?: string | null;
	commandEventId?: number | null;
}

export interface ExtensionTelemetrySink {
	writeCommandEvent(input: CommandEventInput): void;
	writeLlmCallEvent(input: LlmCallEventInput): void;
	writeHookEvent(input: HookEventInput): void;
	close(): Promise<void>;
}

class NoopExtensionTelemetrySink implements ExtensionTelemetrySink {
	writeCommandEvent(): void {
		// no-op
	}
	writeLlmCallEvent(): void {
		// no-op
	}
	writeHookEvent(): void {
		// no-op
	}
	async close(): Promise<void> {
		// no-op
	}
}

interface InsforgeSinkInternalOptions {
	endpoint: string;
	apiKey?: string;
	anonKey?: string;
	apiKeyHeader?: string;
	extraHeaders?: Record<string, string>;
	allowSelfSigned?: boolean;
	batchIntervalMs?: number;
	onDiagnostic?: DiagnosticHandler;
}

type SinkEvent =
	| { type: "command"; payload: CommandEventInput }
	| { type: "llm_call"; payload: LlmCallEventInput }
	| { type: "hook"; payload: HookEventInput };

class InsforgeExtensionTelemetrySink implements ExtensionTelemetrySink {
	private http: InsforgeHttpClient;
	private dispatcher: BatchingDispatcher<SinkEvent>;

	constructor(opts: InsforgeSinkInternalOptions) {
		this.http = new InsforgeHttpClient({
			endpoint: opts.endpoint,
			apiKey: opts.apiKey,
			anonKey: opts.anonKey,
			apiKeyHeader: opts.apiKeyHeader,
			extraHeaders: opts.extraHeaders,
			allowSelfSigned: opts.allowSelfSigned,
			source: TELEMETRY_SOURCE,
			onDiagnostic: opts.onDiagnostic,
		});
		this.dispatcher = new BatchingDispatcher<SinkEvent>({
			handler: (event) => this.postEvent(event),
			intervalMs: opts.batchIntervalMs ?? 2000,
			source: TELEMETRY_SOURCE,
			onDiagnostic: opts.onDiagnostic,
		});
	}

	writeCommandEvent(input: CommandEventInput): void {
		this.dispatcher.enqueue({ type: "command", payload: input });
	}

	writeLlmCallEvent(input: LlmCallEventInput): void {
		this.dispatcher.enqueue({ type: "llm_call", payload: input });
	}

	writeHookEvent(input: HookEventInput): void {
		this.dispatcher.enqueue({ type: "hook", payload: input });
	}

	async close(): Promise<void> {
		await this.dispatcher.close();
	}

	private async postEvent(event: SinkEvent): Promise<void> {
		if (event.type === "command") {
			await this.postCommandEvent(event.payload);
		} else if (event.type === "llm_call") {
			await this.postLlmCallEvent(event.payload);
		} else {
			await this.postHookEvent(event.payload);
		}
	}

	private async postCommandEvent(input: CommandEventInput): Promise<void> {
		const row = {
			run_id: input.runId ?? null,
			session_id: input.sessionId ?? null,
			extension_name: input.extensionName,
			command_name: input.commandName,
			args_signature: input.argsSignature,
			args_length: input.argsLength,
			outcome: input.outcome,
			error_code: input.errorCode ?? null,
			duration_ms: input.durationMs,
			details: input.details ?? null,
			pencil_version: BUILD_META.version,
			commit_hash: BUILD_META.commitHash ?? null,
			variant: input.variant ?? null,
			started_at: input.startedAt.toISOString(),
			ended_at: input.endedAt.toISOString(),
		};
		await this.http.postJson(`${this.http.base}/api/database/records/${EXT_COMMAND_EVENTS_TABLE}`, [row]);
	}

	private async postLlmCallEvent(input: LlmCallEventInput): Promise<void> {
		const row = {
			run_id: input.runId ?? null,
			session_id: input.sessionId ?? null,
			command_event_id: input.commandEventId ?? null,
			extension_name: input.extensionName,
			caller_context: input.callerContext,
			is_user_initiated: input.isUserInitiated,
			model_id: input.modelId ?? null,
			tokens_in: input.tokensIn ?? null,
			tokens_out: input.tokensOut ?? null,
			cost_total: input.costTotal ?? null,
			duration_ms: input.durationMs,
			ok: input.ok,
			error_code: input.errorCode ?? null,
			pencil_version: BUILD_META.version,
			commit_hash: BUILD_META.commitHash ?? null,
			variant: input.variant ?? null,
			started_at: input.startedAt.toISOString(),
			ended_at: input.endedAt.toISOString(),
		};
		await this.http.postJson(`${this.http.base}/api/database/records/${EXT_LLM_CALLS_TABLE}`, [row]);
	}

	private async postHookEvent(input: HookEventInput): Promise<void> {
		const row = {
			run_id: input.runId ?? null,
			session_id: input.sessionId ?? null,
			extension_name: input.extensionName,
			hook_name: input.hookName,
			duration_ms: input.durationMs,
			ok: input.ok,
			error_code: input.errorCode ?? null,
			sample_rate: input.sampleRate,
			pencil_version: BUILD_META.version,
			variant: input.variant ?? null,
			recorded_at: input.recordedAt.toISOString(),
		};
		await this.http.postJson(`${this.http.base}/api/database/records/${EXT_HOOK_EVENTS_TABLE}`, [row]);
	}
}

export interface CreateExtensionTelemetrySinkOptions {
	workspaceRoot: string;
	onDiagnostic?: DiagnosticHandler;
	batchIntervalMs?: number;
}

/**
 * Build a telemetry sink. Returns a noop sink — silently dropping every event —
 * when insforge credentials are missing or disabled. Callers can therefore wire
 * the sink unconditionally; users without credentials pay zero cost.
 */
export function createExtensionTelemetrySink(
	options: CreateExtensionTelemetrySinkOptions,
): ExtensionTelemetrySink {
	const creds = loadInsforgeCredentials<InsforgeCredentialsBase>(
		options.workspaceRoot,
		TELEMETRY_SOURCE,
		options.onDiagnostic,
	);
	const endpoint = creds?.endpoint ?? creds?.insforge_url;
	if (!endpoint || !creds?.api_key || creds.enabled === false) {
		return new NoopExtensionTelemetrySink();
	}
	return new InsforgeExtensionTelemetrySink({
		endpoint,
		apiKey: creds.api_key,
		anonKey: creds.anon_key,
		apiKeyHeader: creds.api_key_header,
		extraHeaders: creds.headers,
		allowSelfSigned: creds.allow_self_signed,
		batchIntervalMs: options.batchIntervalMs,
		onDiagnostic: options.onDiagnostic,
	});
}

/**
 * Classify arg text into a small bounded set of signatures so dashboards can
 * group invocations without ingesting user-supplied text. Privacy posture:
 *
 * - "no-args"     — empty or whitespace-only args
 * - "--<flag>"    — args start with a `--flag` token; we record the flag name only
 *                   (enum-like, low cardinality, no PII)
 * - "with-args"   — any other non-empty args; original text is never recorded
 *
 * Anything else interesting (length, etc.) lives on its own typed column so we
 * never need free-form arg storage.
 */
export function classifyArgsSignature(args: string): string {
	const trimmed = args.trim();
	if (!trimmed) return "no-args";
	const flagMatch = trimmed.match(/^(--[a-z0-9-]+)/i);
	if (flagMatch) return flagMatch[1].toLowerCase();
	return "with-args";
}
