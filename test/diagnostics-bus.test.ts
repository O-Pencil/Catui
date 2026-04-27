import assert from "node:assert/strict";
import test from "node:test";
import { reportDiagnostic, subscribeDiagnostics } from "../utils/diagnostics.js";
import type { DiagnosticEvent } from "../utils/diagnostics.js";

function makeEvent(suffix: string): DiagnosticEvent {
	return {
		source: "diag-bus.test",
		severity: "warning",
		category: "fallback",
		message: `bus test ${suffix}`,
		fingerprint: `diag-bus.test:${suffix}`,
	};
}

test("reportDiagnostic queues events before any subscriber attaches", () => {
	const before = makeEvent("queued-1");
	reportDiagnostic(before);

	const seen: DiagnosticEvent[] = [];
	const unsubscribe = subscribeDiagnostics((event) => {
		if (event.source === "diag-bus.test") seen.push(event);
	});

	assert.equal(seen.length >= 1, true, "expected queued event to drain on subscribe");
	assert.ok(seen.find((e) => e.fingerprint === before.fingerprint));
	unsubscribe();
});

test("reportDiagnostic delivers to live subscribers without queueing", () => {
	const seen: DiagnosticEvent[] = [];
	const unsubscribe = subscribeDiagnostics((event) => {
		if (event.source === "diag-bus.test") seen.push(event);
	});

	const event = makeEvent("live-1");
	reportDiagnostic(event);

	assert.equal(seen.some((e) => e.fingerprint === event.fingerprint), true);
	unsubscribe();
});

test("mem-core thin shell shares the same Symbol.for slot at runtime", async () => {
	// Cross-compile-boundary check: importing the mem-core copy should
	// resolve the same globalThis[Symbol.for(...)] as utils/diagnostics.ts.
	const memShell = await import("../packages/mem-core/src/diagnostics.js");
	const seen: DiagnosticEvent[] = [];
	const unsubscribe = subscribeDiagnostics((event) => {
		if (event.source === "mem-core.cross-shell-test") seen.push(event);
	});

	memShell.reportDiagnostic({
		source: "mem-core.cross-shell-test",
		severity: "warning",
		category: "fallback",
		message: "cross-shell delivery",
		fingerprint: "mem-core.cross-shell-test:once",
	});

	assert.equal(seen.length, 1, "mem-core copy should emit through the shared slot");
	unsubscribe();
});
