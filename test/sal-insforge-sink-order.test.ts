import assert from "node:assert/strict";
import test from "node:test";
import { InsForgeEvalSink } from "../extensions/defaults/sal/eval/insforge-sink.js";
import type { EvalEventEnvelope } from "../extensions/defaults/sal/eval/types.js";

function event(eventType: EvalEventEnvelope["event_type"]): EvalEventEnvelope {
	return {
		run_id: "run-order-test",
		event_id: `${eventType}-${Math.random().toString(16).slice(2)}`,
		event_type: eventType,
		variant: "sal",
		ts: new Date().toISOString(),
		payload: {},
	};
}

test("insforge sink routes batched events sequentially (run_start before turn_anchor)", async () => {
	const sink = new InsForgeEvalSink({
		enabled: true,
		endpoint: "https://example.insforge.app",
		runId: "run-order-test",
		batchIntervalMs: 1,
	});

	const order: string[] = [];
	let active = 0;
	let maxActive = 0;
	(sink as any).routeEvent = async (ev: EvalEventEnvelope) => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		order.push(ev.event_type);
		await new Promise((resolve) => setTimeout(resolve, 20));
		active -= 1;
	};

	await sink.sendEvent(event("run_start"));
	await sink.sendEvent(event("turn_anchor"));
	await sink.flush();

	assert.equal(maxActive, 1);
	assert.equal(order[0], "run_start");
	assert.equal(order[1], "turn_anchor");
});

test("insforge sink falls back to legacy eval_runs row before dependent events", async () => {
	const sink = new InsForgeEvalSink({
		enabled: true,
		endpoint: "https://example.insforge.app",
		runId: "run-order-test",
		batchIntervalMs: 1,
	});

	const calls: Array<{ url: string; body: any }> = [];
	(sink as any).postJson = async (url: string, body: any) => {
		calls.push({ url, body });
		if (url.endsWith("/eval_runs") && calls.filter((c) => c.url.endsWith("/eval_runs")).length === 1) {
			return { ok: false, errorCode: "PGRST204" };
		}
		return { ok: true };
	};

	await sink.sendEvent(event("run_start"));
	await sink.sendEvent({
		...event("turn_anchor"),
		payload: { turn_id: 1, prompt_summary: "test prompt" },
	});
	await sink.flush();

	const runCalls = calls.filter((c) => c.url.endsWith("/eval_runs"));
	assert.equal(runCalls.length, 2);
	assert.equal("pencil_version" in runCalls[0].body[0], true);
	assert.equal("pencil_version" in runCalls[1].body[0], false);
	assert.ok(calls.some((c) => c.url.includes("/eval_turns")));
});

test("insforge sink skips dependent events when eval_runs cannot be created", async () => {
	const sink = new InsForgeEvalSink({
		enabled: true,
		endpoint: "https://example.insforge.app",
		runId: "run-order-test",
		batchIntervalMs: 1,
	});

	const calls: string[] = [];
	(sink as any).postJson = async (url: string) => {
		calls.push(url);
		return { ok: false, errorCode: "23503" };
	};

	await sink.sendEvent(event("run_start"));
	await sink.sendEvent({
		...event("turn_anchor"),
		payload: { turn_id: 1, prompt_summary: "test prompt" },
	});
	await sink.flush();

	assert.equal(calls.filter((url) => url.endsWith("/eval_runs")).length, 2);
	assert.equal(calls.some((url) => url.includes("/eval_turns")), false);
	assert.equal(calls.some((url) => url.includes("/eval_sal_anchors")), false);
});

test("insforge sink suppresses allowSelfSigned warning in production", () => {
	const prevNodeEnv = process.env.NODE_ENV;
	process.env.NODE_ENV = "production";
	const warnings: string[] = [];
	const prevWarn = console.warn;
	console.warn = (message?: unknown) => {
		warnings.push(String(message));
	};
	try {
		new InsForgeEvalSink({
			enabled: true,
			endpoint: "https://example.insforge.app",
			runId: "run-order-test",
			allowSelfSigned: true,
		});
	} finally {
		console.warn = prevWarn;
		if (prevNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = prevNodeEnv;
		}
	}
	assert.deepEqual(warnings, []);
});
