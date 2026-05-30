/**
 * [WHO]: DiagnosticBuffer, coerceDiagnosticEvent()
 * [FROM]: Depends on ./types.js and ./redaction.js for event schema and privacy normalization
 * [TO]: Consumed by extensions/builtin/diagnostics/index.ts
 * [HERE]: extensions/builtin/diagnostics/diagnostic-buffer.ts - session-local dedupe and prompt gating state
 */

import {
	type DiagnosticCategory,
	type DiagnosticEvent,
	type DiagnosticRecord,
	type DiagnosticSeverity,
} from "./types.js";
import { normalizeDiagnosticMessage, sanitizeDiagnosticValue } from "./redaction.js";

const MAX_RECORDS = 100;
const WARNING_REPORT_AGAIN_DELTA = 10;
const ERROR_REPORT_AGAIN_DELTA = 3;

export class DiagnosticBuffer {
	private records = new Map<string, DiagnosticRecord>();

	add(event: DiagnosticEvent): DiagnosticRecord {
		const now = event.created_at ?? new Date().toISOString();
		const sanitized: DiagnosticEvent = {
			source: event.source,
			severity: event.severity,
			category: event.category,
			message: normalizeDiagnosticMessage(event.message),
			detail: sanitizeDiagnosticValue(event.detail),
			context: sanitizeDiagnosticValue(event.context) as DiagnosticEvent["context"],
			created_at: now,
		};
		const fingerprint = event.fingerprint ?? buildFingerprint(sanitized);
		const existing = this.records.get(fingerprint);
		if (existing) {
			const previousSeverity = existing.severity;
			existing.last_seen_at = now;
			existing.occurrence_count += 1;
			existing.severity = maxSeverity(existing.severity, sanitized.severity);
			existing.detail = sanitized.detail;
			existing.context = { ...(existing.context ?? {}), ...(sanitized.context ?? {}) };
			if (shouldReportAgain(existing, previousSeverity)) existing.reported = false;
			return existing;
		}

		const record: DiagnosticRecord = {
			...sanitized,
			fingerprint,
			first_seen_at: now,
			last_seen_at: now,
			occurrence_count: 1,
			prompted: false,
			reported: false,
		};
		this.records.set(fingerprint, record);
		this.trim();
		return record;
	}

	all(): DiagnosticRecord[] {
		return Array.from(this.records.values()).sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
	}

	last(): DiagnosticRecord | undefined {
		return this.all()[0];
	}

	findPromptCandidate(): DiagnosticRecord | undefined {
		return this.all().find((record) => !record.prompted && shouldPrompt(record));
	}

	findUnreported(): DiagnosticRecord[] {
		return this.all().filter((record) => !record.reported);
	}

	markPrompted(fingerprint: string): void {
		const record = this.records.get(fingerprint);
		if (record) record.prompted = true;
	}

	markReported(fingerprint: string): void {
		const record = this.records.get(fingerprint);
		if (record) {
			record.reported = true;
			record.reported_occurrence_count = record.occurrence_count;
		}
	}

	private trim(): void {
		if (this.records.size <= MAX_RECORDS) return;
		const sorted = this.all();
		for (const record of sorted.slice(MAX_RECORDS)) {
			this.records.delete(record.fingerprint);
		}
	}
}

export function coerceDiagnosticEvent(value: unknown): DiagnosticEvent | undefined {
	if (!value || typeof value !== "object") return undefined;
	const input = value as Record<string, unknown>;
	const source = typeof input.source === "string" ? input.source : undefined;
	const severity = isSeverity(input.severity) ? input.severity : undefined;
	const category = isCategory(input.category) ? input.category : "unknown";
	const message = typeof input.message === "string" ? input.message : undefined;
	if (!source || !severity || !message) return undefined;
	return {
		source,
		severity,
		category,
		message,
		detail: input.detail,
		fingerprint: typeof input.fingerprint === "string" ? input.fingerprint : undefined,
		context: input.context && typeof input.context === "object" ? input.context as DiagnosticEvent["context"] : undefined,
		created_at: typeof input.created_at === "string" ? input.created_at : undefined,
	};
}

function shouldPrompt(record: DiagnosticRecord): boolean {
	if (record.severity === "error") return record.occurrence_count >= 3;
	if (record.severity === "warning") return record.occurrence_count >= 5 || record.category === "fallback";
	return false;
}

function shouldReportAgain(record: DiagnosticRecord, previousSeverity: DiagnosticSeverity): boolean {
	if (!record.reported) return false;
	if (record.severity !== previousSeverity) return true;
	const reportedCount = record.reported_occurrence_count ?? record.occurrence_count;
	const delta = record.occurrence_count - reportedCount;
	const threshold = record.severity === "error" ? ERROR_REPORT_AGAIN_DELTA : WARNING_REPORT_AGAIN_DELTA;
	return delta >= threshold;
}

function buildFingerprint(event: DiagnosticEvent): string {
	return `${event.source}:${event.category}:${normalizeDiagnosticMessage(event.message).toLowerCase()}`;
}

function isSeverity(value: unknown): value is DiagnosticSeverity {
	return value === "debug" || value === "info" || value === "warning" || value === "error";
}

function isCategory(value: unknown): value is DiagnosticCategory {
	return (
		value === "network" ||
		value === "fallback" ||
		value === "persistence" ||
		value === "config" ||
		value === "extension_timeout" ||
		value === "schema" ||
		value === "unknown"
	);
}

function maxSeverity(a: DiagnosticSeverity, b: DiagnosticSeverity): DiagnosticSeverity {
	const rank: Record<DiagnosticSeverity, number> = { debug: 0, info: 1, warning: 2, error: 3 };
	return rank[b] > rank[a] ? b : a;
}
