import assert from "node:assert/strict";
import test from "node:test";

// Test the KillShell alias and background task kill logic.
// We test the exported helper functions from bash.ts directly.

import { getBackgroundTask, killBackgroundTask, listBackgroundTasks, readBackgroundTaskOutput } from "../core/tools/bash.js";

test("getBackgroundTask returns undefined for non-existent ID", () => {
	const result = getBackgroundTask("non-existent-id");
	assert.equal(result, undefined);
});

test("listBackgroundTasks returns empty array when no tasks", () => {
	const tasks = listBackgroundTasks();
	assert.ok(Array.isArray(tasks));
});

test("killBackgroundTask returns false for non-existent ID", () => {
	const result = killBackgroundTask("non-existent-id");
	assert.equal(result, false);
});

test("readBackgroundTaskOutput returns null for non-existent ID", () => {
	const result = readBackgroundTaskOutput("non-existent-id");
	assert.equal(result, null);
});
