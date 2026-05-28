/**
 * [WHO]: Verifies interactive agent loop status formatting
 * [FROM]: Depends on node:test, modes/interactive/agent-loop-status.ts
 * [TO]: Consumed by repository test runner
 * [HERE]: test/agent-loop-status.test.ts - guards /status loop result readability
 */

import assert from "node:assert/strict";
import test from "node:test";
import { formatAgentLoopStatusLines } from "../modes/interactive/agent-loop-status.js";

test("agent loop status returns no lines without a result", () => {
	assert.deepEqual(formatAgentLoopStatusLines(undefined), []);
});

test("agent loop status formats stop outcome and transition", () => {
	assert.deepEqual(
		formatAgentLoopStatusLines({
			stopReason: "stop",
			turnCount: 2,
			toolCallCount: 3,
			durationMs: 42,
			lastTransition: { reason: "tool_result", toolCallCount: 3 },
		}),
		[
			"Last loop:            stop, 2 turns, 3 tools, 42ms",
			"Loop transition:      tool_result (3 tool calls)",
		],
	);
});

test("agent loop status highlights limits and permission denials", () => {
	assert.deepEqual(
		formatAgentLoopStatusLines({
			stopReason: "toolUse",
			turnCount: 5,
			toolCallCount: 9,
			durationMs: 1234,
			permissionDenialCount: 2,
			lastTransition: {
				reason: "tool_call_limit_reached",
				maxToolCalls: 8,
				requestedToolCalls: 3,
				toolCallCount: 6,
			},
		}),
		[
			"Last loop:            toolUse, 5 turns, 9 tools, 1.2s",
			"Loop transition:      tool_call_limit_reached (6/8 used, 3 requested)",
			"Tool denials:         2",
		],
	);
});
