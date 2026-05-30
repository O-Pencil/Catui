import assert from "node:assert/strict";
import test from "node:test";
import { sleep } from "../core/platform/utils/sleep.js";

// Verifies sleep() does not stack abort listeners on a long-lived signal.
// Before the fix every successful sleep left a dangling listener, so 11
// short sleeps against the same signal would emit MaxListenersExceededWarning.

test("sleep() removes its abort listener on success", async () => {
	const controller = new AbortController();

	// Run 30 short sleeps in sequence against the same signal. With the leak,
	// Node would have emitted MaxListenersExceededWarning by the 11th. We
	// capture warnings on the process-level 'warning' channel and assert none
	// of MaxListeners shape fired.
	const captured: string[] = [];
	const handler = (w: Error) => { captured.push(w.name + ":" + w.message); };
	process.on("warning", handler);
	try {
		for (let i = 0; i < 30; i += 1) {
			await sleep(1, controller.signal);
		}
	} finally {
		process.off("warning", handler);
	}
	const leaks = captured.filter((c) => c.includes("MaxListenersExceededWarning"));
	assert.equal(leaks.length, 0, `expected zero MaxListenersExceededWarning, got: ${leaks.join(" | ")}`);
});

test("sleep() rejects when signal aborts mid-flight", async () => {
	const controller = new AbortController();
	const promise = sleep(60_000, controller.signal);
	setTimeout(() => controller.abort(), 5);
	await assert.rejects(promise, /Aborted/);
});

test("sleep() rejects immediately when signal already aborted", async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(sleep(60_000, controller.signal), /Aborted/);
});
