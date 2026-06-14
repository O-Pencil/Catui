import assert from "node:assert/strict";
import test from "node:test";

// We test the debug event filtering logic that _emitDebug uses.
// Since AgentSession is hard to instantiate in isolation (requires Agent,
// SessionManager, SettingsManager, etc.), we replicate the exact filtering
// logic from agent-session.ts:692-700 and verify the event type contract.

type DebugLevel = "off" | "basic" | "verbose";
type DebugSource = "session" | "mcp" | "model" | "tool" | "resource" | "extension";
type DebugEvent = {
	type: "debug";
	level: "basic" | "verbose";
	source: DebugSource;
	message: string;
	data?: Record<string, unknown>;
	timestamp: number;
};

/**
 * Exact replica of AgentSession._emitDebug filtering logic.
 * Source: core/runtime/agent-session.ts:692-700
 */
function shouldEmit(
	configLevel: DebugLevel,
	eventLevel: "basic" | "verbose",
): boolean {
	if (configLevel === "off") return false;
	if (eventLevel === "verbose" && configLevel !== "verbose") return false;
	return true;
}

function createDebugEvent(
	level: "basic" | "verbose",
	source: DebugSource,
	message: string,
	data?: Record<string, unknown>,
): DebugEvent {
	return { type: "debug", level, source, message, data, timestamp: Date.now() };
}

// ── debugLevel "off" blocks all events ─────────────────────────────────────

test("debugLevel 'off' blocks basic events", () => {
	assert.equal(shouldEmit("off", "basic"), false);
});

test("debugLevel 'off' blocks verbose events", () => {
	assert.equal(shouldEmit("off", "verbose"), false);
});

// ── debugLevel "basic" ─────────────────────────────────────────────────────

test("debugLevel 'basic' allows basic events", () => {
	assert.equal(shouldEmit("basic", "basic"), true);
});

test("debugLevel 'basic' blocks verbose events", () => {
	assert.equal(shouldEmit("basic", "verbose"), false);
});

// ── debugLevel "verbose" ───────────────────────────────────────────────────

test("debugLevel 'verbose' allows basic events", () => {
	assert.equal(shouldEmit("verbose", "basic"), true);
});

test("debugLevel 'verbose' allows verbose events", () => {
	assert.equal(shouldEmit("verbose", "verbose"), true);
});

// ── event shape contract ───────────────────────────────────────────────────

test("debug event has correct shape with all required fields", () => {
	const event = createDebugEvent("basic", "session", "session_created", {
		sessionId: "test-123",
	});

	assert.equal(event.type, "debug");
	assert.equal(event.level, "basic");
	assert.equal(event.source, "session");
	assert.equal(event.message, "session_created");
	assert.equal(typeof event.timestamp, "number");
	assert.ok(event.timestamp > 0);
	assert.deepEqual(event.data, { sessionId: "test-123" });
});

test("debug event without data omits data field", () => {
	const event = createDebugEvent("basic", "extension", "extensions_bound");

	assert.equal(event.type, "debug");
	assert.equal(event.data, undefined);
});

test("debug event with verbose level", () => {
	const event = createDebugEvent("verbose", "tool", "tool_start", {
		toolName: "bash",
		toolCallId: "call-1",
	});

	assert.equal(event.level, "verbose");
	assert.equal(event.source, "tool");
	assert.deepEqual(event.data, { toolName: "bash", toolCallId: "call-1" });
});

// ── all valid source values ────────────────────────────────────────────────

test("all valid debug sources are accepted", () => {
	const validSources: DebugSource[] = [
		"session",
		"mcp",
		"model",
		"tool",
		"resource",
		"extension",
	];

	for (const source of validSources) {
		const event = createDebugEvent("basic", source, `test_${source}`);
		assert.equal(event.source, source);
	}
});

// ── known debug messages from agent-session.ts ─────────────────────────────

test("known lifecycle debug messages match expected pattern", () => {
	// These are the actual debug messages emitted by AgentSession
	const knownMessages = [
		{ level: "basic" as const, source: "session" as const, message: "session_created" },
		{ level: "verbose" as const, source: "tool" as const, message: "tool_start" },
		{ level: "verbose" as const, source: "tool" as const, message: "tool_end" },
		{ level: "basic" as const, source: "model" as const, message: "model_change" },
		{ level: "basic" as const, source: "model" as const, message: "model_cycle" },
		{ level: "basic" as const, source: "extension" as const, message: "extensions_bound" },
		{ level: "basic" as const, source: "mcp" as const, message: "mcp_warmup_complete" },
		{ level: "basic" as const, source: "resource" as const, message: "reload_start" },
		{ level: "basic" as const, source: "resource" as const, message: "reload_end" },
	];

	for (const { level, source, message } of knownMessages) {
		const event = createDebugEvent(level, source, message);
		assert.equal(event.type, "debug");
		assert.equal(event.level, level);
		assert.equal(event.source, source);
		assert.equal(event.message, message);
	}
});

// ── timestamp is monotonically increasing ──────────────────────────────────

test("debug event timestamps are monotonically increasing", () => {
	const events: DebugEvent[] = [];
	for (let i = 0; i < 10; i++) {
		events.push(createDebugEvent("basic", "session", `event_${i}`));
	}

	for (let i = 1; i < events.length; i++) {
		assert.ok(
			events[i]!.timestamp >= events[i - 1]!.timestamp,
			`event ${i} timestamp should be >= event ${i - 1}`,
		);
	}
});

// ── data can contain arbitrary keys ────────────────────────────────────────

test("debug event data supports arbitrary record keys", () => {
	const event = createDebugEvent("verbose", "tool", "tool_start", {
		toolName: "bash",
		toolCallId: "abc-123",
		nested: { key: "value" },
		count: 42,
	});

	assert.equal(event.data?.toolName, "bash");
	assert.equal(event.data?.toolCallId, "abc-123");
	assert.deepEqual(event.data?.nested, { key: "value" });
	assert.equal(event.data?.count, 42);
});
