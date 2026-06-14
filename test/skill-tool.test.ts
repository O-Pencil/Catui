import assert from "node:assert/strict";
import test from "node:test";

// Test the Skill tool structure and behavior.

import { createSkillTool } from "../extensions/builtin/skill-tool/skill-tool.js";

test("Skill tool has correct name and schema", () => {
	const tool = createSkillTool();
	assert.equal(tool.name, "Skill");
	assert.ok(tool.description);
	assert.ok(tool.parameters);
	assert.ok(tool.guidance);
});

test("Skill tool schema requires skill parameter", () => {
	const tool = createSkillTool();
	const schema = tool.parameters as Record<string, unknown>;
	const props = schema.properties as Record<string, unknown>;
	assert.ok(props.skill, "should have skill parameter");
	assert.ok(!props.skill.optional, "skill should be required");
	assert.ok(props.args, "should have args parameter");
});

test("Skill tool returns error for non-existent skill", async () => {
	const tool = createSkillTool();
	const mockCtx = {
		getSkills: () => [
			{ name: "test-skill", description: "A test skill", filePath: "/tmp/test.md", baseDir: "/tmp", source: "user", disableModelInvocation: false },
		],
	} as any;

	const result = await tool.execute("tc-1", { skill: "non-existent" }, undefined, undefined, mockCtx);
	const text = (result.content as any[])[0].text;
	assert.ok(text.includes("Skill not found"));
	assert.ok(text.includes("test-skill"));
});

test("Skill tool returns error for disabled model invocation skill", async () => {
	const tool = createSkillTool();
	const mockCtx = {
		getSkills: () => [
			{ name: "internal-skill", description: "Internal", filePath: "/tmp/internal.md", baseDir: "/tmp", source: "user", disableModelInvocation: true },
		],
	} as any;

	const result = await tool.execute("tc-2", { skill: "internal-skill" }, undefined, undefined, mockCtx);
	const text = (result.content as any[])[0].text;
	assert.ok(text.includes("model invocation disabled"));
});

test("Skill tool returns error when no skills available", async () => {
	const tool = createSkillTool();
	const mockCtx = {
		getSkills: () => [],
	} as any;

	const result = await tool.execute("tc-3", { skill: "anything" }, undefined, undefined, mockCtx);
	const text = (result.content as any[])[0].text;
	assert.ok(text.includes("Skill not found"));
	assert.ok(text.includes("(none)"));
});
