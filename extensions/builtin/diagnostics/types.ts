/**
 * [WHO]: DiagnosticEvent, DiagnosticRecord, DiagnosticReportPayload, DIAGNOSTIC_EVENT_CHANNEL
 * [FROM]: No external dependencies
 * [TO]: Consumed by extensions/builtin/diagnostics/* and diagnostic event producers by structural contract
 * [HERE]: extensions/builtin/diagnostics/types.ts - extension-local diagnostic event schema
 */

export const DIAGNOSTIC_EVENT_CHANNEL = "diagnostic:event";

export type DiagnosticSeverity = "debug" | "info" | "warning" | "error";

export type DiagnosticCategory =
	| "network"
	| "fallback"
	| "persistence"
	| "config"
	| "extension_timeout"
	| "schema"
	| "unknown";

export interface DiagnosticContext {
	version?: string;
	commit_hash?: string;
	session_id?: string;
	mode?: string;
	provider?: string;
	model_id?: string;
	thinking?: string;
	tool_summary?: unknown;
	[key: string]: unknown;
}

export interface DiagnosticEvent {
	source: string;
	severity: DiagnosticSeverity;
	category: DiagnosticCategory;
	message: string;
	detail?: unknown;
	fingerprint?: string;
	context?: DiagnosticContext;
	created_at?: string;
}

export interface DiagnosticRecord extends DiagnosticEvent {
	fingerprint: string;
	first_seen_at: string;
	last_seen_at: string;
	occurrence_count: number;
	reported_occurrence_count?: number;
	prompted: boolean;
	reported: boolean;
}

export interface DiagnosticReportPayload {
	session_id?: string;
	version?: string;
	commit_hash?: string;
	mode?: string;
	source?: string;
	severity?: DiagnosticSeverity;
	category?: DiagnosticCategory;
	message?: string;
	fingerprint?: string;
	provider?: string;
	model_id?: string;
	thinking?: string;
	tool_summary?: unknown;
	diagnostics: DiagnosticRecord[];
	user_note?: string;
	user_approved: boolean;
	occurrence_count: number;
	first_seen_at?: string;
	last_seen_at?: string;
	client_report_id: string;
	created_at: string;
}
