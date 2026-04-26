import assert from "node:assert/strict";
import test from "node:test";
import { buildTeamHelp, parseTeamCommand } from "../extensions/defaults/team/team-parser.js";

test("team-parser: parses root list and help commands", () => {
	assert.deepEqual(parseTeamCommand("team", ""), { command: "list" });
	assert.deepEqual(parseTeamCommand("team", "help"), { command: "help" });
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

test("team-parser: help text advertises list and approve flow", () => {
	const help = buildTeamHelp();
	assert.match(help, /\/team\s+- List all teammates/);
	assert.match(help, /\/team:approve <request-id>/);
});
