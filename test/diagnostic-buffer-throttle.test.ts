import test from "node:test";
import assert from "node:assert/strict";

import { DiagnosticBuffer } from "../extensions/defaults/diagnostics/diagnostic-buffer.js";

const event = {
	source: "mem-core.extract",
	severity: "warning" as const,
	category: "fallback" as const,
	message: "NanoMem structured memory extraction fell back after repeated invalid JSON output.",
	fingerprint: "mem-core.extract:fallback:llm-failure",
};

test("diagnostic buffer does not reopen reported warnings until the throttle threshold", () => {
	const buffer = new DiagnosticBuffer();
	const first = buffer.add(event);
	buffer.markReported(first.fingerprint);

	for (let i = 0; i < 9; i++) buffer.add(event);
	assert.equal(buffer.findUnreported().length, 0);

	buffer.add(event);
	const unreported = buffer.findUnreported();
	assert.equal(unreported.length, 1);
	assert.equal(unreported[0]?.occurrence_count, 11);
});
