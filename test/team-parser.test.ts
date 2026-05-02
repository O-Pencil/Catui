import assert from "node:assert/strict";
import test from "node:test";
import { buildTeamHelp, parseTeamCommand } from "../extensions/defaults/team/team-parser.js";
import { selectAutoTeamPlan } from "../extensions/defaults/team/team-presets.js";
import { parseTeamMentions } from "../extensions/defaults/team/team-orchestrator.js";
import { renderTeamDashboard } from "../extensions/defaults/team/team-dashboard.js";
import type { PersistedTeammate } from "../extensions/defaults/team/team-types.js";

test("team-parser: parses root list and help commands", () => {
	assert.deepEqual(parseTeamCommand("team", ""), { command: "list" });
	assert.deepEqual(parseTeamCommand("team", "help"), { command: "help" });
	assert.deepEqual(parseTeamCommand("team", "implement login with tests"), {
		command: "auto",
		taskDescription: "implement login with tests",
	});
});

test("team-parser: parses approve commands with and without request ids", () => {
	assert.deepEqual(parseTeamCommand("team", "approve"), { command: "approve" });
	assert.deepEqual(parseTeamCommand("team", "approve req-123"), {
		command: "approve",
		requestId: "req-123",
	});
	assert.deepEqual(parseTeamCommand("team:approve", ""), { command: "approve" });
	assert.deepEqual(parseTeamCommand("team:approve", "req-456"), {
		command: "approve",
		requestId: "req-456",
	});
});

test("team-parser: parses spawn and mode commands", () => {
	assert.deepEqual(parseTeamCommand("team:spawn", "implementer --name builder"), {
		command: "spawn",
		role: "implementer",
		name: "builder",
	});
	assert.deepEqual(parseTeamCommand("team:spawn", "implementer --name builder --harness"), {
		command: "spawn",
		role: "implementer",
		name: "builder",
		harnessEnabled: true,
	});
	assert.deepEqual(parseTeamCommand("team:mode", "builder execute"), {
		command: "mode",
		target: "builder",
		mode: "execute",
	});
});

test("team-parser: rejects invalid invocations", () => {
	assert.equal(parseTeamCommand("team:spawn", ""), null);
	assert.equal(parseTeamCommand("team:mode", "builder invalid"), null);
	assert.equal(parseTeamCommand("team:send", "builder"), null);
});

test("team-parser: parses harness dashboard and preset commands", () => {
	assert.deepEqual(parseTeamCommand("team:preset", "solo build a counter"), {
		command: "preset",
		presetName: "solo",
		taskDescription: "build a counter",
	});
	assert.deepEqual(parseTeamCommand("team:dashboard", ""), { command: "dashboard" });
	assert.deepEqual(parseTeamCommand("team:progress", "builder"), { command: "progress", target: "builder" });
	assert.deepEqual(parseTeamCommand("team:psyche", ""), { command: "psyche", target: undefined });
});

test("team-parser: parses task, mail, and allow-path commands", () => {
	assert.deepEqual(parseTeamCommand("team:task", "list"), { command: "task", taskAction: "list" });
	assert.deepEqual(parseTeamCommand("team:task", "add Implement login tests"), {
		command: "task",
		taskAction: "add",
		taskTitle: "Implement login tests",
	});
	assert.deepEqual(parseTeamCommand("team:task", "claim T-1 builder"), {
		command: "task",
		taskAction: "claim",
		taskId: "T-1",
		target: "builder",
	});
	assert.deepEqual(parseTeamCommand("team:mail", "builder verifier Review T-1"), {
		command: "mail",
		from: "builder",
		to: "verifier",
		message: "Review T-1",
	});
	assert.deepEqual(parseTeamCommand("team:allow-path", "builder ../shared"), {
		command: "allow-path",
		target: "builder",
		path: "../shared",
	});
});

test("team-parser: help text advertises list and approve flow", () => {
	const help = buildTeamHelp();
	assert.match(help, /\/team\s+- List all teammates/);
	assert.match(help, /\/team <task>/);
	assert.match(help, /\/team:approve <request-id>/);
	assert.match(help, /\/team:task add <title>/);
});

