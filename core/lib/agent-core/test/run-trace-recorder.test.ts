import { describe, expect, it } from "vitest";
import {
	InMemoryRunTraceSink,
	RunTraceRecorder,
	type RunTraceEventV1,
	type RunTraceSink,
} from "../src/run-trace-recorder.js";

describe("RunTraceRecorder", () => {
	it("assigns deterministic identities and serializes sink appends", async () => {
		const sink = new InMemoryRunTraceSink();
		let time = 99;
		let id = 0;
		const recorder = new RunTraceRecorder({
			runId: "run-1",
			sessionId: "session-1",
			sink,
			now: () => ++time,
			createEventId: () => `event-${++id}`,
		});

		await Promise.all([
			recorder.record("turn.started", { turn: 1 }, { turnId: "turn-1" }),
			recorder.record("model.requested", { turn: 1, requestFingerprint: "sha256:req" }, { turnId: "turn-1" }),
		]);
		await recorder.flush();

		expect(sink.snapshot()).toMatchObject([
			{ eventId: "event-1", sequence: 1, timestamp: 100, runId: "run-1", sessionId: "session-1", turnId: "turn-1", kind: "turn.started" },
			{ eventId: "event-2", sequence: 2, timestamp: 101, runId: "run-1", sessionId: "session-1", turnId: "turn-1", kind: "model.requested" },
		]);
	});

	it("redacts an event before the sink can observe it", async () => {
		const seen: RunTraceEventV1[] = [];
		const sink: RunTraceSink = { append: async (traceEvent) => { seen.push(traceEvent); } };
		const recorder = new RunTraceRecorder({
			runId: "run-1",
			sessionId: "secret-session",
			sink,
			redactor: (traceEvent) => ({ ...traceEvent, sessionId: undefined }),
		});
		await recorder.record("run.started", { loopFramework: "standard", inputFingerprint: "sha256:input" });
		expect(seen[0].sessionId).toBeUndefined();
	});

	it("captures sink failures without rejecting in best-effort mode", async () => {
		const recorder = new RunTraceRecorder({
			runId: "run-1",
			sink: { append: async () => { throw new Error("disk full"); } },
			failureMode: "best_effort",
		});
		await expect(recorder.record("run.started", { loopFramework: "standard", inputFingerprint: "sha256:input" })).resolves.toBeUndefined();
		expect(recorder.failures).toMatchObject([{ message: "disk full", sequence: 1 }]);
	});

	it("propagates sink failures in required mode", async () => {
		const recorder = new RunTraceRecorder({
			runId: "run-1",
			sink: { append: async () => { throw new Error("disk full"); } },
			failureMode: "required",
		});
		await expect(recorder.record("run.started", { loopFramework: "standard", inputFingerprint: "sha256:input" })).rejects.toThrow("disk full");
	});

	it("applies bounded backpressure according to failure mode", async () => {
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => { release = resolve; });
		const sink: RunTraceSink = { append: async () => pending };
		const bestEffort = new RunTraceRecorder({ runId: "run-1", sink, maxPending: 1 });
		const first = bestEffort.record("turn.started", { turn: 1 });
		await expect(bestEffort.record("turn.started", { turn: 2 })).resolves.toBeUndefined();
		expect(bestEffort.failures[0].message).toMatch(/queue/i);
		release?.();
		await first;

		const required = new RunTraceRecorder({ runId: "run-2", sink: { append: async () => new Promise<void>(() => undefined) }, maxPending: 1, failureMode: "required" });
		void required.record("turn.started", { turn: 1 });
		await expect(required.record("turn.started", { turn: 2 })).rejects.toThrow(/queue/i);
	});

	it("returns defensive snapshots from the in-memory sink", async () => {
		const sink = new InMemoryRunTraceSink();
		const recorder = new RunTraceRecorder({ runId: "run-1", sink });
		await recorder.record("run.started", { loopFramework: "standard", inputFingerprint: "sha256:input" });
		const first = sink.snapshot();
		first[0].eventId = "mutated";
		expect(sink.snapshot()[0].eventId).not.toBe("mutated");
	});
});
