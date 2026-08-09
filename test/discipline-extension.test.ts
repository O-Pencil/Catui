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
import skillToolExtension from "../extensions/builtin/skill-tool/index.ts";
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
		agentDir: join(process.cwd(), ".catui-test-agent"),
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
		paths.some((entry) => entry.includes("extensions") && entry.includes("builtin") && entry.includes("discipline")),
		`Expected discipline extension in builtin paths, got: ${paths.join(", ")}`,
	);
});

test("discipline composes with the builtin Skill tool without duplicate registration", async () => {
	const { api, tools } = createApiHarness();
	await disciplineExtension(api);
	skillToolExtension(api);

	const skillTools = tools.filter((tool) => tool.name.toLowerCase() === "skill");
	assert.equal(skillTools.length, 1, "Expected one owner for the normalized functions.skill tool name.");
	assert.equal(skillTools[0]?.name, "Skill", "Expected the established Skill tool contract to remain authoritative.");
});

test("discipline extension discovers bundled skills and injects bootstrap", async () => {
	const { api, handlers, tools } = createApiHarness();
	await disciplineExtension(api);

	assert.equal(tools.length, 0, "Discipline must leave tool ownership to dedicated builtin extensions.");

	const resourceHandler = handlers.get("resources_discover")?.[0];
	assert.ok(resourceHandler, "Expected resources_discover handler.");

	const resources = resourceHandler(
		{ type: "resources_discover", cwd: process.cwd(), reason: "startup" } satisfies ResourcesDiscoverEvent,
		{} as ExtensionContext,
	) as ResourcesDiscoverResult;

	assert.equal(resources.skillPaths?.length, 1);
	assert.ok(resources.skillPaths?.[0]?.endsWith(join("discipline", "skills")));
	assert.ok(existsSync(join(resources.skillPaths![0], "systematic-debugging", "SKILL.md")));
	assert.ok(existsSync(join(resources.skillPaths![0], "domain-modeling", "SKILL.md")));

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

	assert.match(result.appendSystemPrompt ?? "", /Catui Engineering Discipline/);
	assert.match(result.appendSystemPrompt ?? "", /systematic-debugging/);
	assert.match(result.appendSystemPrompt ?? "", /Completion claims require fresh verification evidence/);
});

type BeforeAgentStartResult = BeforeAgentStartEventResult & {
	appendSystemPrompt?: string;
};
