import assert from "node:assert/strict";
import test from "node:test";

// Test the TeamCreate and TeamDelete tool structures.

import { createTeamCreateTool } from "../extensions/builtin/team/team-tools/team-create-tool.js";
import { createTeamDeleteTool } from "../extensions/builtin/team/team-tools/team-delete-tool.js";

function makeMockRuntime(teammates: any[] = []) {
	return {
		getAllTeammates: () => teammates,
		spawn: async (spec: any) => ({
			identity: { id: "test-id-123", name: spec.name ?? "test-team", role: spec.role ?? "generic", label: "A", createdAt: Date.now() },
			mode: "research",
			status: "idle",
			cwd: spec.baseCwd,
			messages: [],
			liveView: {},
		}),
		terminate: async (_name: string) => true,
	} as any;
}

// ── TeamCreate ─────────────────────────────────────────────────────────

test("TeamCreate tool has correct name and schema", () => {
	const tool = createTeamCreateTool(() => makeMockRuntime());
	assert.equal(tool.name, "TeamCreate");
	assert.ok(tool.description);
	assert.ok(tool.parameters);
	assert.ok(tool.guidance);
});

test("TeamCreate schema requires team_name parameter", () => {
	const tool = createTeamCreateTool(() => makeMockRuntime());
	const schema = tool.parameters as Record<string, unknown>;
	const props = schema.properties as Record<string, unknown>;
	assert.ok(props.team_name, "should have team_name parameter");
	assert.ok(props.description, "should have description parameter");
	assert.ok(props.agent_type, "should have agent_type parameter");
});

test("TeamCreate returns error when team already exists", async () => {
	const tool = createTeamCreateTool(() => makeMockRuntime([{ identity: { id: "1", name: "existing", role: "developer" }, status: "idle" }]));
	const result = await tool.execute("tc-1", { team_name: "new-team" }, undefined, undefined, { cwd: "/tmp" } as any);
	const text = (result.content as any[])[0].text;
	assert.ok(text.includes("already exists"));
});

test("TeamCreate returns team info on success", async () => {
	const tool = createTeamCreateTool(() => makeMockRuntime());
	const result = await tool.execute("tc-2", { team_name: "my-team", description: "Test team" }, undefined, undefined, { cwd: "/tmp" } as any);
	const text = (result.content as any[])[0].text;
	const parsed = JSON.parse(text);
	assert.equal(parsed.team_name, "my-team");
	assert.ok(parsed.lead_agent_id);
});

// ── TeamDelete ─────────────────────────────────────────────────────────

test("TeamDelete tool has correct name and schema", () => {
	const tool = createTeamDeleteTool(() => makeMockRuntime());
	assert.equal(tool.name, "TeamDelete");
	assert.ok(tool.description);
	assert.ok(tool.parameters);
	assert.ok(tool.guidance);
});

test("TeamDelete returns error when no team exists", async () => {
	const tool = createTeamDeleteTool(() => makeMockRuntime());
	const result = await tool.execute("tc-3", {}, undefined, undefined, { cwd: "/tmp" } as any);
	const text = (result.content as any[])[0].text;
	assert.ok(text.includes("No active team"));
});

test("TeamDelete returns error when teammates are running", async () => {
	const tool = createTeamDeleteTool(() => makeMockRuntime([{ identity: { id: "1", name: "runner" }, status: "running" }]));
	const result = await tool.execute("tc-4", {}, undefined, undefined, { cwd: "/tmp" } as any);
	const text = (result.content as any[])[0].text;
	assert.ok(text.includes("still running"));
});

test("TeamDelete succeeds when all teammates are idle", async () => {
	const tool = createTeamDeleteTool(() => makeMockRuntime([{ identity: { id: "1", name: "idle-one" }, status: "idle" }]));
	const result = await tool.execute("tc-5", {}, undefined, undefined, { cwd: "/tmp" } as any);
	const text = (result.content as any[])[0].text;
	const parsed = JSON.parse(text);
	assert.equal(parsed.success, true);
	assert.ok(parsed.message.includes("Terminated"));
});
