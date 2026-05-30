/**
 * [WHO]: sanitizeDiagnosticValue(), normalizeDiagnosticMessage()
 * [FROM]: No external dependencies
 * [TO]: Consumed by diagnostic-buffer.ts and reporter.ts before local persistence or network upload
 * [HERE]: extensions/builtin/diagnostics/redaction.ts - privacy-preserving diagnostic normalization
 */

const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|token|secret|password|credential|cookie)/i;
const SECRET_VALUE_PATTERN = /\b(?:sk|ik|pk|ak|xox[baprs]?|gh[pousr])_[A-Za-z0-9_-]{8,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const HOME_PATH_PATTERN = /\/(?:Users|home|root)\/[^\s"',:)]+/g;

export function normalizeDiagnosticMessage(message: string): string {
	return sanitizeString(message)
		.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<uuid>")
		.replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g, "<timestamp>")
		.replace(/\s+/g, " ")
		.trim();
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
	if (depth > 5) return "[MaxDepth]";
	if (typeof value === "string") return sanitizeString(value);
	if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
	if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeDiagnosticValue(item, depth + 1));
	if (typeof value !== "object") return String(value);

	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (SECRET_KEY_PATTERN.test(key)) {
			out[key] = "[Redacted]";
			continue;
		}
		out[key] = sanitizeDiagnosticValue(item, depth + 1);
	}
	return out;
}

function sanitizeString(value: string): string {
	return value
		.replace(BEARER_PATTERN, "Bearer [Redacted]")
		.replace(SECRET_VALUE_PATTERN, "[Redacted]")
		.replace(HOME_PATH_PATTERN, "<path>")
		.slice(0, 2000);
}
