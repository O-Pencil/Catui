import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionRunner } from "../core/extensions/index.js";
import type { PromptTemplate } from "../core/prompt/prompt-templates.js";
import type { ResourceLoader } from "../core/config/resource-loader.js";
import type { Skill } from "../core/skills.js";
import {
	buildExtensionSlashCommands,
	buildSessionSlashCommands,
} from "../core/runtime/slash-command-catalog.js";
import { getExtensionBackedBuiltinCommandNames } from "../core/slash-commands.js";

const promptTemplates = [
	{
		name: "draft",
		description: "Draft from prompt",
		source: "project",
		filePath: "/workspace/.pencil/prompts/draft.md",
	},
] as PromptTemplate[];

const skill: Skill = {
	name: "review",
	description: "Review skill",
	source: "user",
	filePath: "/home/user/.nanopencil/skills/review/SKILL.md",
	content: "",
	disableModelInvocation: false,
};

const resourceLoader = {
	getSkills: () => ({
		skills: [skill],
		diagnostics: [],
	}),
} satisfies Pick<ResourceLoader, "getSkills">;

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
				command.category === "model" &&
				command.description === "translated:slash.model",
		),
	);
	assert.ok(commands.some((command) => command.name === "thinking" && command.source === "builtin" && command.category === "model"));
	assert.ok(commands.some((command) => command.name === "resources" && command.source === "builtin" && command.category === "core"));
	assert.deepEqual(
		commands.filter((command) => command.name === "model"),
		[
			{
				name: "model",
				description: "translated:slash.model",
				source: "builtin",
				category: "model",
			},
		],
	);
	assert.ok(commands.some((command) => command.name === "deploy" && command.source === "extension" && command.category === "tools"));
	assert.ok(commands.some((command) => command.name === "draft" && command.source === "prompt" && command.category === "workflow"));
	assert.ok(commands.some((command) => command.name === "skill:review" && command.source === "skill" && command.category === "tools"));
});

test("extension-backed builtins are explicit command metadata", () => {
	const names = getExtensionBackedBuiltinCommandNames();

	assert.equal(names.has("dream"), true);
	assert.equal(names.has("link-world"), true);
	assert.equal(names.has("model"), false);
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
			category: "tools",
			path: "/workspace/extensions/deploy",
		},
		{
			name: "draft",
			description: "Draft from prompt",
			source: "prompt",
			category: "workflow",
			location: "project",
			path: "/workspace/.pencil/prompts/draft.md",
		},
		{
			name: "skill:review",
			description: "Review skill",
			source: "skill",
			category: "tools",
			location: "user",
			path: "/home/user/.nanopencil/skills/review/SKILL.md",
		},
	]);
});
