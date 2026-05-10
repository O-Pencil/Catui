import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionRunner } from "../core/extensions/index.js";
import type { PromptTemplate } from "../core/prompt/prompt-templates.js";
import {
	buildExtensionSlashCommands,
	buildSessionSlashCommands,
} from "../core/runtime/slash-command-catalog.js";

const promptTemplates = [
	{
		name: "draft",
		description: "Draft from prompt",
		source: "project",
		filePath: "/workspace/.pencil/prompts/draft.md",
	},
] as PromptTemplate[];

const resourceLoader = {
	getSkills: () => ({
		skills: [
			{
				name: "review",
				description: "Review skill",
				source: "user",
				filePath: "/home/user/.nanopencil/skills/review/SKILL.md",
			},
		],
	}),
} as any;

const extensionRunner = {
	getRegisteredCommandsWithPaths: () => [
		{
			command: { name: "deploy", description: "Deploy project" },
			extensionPath: "/workspace/extensions/deploy",
		},
		{
			command: { name: "model", description: "Should not shadow builtin" },
			extensionPath: "/workspace/extensions/shadow",
		},
	],
} as ExtensionRunner;

test("session slash command catalog includes builtins and filters shadowed extensions", () => {
	const commands = buildSessionSlashCommands(
		{ promptTemplates, resourceLoader, extensionRunner },
		(key) => `translated:${key}`,
	);

	assert.ok(
		commands.some(
			(command) =>
				command.name === "model" &&
				command.source === "builtin" &&
				command.description === "translated:slash.model",
		),
	);
	assert.deepEqual(
		commands.filter((command) => command.name === "model"),
		[
			{
				name: "model",
				description: "translated:slash.model",
				source: "builtin",
			},
		],
	);
	assert.ok(commands.some((command) => command.name === "deploy" && command.source === "extension"));
	assert.ok(commands.some((command) => command.name === "draft" && command.source === "prompt"));
	assert.ok(commands.some((command) => command.name === "skill:review" && command.source === "skill"));
});

test("extension slash command catalog preserves paths and normalized locations", () => {
	const commands = buildExtensionSlashCommands({
		promptTemplates,
		resourceLoader,
		extensionRunner,
	});

	assert.deepEqual(commands, [
		{
			name: "deploy",
			description: "Deploy project",
			source: "extension",
			path: "/workspace/extensions/deploy",
		},
		{
			name: "draft",
			description: "Draft from prompt",
			source: "prompt",
			location: "project",
			path: "/workspace/.pencil/prompts/draft.md",
		},
		{
			name: "skill:review",
			description: "Review skill",
			source: "skill",
			location: "user",
			path: "/home/user/.nanopencil/skills/review/SKILL.md",
		},
	]);
});
