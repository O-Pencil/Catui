import { describe, expect, it } from "vitest";
import { replayRunTrace } from "../src/run-replay.js";
import type { RunTraceEventV1 } from "../src/run-trace.js";

function trace(): RunTraceEventV1[] {
	return [
		{ version: 1, eventId: "e1", sequence: 1, timestamp: 1, runId: "r1", kind: "run.started", payload: { loopFramework: "standard", inputFingerprint: "sha256:in" } },
		{ version: 1, eventId: "e2", sequence: 2, timestamp: 2, runId: "r1", kind: "turn.started", turnId: "t1", payload: { turn: 1 } },
		{ version: 1, eventId: "e3", sequence: 3, timestamp: 3, runId: "r1", kind: "model.requested", turnId: "t1", payload: { turn: 1, requestFingerprint: "sha256:req" } },
		{ version: 1, eventId: "e4", sequence: 4, timestamp: 4, runId: "r1", kind: "model.responded", turnId: "t1", payload: { turn: 1, stopReason: "stop", responseFingerprint: "sha256:res" } },
		{ version: 1, eventId: "e5", sequence: 5, timestamp: 5, runId: "r1", kind: "turn.completed", turnId: "t1", payload: { turn: 1, stopReason: "stop", outputFingerprint: "sha256:res" } },
		{ version: 1, eventId: "e6", sequence: 6, timestamp: 6, runId: "r1", kind: "run.completed", payload: { stopReason: "stop", turnCount: 1, toolCallCount: 0, outputFingerprint: "sha256:res" } },
	];
}

describe("replayRunTrace", () => {
	it("reconstructs a valid run without runtime dependencies", () => {
		expect(replayRunTrace(trace())).toEqual({
			ok: true,
			summary: { runId: "r1", stopReason: "stop", turnCount: 1, toolCallCount: 0, checkpointCount: 0 },
		});
	});

	it("reports the first field divergence between recorded and observed traces", () => {
		const observed = trace();
		observed[3] = { ...observed[3], payload: { turn: 1, stopReason: "length", responseFingerprint: "sha256:other" } } as RunTraceEventV1;
		expect(replayRunTrace(trace(), observed)).toMatchObject({
			ok: false,
			divergence: { sequence: 4, kind: "model.responded", fieldPath: "payload.responseFingerprint", expected: "sha256:res", actual: "sha256:other" },
		});
	});

	it("reports missing and extra events deterministically", () => {
		expect(replayRunTrace(trace(), trace().slice(0, -1))).toMatchObject({ ok: false, divergence: { sequence: 6, fieldPath: "$event", actual: undefined } });
		expect(replayRunTrace(trace().slice(0, -1), trace())).toMatchObject({ ok: false, divergence: { sequence: 6, fieldPath: "$event", expected: undefined } });
	});

	it("rejects structurally invalid and semantically unpaired traces", () => {
		const invalid = trace();
		invalid[1] = { ...invalid[1], sequence: 3 } as RunTraceEventV1;
		expect(replayRunTrace(invalid)).toMatchObject({ ok: false, divergence: { fieldPath: "$trace" } });

		const unpaired = trace();
		unpaired.splice(4, 0,
			{ version: 1, eventId: "tool-1", sequence: 5, timestamp: 5, runId: "r1", kind: "tool.requested", payload: { toolCallId: "c1", toolName: "read", inputFingerprint: "sha256:i" } },
		);
		for (let index = 5; index < unpaired.length; index += 1) unpaired[index] = { ...unpaired[index], sequence: index + 1 } as RunTraceEventV1;
		expect(replayRunTrace(unpaired)).toMatchObject({ ok: false, divergence: { kind: "run.completed", fieldPath: "tool.c1" } });
	});
});
