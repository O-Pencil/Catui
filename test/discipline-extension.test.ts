/**
 * [WHO]: Verifies built-in discipline extension registration, skill discovery, and bootstrap prompt behavior
 * [FROM]: Depends on node:test, node:assert, node:fs, builtin-extensions, discipline extension, core/extensions-host/types
 * [TO]: Consumed by focused extension/skill verification commands
 * [HERE]: test/discipline-extension.test.ts - default discipline workflow regression tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { builtInExtensions, getBuiltinExtensionPaths } from "../builtin-extensions.ts";
import disciplineExtension from "../extensions/builtin/discipline/index.ts";
import { loadSkillsFromDir } from "../core/skills.ts";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	ToolDefinition,
} from "../core/extensions-host/types.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function createApiHarness(): {
	api: ExtensionAPI;
	handlers: Map<string, Handler[]>;
	tools: ToolDefinition[];
} {
	const handlers = new Map<string, Handler[]>();
	const tools: ToolDefinition[] = [];
	const api = {
		cwd: process.cwd(),
		agentDir: join(process.cwd(), ".nanopencil-test-agent"),
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerTool(tool: ToolDefinition) {
			tools.push(tool);
		},
	} as unknown as ExtensionAPI;
	return { api, handlers, tools };
}

test("builtin extensions include discipline metadata and load path", () => {
	assert.ok(
		builtInExtensions.some(
			(extension) =>
				extension.id === "discipline" &&
				extension.defaultEnabled &&
				extension.riskLevel === "tool" &&
				!extension.writesWorkspace,
		),
		"Expected read-only tool default-enabled discipline metadata.",
	);

	const paths = getBuiltinExtensionPaths();
	assert.ok(
		paths.some((entry) => entry.includes("extensions") && entry.includes("defaults") && entry.includes("discipline")),
		`Expected discipline extension in builtin paths, got: ${paths.join(", ")}`,
	);
});

test("discipline extension discovers bundled skills and injects bootstrap", async () => {
	const { api, handlers, tools } = createApiHarness();
	await disciplineExtension(api);

	assert.ok(tools.some((tool) => tool.name === "skill"), "Expected skill tool registration.");

	const resourceHandler = handlers.get("resources_discover")?.[0];
	assert.ok(resourceHandler, "Expected resources_discover handler.");

	const resources = resourceHandler(
		{ type: "resources_discover", cwd: process.cwd(), reason: "startup" } satisfies ResourcesDiscoverEvent,
		{} as ExtensionContext,
	) as ResourcesDiscoverResult;

	assert.equal(resources.skillPaths?.length, 1);
	assert.ok(resources.skillPaths?.[0]?.endsWith(join("discipline", "skills")));
	assert.ok(existsSync(join(resources.skillPaths![0], "systematic-debugging", "SKILL.md")));
	assert.ok(existsSync(join(resources.skillPaths![0], "verification-before-completion", "SKILL.md")));

	const beforeHandler = handlers.get("before_agent_start")?.[0];
	assert.ok(beforeHandler, "Expected before_agent_start handler.");

	const result = beforeHandler(
		{
			type: "before_agent_start",
			prompt: "Fix the failing test",
			systemPrompt: "base",
		} satisfies BeforeAgentStartEvent,
		{} as ExtensionContext,
	) as BeforeAgentStartResult;

	assert.match(result.appendSystemPrompt ?? "", /nanoPencil Engineering Discipline/);
	assert.match(result.appendSystemPrompt ?? "", /systematic-debugging/);
	assert.match(result.appendSystemPrompt ?? "", /verification-before-completion/);
	assert.match(result.appendSystemPrompt ?? "", /Completion claims require fresh verification evidence/);
});

test("discipline skill tool lists and loads effective skills", async () => {
	const { api, handlers, tools } = createApiHarness();
	await disciplineExtension(api);

	const resourceHandler = handlers.get("resources_discover")?.[0];
	assert.ok(resourceHandler, "Expected resources_discover handler.");
	const resources = resourceHandler(
		{ type: "resources_discover", cwd: process.cwd(), reason: "startup" } satisfies ResourcesDiscoverEvent,
		{} as ExtensionContext,
	) as ResourcesDiscoverResult;
	const skills = loadSkillsFromDir({ dir: resources.skillPaths![0], source: "test" }).skills;

	const skillTool = tools.find((tool) => tool.name === "skill");
	assert.ok(skillTool, "Expected skill tool registration.");

	const ctx = { getSkills: () => skills } as ExtensionContext;
	const listResult = await skillTool.execute("tool-1", {}, undefined, undefined, ctx);
	const listText = listResult.content[0]?.type === "text" ? listResult.content[0].text : "";
	assert.match(listText, /Available skills/);
	assert.match(listText, /systematic-debugging/);

	const loadResult = await skillTool.execute("tool-2", { name: "systematic-debugging" }, undefined, undefined, ctx);
	const loadText = loadResult.content[0]?.type === "text" ? loadResult.content[0].text : "";
	assert.match(loadText, /<skill name="systematic-debugging"/);
	assert.match(loadText, /No fixes before root-cause investigation/);
});

type BeforeAgentStartResult = BeforeAgentStartEventResult & {
	appendSystemPrompt?: string;
};
