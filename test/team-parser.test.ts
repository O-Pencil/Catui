import assert from "node:assert/strict";
import test from "node:test";
import { buildTeamHelp, getTeamArgumentCompletions, parseTeamCommand } from "../extensions/builtin/team/team-parser.js";
import { selectAutoTeamPlan } from "../extensions/builtin/team/team-presets.js";
import { parseTeamMentions } from "../extensions/builtin/team/team-orchestrator.js";
import { renderTeamDashboard } from "../extensions/builtin/team/team-dashboard.js";
import { updateTeamUi } from "../extensions/builtin/team/team-ui.js";
import type { PersistedTeammate } from "../extensions/builtin/team/team-types.js";

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

test("team-parser: exposes safe enum completions for team command family", () => {
	assert.deepEqual(getTeamArgumentCompletions("team", "sp")?.map((item) => item.value), ["spawn"]);
	assert.match(getTeamArgumentCompletions("team", "sp")?.[0]?.description ?? "", /Create a teammate/);
	assert.deepEqual(
		getTeamArgumentCompletions("team:spawn", "dev", {
			commandName: "team:spawn",
			argumentText: "dev",
			argumentPrefix: "dev",
			tokenIndex: 0,
			previousTokens: [],
		})?.map((item) => item.value),
		["developer"],
	);
	assert.match(
		getTeamArgumentCompletions("team:spawn", "dev", {
			commandName: "team:spawn",
			argumentText: "dev",
			argumentPrefix: "dev",
			tokenIndex: 0,
			previousTokens: [],
		})?.[0]?.description ?? "",
		/write code/,
	);
	assert.deepEqual(
		getTeamArgumentCompletions("team:spawn", "--h", {
			commandName: "team:spawn",
			argumentText: "developer --h",
			argumentPrefix: "--h",
			tokenIndex: 1,
			previousTokens: ["developer"],
		})?.map((item) => item.value),
		["--harness"],
	);
	assert.match(
		getTeamArgumentCompletions("team:spawn", "--h", {
			commandName: "team:spawn",
			argumentText: "developer --h",
			argumentPrefix: "--h",
			tokenIndex: 1,
			previousTokens: ["developer"],
		})?.[0]?.description ?? "",
		/structured progress/,
	);
	assert.deepEqual(getTeamArgumentCompletions("team:preset", "sq")?.map((item) => item.value), ["squad"]);
	assert.match(getTeamArgumentCompletions("team:preset", "sq")?.[0]?.description ?? "", /larger team/);
	assert.deepEqual(getTeamArgumentCompletions("team:task", "cl")?.map((item) => item.value), ["claim"]);
	assert.match(getTeamArgumentCompletions("team:task", "cl")?.[0]?.description ?? "", /Assign a task/);
	assert.deepEqual(
		getTeamArgumentCompletions("team:mode", "ex", {
			commandName: "team:mode",
			argumentText: "builder ex",
			argumentPrefix: "ex",
			tokenIndex: 1,
			previousTokens: ["builder"],
		})?.map((item) => item.value),
		["execute"],
	);
	assert.match(
		getTeamArgumentCompletions("team:mode", "ex", {
			commandName: "team:mode",
			argumentText: "builder ex",
			argumentPrefix: "ex",
			tokenIndex: 1,
			previousTokens: ["builder"],
		})?.[0]?.description ?? "",
		/Allow code changes/,
	);
	assert.equal(
		getTeamArgumentCompletions("team:mode", "bu", {
			commandName: "team:mode",
			argumentText: "bu",
			argumentPrefix: "bu",
			tokenIndex: 0,
			previousTokens: [],
		}),
		null,
	);
	assert.equal(getTeamArgumentCompletions("team:status", "sta"), null);
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
	assert.equal((await selectAutoTeamPlan("analyze the Claude official website and build a frontend page")).presetName, "squad");
	assert.equal((await selectAutoTeamPlan("\u5206\u6790Claude\u5b98\u7f51\u5e76\u5b9e\u73b0\u524d\u7aef\u9875\u9762")).presetName, "squad");
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

test("team-ui: hides dashboard and footer status when teammates are idle", () => {
	const teammates: PersistedTeammate[] = [
		{
			identity: { id: "dev", label: "A", name: "Theo", role: "developer", createdAt: 1 },
			mode: "plan",
			status: "idle",
			cwd: process.cwd(),
			messages: [],
			lastActiveAt: 1,
		},
	];
	const calls: Array<{ type: "status" | "widget"; key: string; value: string | string[] | undefined }> = [];
	const ctx = {
		ui: {
			setStatus: (key: string, text: string | undefined) => calls.push({ type: "status", key, value: text }),
			setWidget: (key: string, content: string[] | undefined) => calls.push({ type: "widget", key, value: content }),
		},
	};

	updateTeamUi(ctx, { getAllTeammates: () => teammates } as any);

	assert.deepEqual(calls, [
		{ type: "status", key: "team", value: undefined },
		{ type: "widget", key: "team-dashboard", value: undefined },
	]);
});

test("team-ui: shows dashboard and footer status while a teammate is running", () => {
	const teammates: PersistedTeammate[] = [
		{
			identity: { id: "dev", label: "A", name: "Theo", role: "developer", createdAt: 1 },
			mode: "execute",
			status: "running",
			cwd: process.cwd(),
			messages: [],
			lastActiveAt: 1,
		},
	];
	const calls: Array<{ type: "status" | "widget"; key: string; value: string | string[] | undefined }> = [];
	const ctx = {
		ui: {
			setStatus: (key: string, text: string | undefined) => calls.push({ type: "status", key, value: text }),
			setWidget: (key: string, content: string[] | undefined) => calls.push({ type: "widget", key, value: content }),
		},
	};

	updateTeamUi(ctx, { getAllTeammates: () => teammates } as any);

	assert.equal(calls[0]?.type, "status");
	assert.match(String(calls[0]?.value), /team: 1 agents/);
	assert.equal(calls[1]?.type, "widget");
	assert.ok(Array.isArray(calls[1]?.value));
	assert.match((calls[1]?.value as string[]).join("\n"), /Team Workbench/);
});
