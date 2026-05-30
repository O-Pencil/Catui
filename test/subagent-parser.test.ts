import assert from "node:assert/strict";
import test from "node:test";
import { buildSubAgentHelp, parseSubAgentCommand } from "../extensions/builtin/subagent/subagent-parser.js";

test("subagent-parser: parses colon subcommands", () => {
	assert.deepEqual(parseSubAgentCommand("subagent:run", "analyze project"), {
		command: "run",
		task: "analyze project",
		options: {},
	});
	assert.deepEqual(parseSubAgentCommand("subagent:stop"), { command: "stop" });
	assert.deepEqual(parseSubAgentCommand("subagent:status"), { command: "status" });
	assert.deepEqual(parseSubAgentCommand("subagent:report"), { command: "report" });
	assert.deepEqual(parseSubAgentCommand("subagent:apply"), { command: "apply" });
});

test("subagent-parser: parses root command compatibility and write flag", () => {
	assert.deepEqual(parseSubAgentCommand("subagent", ""), { command: "help" });
	assert.deepEqual(parseSubAgentCommand("subagent", "run implement auth --write"), {
		command: "run",
		task: "implement auth",
		options: { write: true },
	});
	assert.deepEqual(parseSubAgentCommand("subagent", "help"), { command: "help" });
});

test("subagent-parser: rejects invalid invocations", () => {
	assert.equal(parseSubAgentCommand("subagent:run", ""), null);
	assert.equal(parseSubAgentCommand("subagent", "run --write"), null);
	assert.equal(parseSubAgentCommand("subagent:unknown", "x"), null);
});

test("subagent-parser: help text advertises apply flow", () => {
	const help = buildSubAgentHelp();
	assert.match(help, /\/subagent:run <task>/);
	assert.match(help, /\/subagent:apply/);
});
