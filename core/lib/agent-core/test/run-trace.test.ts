import { describe, expect, it } from "vitest";
import {
	fingerprintTraceValue,
	parseRunTraceEvent,
	validateRunTrace,
	type RunTraceEventV1,
} from "../src/run-trace.js";

function event(overrides: Partial<RunTraceEventV1> = {}): RunTraceEventV1 {
	return {
		version: 1,
		eventId: "event-1",
		sequence: 1,
		timestamp: 100,
		runId: "run-1",
		kind: "run.started",
		payload: { loopFramework: "standard", inputFingerprint: "sha256:input" },
		...overrides,
	} as RunTraceEventV1;
}

describe("run trace protocol", () => {
	it("creates stable fingerprints independent of object key order", () => {
		expect(fingerprintTraceValue({ b: 2, a: [1, { d: 4, c: 3 }] })).toBe(
			fingerprintTraceValue({ a: [1, { c: 3, d: 4 }], b: 2 }),
		);
		expect(fingerprintTraceValue({ a: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("parses a valid event without widening its payload", () => {
		expect(parseRunTraceEvent(event())).toEqual(event());
	});

	it.each([
		["unsupported version", { version: 2 }],
		["unknown kind", { kind: "run.teleported" }],
		["invalid sequence", { sequence: 0 }],
		["invalid timestamp", { timestamp: Number.NaN }],
		["empty run identity", { runId: "" }],
		["malformed payload", { payload: { loopFramework: "turbo", inputFingerprint: "x" } }],
	])("rejects %s", (_label, override) => {
		expect(() => parseRunTraceEvent({ ...event(), ...override })).toThrow();
	});

	it("validates one run with contiguous sequences and unique IDs", () => {
		const completed = event({
			eventId: "event-2",
			sequence: 2,
			kind: "run.completed",
			payload: { stopReason: "stop", turnCount: 1, toolCallCount: 0, outputFingerprint: "sha256:out" },
		});
		expect(validateRunTrace([event(), completed])).toEqual([event(), completed]);
	});

	it("rejects duplicate IDs, sequence gaps, and mixed runs", () => {
		expect(() => validateRunTrace([event(), event({ sequence: 2 })])).toThrow(/eventId/i);
		expect(() => validateRunTrace([event(), event({ eventId: "event-3", sequence: 3 })])).toThrow(/sequence/i);
		expect(() => validateRunTrace([event(), event({ eventId: "event-2", sequence: 2, runId: "run-2" })])).toThrow(/runId/i);
	});
});
