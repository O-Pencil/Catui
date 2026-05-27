/**
 * [WHO]: Verifies built-in interactive slash command argument completions
 * [FROM]: Depends on modes/interactive/slash-command-arguments
 * [TO]: Guards TUI command autocomplete hints for core commands
 * [HERE]: test/interactive-slash-command-arguments.test.ts - focused coverage for human-readable built-in command arguments
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
	getAgentLoopArgumentCompletions,
	getLanguageArgumentCompletions,
	getLoginArgumentCompletions,
	getMcpArgumentCompletions,
	getPersonaArgumentCompletions,
	getThinkingArgumentCompletions,
} from "../modes/interactive/slash-command-arguments.js";

test("thinking command completions explain the user-facing tradeoff", () => {
	const completions = getThinkingArgumentCompletions("m", undefined, ["off", "medium", "high"]);

	assert.deepEqual(completions?.map((item) => item.value), ["medium"]);
	assert.match(completions?.[0]?.description ?? "", /Balanced reasoning/);
});

test("agent-loop command completions explain persistence behavior", () => {
	const standard = getAgentLoopArgumentCompletions("st");
	assert.deepEqual(standard?.map((item) => item.value), ["standard"]);
	assert.match(standard?.[0]?.description ?? "", /Use the normal agent loop/);

	const compatible = getAgentLoopArgumentCompletions("weak");
	assert.deepEqual(compatible?.map((item) => item.value), ["weak-model-compatible"]);
	assert.match(compatible?.[0]?.description ?? "", /Keep working with simpler models/);

	assert.equal(
		getAgentLoopArgumentCompletions("st", {
			commandName: "agent-loop",
			argumentText: "standard st",
			argumentPrefix: "st",
			tokenIndex: 1,
			previousTokens: ["standard"],
		}),
		null,
	);
});

test("mcp command completions expose readable actions and server targets", () => {
	const action = getMcpArgumentCompletions("en", undefined, [
		{ id: "filesystem", name: "Filesystem", enabled: true },
		{ id: "figma", name: "Figma", enabled: false },
	]);
	assert.deepEqual(action?.map((item) => item.value), ["enable"]);
	assert.match(action?.[0]?.description ?? "", /Turn on an MCP server/);

	const enableTargets = getMcpArgumentCompletions(
		"fi",
		{
			commandName: "mcp",
			argumentText: "enable fi",
			argumentPrefix: "fi",
			tokenIndex: 1,
			previousTokens: ["enable"],
		},
		[
			{ id: "filesystem", name: "Filesystem", enabled: true },
			{ id: "figma", name: "Figma", enabled: false },
		],
	);
	assert.deepEqual(enableTargets?.map((item) => item.value), ["figma"]);
	assert.match(enableTargets?.[0]?.description ?? "", /Figma \(disabled\)/);

	const disableTargets = getMcpArgumentCompletions(
		"file",
		{
			commandName: "mcp",
			argumentText: "disable file",
			argumentPrefix: "file",
			tokenIndex: 1,
			previousTokens: ["disable"],
		},
		[
			{ id: "filesystem", name: "Filesystem", enabled: true },
			{ id: "figma", name: "Figma", enabled: false },
		],
	);
	assert.deepEqual(disableTargets?.map((item) => item.value), ["filesystem"]);
	assert.match(disableTargets?.[0]?.description ?? "", /Filesystem \(enabled\)/);
});

test("language command completions name available languages", () => {
	const completions = getLanguageArgumentCompletions("z");

	assert.deepEqual(completions?.map((item) => item.value), ["zh"]);
	assert.match(completions?.[0]?.description ?? "", /中文/);
	assert.equal(
		getLanguageArgumentCompletions("z", {
			commandName: "language",
			argumentText: "zh z",
			argumentPrefix: "z",
			tokenIndex: 1,
			previousTokens: ["zh"],
		}),
		null,
	);
});

test("persona command completions guide list and use flows", () => {
	const actions = getPersonaArgumentCompletions("u", undefined, ["builder", "reviewer"], "builder");
	assert.deepEqual(actions?.map((item) => item.value), ["use"]);
	assert.match(actions?.[0]?.description ?? "", /Switch to a persona/);

	const personas = getPersonaArgumentCompletions(
		"r",
		{
			commandName: "persona",
			argumentText: "use r",
			argumentPrefix: "r",
			tokenIndex: 1,
			previousTokens: ["use"],
		},
		["builder", "reviewer"],
		"builder",
	);
	assert.deepEqual(personas?.map((item) => item.value), ["reviewer"]);
	assert.match(personas?.[0]?.description ?? "", /Switch to reviewer/);

	const current = getPersonaArgumentCompletions(
		"b",
		{
			commandName: "persona",
			argumentText: "use b",
			argumentPrefix: "b",
			tokenIndex: 1,
			previousTokens: ["use"],
		},
		["builder", "reviewer"],
		"builder",
	);
	assert.match(current?.[0]?.description ?? "", /Current persona/);

	assert.equal(
		getPersonaArgumentCompletions("r", {
			commandName: "persona",
			argumentText: "list r",
			argumentPrefix: "r",
			tokenIndex: 1,
			previousTokens: ["list"],
		}),
		null,
	);
});

test("login command completions explain provider authentication type", () => {
	const oauth = getLoginArgumentCompletions("anth", undefined, [
		{ id: "anthropic", name: "Anthropic", authType: "oauth" },
		{ id: "openrouter", name: "OpenRouter", authType: "api_key" },
	]);
	assert.deepEqual(oauth?.map((item) => item.value), ["anthropic"]);
	assert.match(oauth?.[0]?.description ?? "", /Sign in with browser/);

	const apiKey = getLoginArgumentCompletions("open", undefined, [
		{ id: "anthropic", name: "Anthropic", authType: "oauth" },
		{ id: "openrouter", name: "OpenRouter", authType: "api_key" },
	]);
	assert.deepEqual(apiKey?.map((item) => item.value), ["openrouter"]);
	assert.match(apiKey?.[0]?.description ?? "", /Set API key/);

	assert.equal(
		getLoginArgumentCompletions("open", {
			commandName: "login",
			argumentText: "openrouter open",
			argumentPrefix: "open",
			tokenIndex: 1,
			previousTokens: ["openrouter"],
		}),
		null,
	);
});
