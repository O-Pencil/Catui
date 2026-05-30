import assert from "node:assert/strict";
import test from "node:test";
import { createLogger, type LogEntry } from "../core/platform/utils/logger.js";

test("logger child includes structured context without leaking to parent", () => {
	const entries: LogEntry[] = [];
	const parent = createLogger({
		level: "debug",
		sessionId: "session-1",
		component: "parent",
		handler: (entry) => entries.push(entry),
	});

	const child = parent.child({
		component: "child",
		turnId: 3,
		toolCallId: "tool-1",
	});

	child.info("child message");
	parent.info("parent message");

	assert.equal(entries.length, 2);
	assert.equal(entries[0]?.component, "child");
	assert.equal(entries[0]?.turnId, 3);
	assert.equal(entries[0]?.toolCallId, "tool-1");
	assert.equal(entries[1]?.component, "parent");
	assert.equal(entries[1]?.turnId, undefined);
	assert.equal(entries[1]?.toolCallId, undefined);
});
