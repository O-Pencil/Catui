import assert from "node:assert/strict";
import test from "node:test";

import { VERSION } from "../config.js";
import { buildReportPayload } from "../extensions/defaults/diagnostics/reporter.js";
import type { DiagnosticRecord } from "../extensions/defaults/diagnostics/types.js";

function makeRecord(context: DiagnosticRecord["context"] = {}): DiagnosticRecord {
	const now = "2026-05-03T00:00:00.000Z";
	return {
		source: "diagnostics.reporter.test",
		severity: "warning",
		category: "fallback",
		message: "test diagnostic",
		fingerprint: "diagnostics.reporter.test:version",
		context,
		first_seen_at: now,
		last_seen_at: now,
		occurrence_count: 1,
		prompted: false,
		reported: false,
	};
}

const ctx = {
	model: { provider: "test-provider", id: "test-model" },
	sessionManager: { getSessionId: () => "test-session" },
} as Parameters<typeof buildReportPayload>[2];

test("diagnostic issue payload defaults version to package version", () => {
	const payload = buildReportPayload([makeRecord()], undefined, ctx);

	assert.equal(payload.version, VERSION);
});

test("diagnostic issue payload preserves explicit diagnostic version", () => {
	const payload = buildReportPayload([makeRecord({ version: "1.2.3-test" })], undefined, ctx);

	assert.equal(payload.version, "1.2.3-test");
});
