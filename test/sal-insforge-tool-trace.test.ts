import assert from "node:assert/strict";
import test from "node:test";
import { InsForgeEvalSink } from "../extensions/builtin/sal/eval/insforge-sink.js";
import type { EvalEventEnvelope } from "../extensions/builtin/sal/eval/types.js";

function makeToolTraceEvent(): EvalEventEnvelope {
	return {
		run_id: "run-tool-trace-test",
		event_id: "tool-trace-1",
		event_type: "tool_trace",
		variant: "sal",
		ts: new Date().toISOString(),
		payload: {
			turn_id: 7,
			tool_calls: [{ tool: "read", count: 2, errors: 1, avg_ms: 12, completed_calls: 2 }],
			tool_sequence: ["read", "grep"],
			task_signals: {
				intent: "explore",
				prompt_length: 42,
				has_error_trace: false,
				has_file_reference: true,
			},
			has_tool_usage: true,
			total_tool_calls: 3,
			total_errors: 1,
			completed_tool_calls: 2,
			truncated_tool_calls: 4,
			truncated_tool_summary: 2,
			duration_ms: 321,
		},
	};
}

test("insforge sink maps extended tool_trace fields into eval_tool_traces rows", async () => {
	const sink = new InsForgeEvalSink({
		enabled: true,
		endpoint: "https://example.insforge.app",
		runId: "run-tool-trace-test",
	});

	let capturedUrl = "";
	let capturedBody: unknown;
	(sink as any).postJson = async (url: string, body: unknown) => {
		capturedUrl = url;
		capturedBody = body;
		return { ok: true };
	};

	await (sink as any).handleToolTrace(makeToolTraceEvent());

	assert.match(capturedUrl, /eval_tool_traces/);
	const row = (capturedBody as Array<Record<string, unknown>>)[0];
	assert.equal(row.has_tool_usage, "true");
	assert.equal(row.completed_tool_calls, "2");
	assert.equal(row.truncated_tool_calls, "4");
	assert.equal(row.truncated_tool_summary, "2");
	assert.equal(row.total_tool_calls, "3");
	assert.equal(row.total_errors, "1");
});

test("insforge sink retries tool_trace with legacy columns on PostgREST schema drift", async () => {
	const sink = new InsForgeEvalSink({
		enabled: true,
		endpoint: "https://example.insforge.app",
		runId: "run-tool-trace-test",
	});

	const capturedBodies: unknown[] = [];
	(sink as any).postJson = async (_url: string, body: unknown) => {
		capturedBodies.push(body);
		return capturedBodies.length === 1
			? { ok: false, statusCode: 400, errorCode: "PGRST204" }
			: { ok: true };
	};

	await (sink as any).handleToolTrace(makeToolTraceEvent());

	assert.equal(capturedBodies.length, 2);
	const legacyRow = (capturedBodies[1] as Array<Record<string, unknown>>)[0];
	assert.equal(legacyRow.total_tool_calls, "3");
	assert.equal(legacyRow.has_tool_usage, undefined);
	assert.equal(legacyRow.completed_tool_calls, undefined);
	assert.equal(legacyRow.truncated_tool_calls, undefined);
	assert.equal(legacyRow.truncated_tool_summary, undefined);
});
