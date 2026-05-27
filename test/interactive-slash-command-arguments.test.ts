/**
 * [WHO]: Verifies built-in interactive slash command argument completions
 * [FROM]: Depends on modes/interactive/slash-command-arguments
 * [TO]: Guards TUI command autocomplete hints for core commands
 * [HERE]: test/interactive-slash-command-arguments.test.ts - focused coverage for human-readable built-in command arguments
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
	getLanguageArgumentCompletions,
	getMcpArgumentCompletions,
	getThinkingArgumentCompletions,
} from "../modes/interactive/slash-command-arguments.js";

test("thinking command completions explain the user-facing tradeoff", () => {
	const completions = getThinkingArgumentCompletions("m", undefined, ["off", "medium", "high"]);

	assert.deepEqual(completions?.map((item) => item.value), ["medium"]);
	assert.match(completions?.[0]?.description ?? "", /Balanced reasoning/);
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
