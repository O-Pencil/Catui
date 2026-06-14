import assert from "node:assert/strict";
import test from "node:test";

// Test that TaskOutput tool can handle background bash tasks.
// We verify the tool structure and import paths.

import { createTaskOutputTool } from "../extensions/builtin/task/task-tools/task-output-tool.js";

test("TaskOutput tool has correct name and schema", () => {
	const tool = createTaskOutputTool();
	assert.equal(tool.name, "TaskOutput");
	assert.ok(tool.description);
	assert.ok(tool.parameters);
	assert.ok(tool.guidance);
});

test("TaskOutput tool accepts task_id, block, and timeout parameters", () => {
	const tool = createTaskOutputTool();
	const schema = tool.parameters as Record<string, unknown>;
	const props = schema.properties as Record<string, unknown>;
	assert.ok(props.task_id, "should have task_id parameter");
	assert.ok(props.block, "should have block parameter");
	assert.ok(props.timeout, "should have timeout parameter");
});