test("team-presets: auto team selector uses model JSON when available", async () => {
	const plan = await selectAutoTeamPlan("refactor the workspace layer", async () =>
		JSON.stringify({
			presetName: "squad",
			rationale: "Needs planning and parallel work.",
			startTargetRole: "pm",
		}),
	);

	assert.deepEqual(plan, {
		presetName: "squad",
		rationale: "Needs planning and parallel work.",
		startTargetRole: "pm",
	});
});

test("team-presets: auto team selector falls back to heuristics", async () => {
	assert.equal((await selectAutoTeamPlan("fix typo in help text")).presetName, "solo");
	assert.equal((await selectAutoTeamPlan("implement auth with tests")).presetName, "squad");
	assert.equal((await selectAutoTeamPlan("large architecture migration across modules")).presetName, "squad");
	assert.equal((await selectAutoTeamPlan("analyze the API before implementation")).presetName, "duo");
});

test("team-orchestrator: parses concrete @mentions against labels", () => {
	const teammates: PersistedTeammate[] = [
		{
			identity: { id: "a", label: "A", name: "researcher", role: "researcher", createdAt: 1 },
			mode: "research",
			status: "idle",
			cwd: process.cwd(),
			messages: [],
			lastActiveAt: 1,
		},
		{
			identity: { id: "b", label: "B", name: "implementer", role: "implementer", createdAt: 2 },
			mode: "plan",
			status: "idle",
			cwd: process.cwd(),
			messages: [],
			lastActiveAt: 2,
		},
	];

	const mentions = parseTeamMentions("I mapped the API. @B implement the client with retry handling.", teammates);
	assert.deepEqual(mentions, [
		{
			raw: "@B",
			targetId: "b",
			targetName: "implementer",
			targetLabel: "B",
			task: "implement the client with retry handling.",
		},
	]);
});

test("team-orchestrator: ignores mention without concrete task", () => {
	const teammates: PersistedTeammate[] = [
		{
			identity: { id: "a", label: "A", name: "researcher", role: "researcher", createdAt: 1 },
			mode: "research",
			status: "idle",
			cwd: process.cwd(),
			messages: [],
			lastActiveAt: 1,
		},
	];
	assert.deepEqual(parseTeamMentions("Looping in @A", teammates), []);
});

test("team-orchestrator: parses concrete @mentions against visible names", () => {
	const teammates: PersistedTeammate[] = [
		{
			identity: { id: "a", label: "A", name: "Ada", role: "architect", createdAt: 1 },
			mode: "plan",
			status: "idle",
			cwd: process.cwd(),
			messages: [],
			lastActiveAt: 1,
		},
		{
			identity: { id: "b", label: "B", name: "Theo", role: "developer", createdAt: 2 },
			mode: "plan",
			status: "idle",
			cwd: process.cwd(),
			messages: [],
			lastActiveAt: 2,
		},
	];

	const mentions = parseTeamMentions("I mapped the modules. @Theo implement the client and wire the tests.", teammates);
	assert.deepEqual(mentions, [
		{
			raw: "@Theo",
			targetId: "b",
			targetName: "Theo",
			targetLabel: "B",
			task: "implement the client and wire the tests.",
		},
	]);
});

test("team-dashboard: renders compact workbench with visible names", () => {
	const teammates: PersistedTeammate[] = [
		{
			identity: { id: "pm", label: "A", name: "Mason", role: "pm", createdAt: 1 },
			mode: "plan",
			status: "idle",
			cwd: process.cwd(),
			messages: [],
			lastActiveAt: 1,
			liveView: { name: "Mason", label: "A", role: "pm", currentTask: "Frame scope", progress: "done" },
		},
		{
			identity: { id: "dev", label: "B", name: "Theo", role: "developer", createdAt: 2 },
			mode: "execute",
			status: "running",
			cwd: process.cwd(),
			messages: [],
			lastActiveAt: 2,
			liveView: {
				name: "Theo",
				label: "B",
				role: "developer",
				currentTask: "Implement compact workbench",
				lastUtterance: "I am wiring the dashboard renderer.",
				progress: "thinking",
			},
		},
	];

	const lines = renderTeamDashboard(teammates, 72);
	assert.ok(lines.length <= 10);
	assert.match(lines.join("\n"), /Team Workbench/);
	assert.match(lines.join("\n"), /Mason/);
	assert.match(lines.join("\n"), /Theo/);
	assert.doesNotMatch(lines.join("\n"), /\bA:/);
	assert.doesNotMatch(lines.join("\n"), /\bB:/);
});
