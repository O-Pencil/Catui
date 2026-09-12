/**
 * [WHO]: Verifies humanizer activation, resource discovery, bootstrap budget, and vendored skill content
 * [FROM]: Depends on node:test/assert/fs/path, builtin-extensions, humanizer extension
 * [TO]: Consumed by focused humanizer verification and default extension contract checks
 * [HERE]: test/humanizer-extension.test.ts - humanizer skill bundle regression coverage
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { builtInExtensions, getBuiltinExtensionPaths } from "../builtin-extensions.ts";
import humanizerExtension, { HUMANIZER_BOOTSTRAP_PROMPT } from "../extensions/builtin/humanizer/index.ts";
import type { ExtensionAPI, ExtensionContext, ResourcesDiscoverResult } from "../core/extensions-host/types.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function createApiHarness(): { api: ExtensionAPI; handlers: Map<string, Handler[]>; registeredCommands: string[] } {
	const handlers = new Map<string, Handler[]>();
	const registeredCommands: string[] = [];
	const api = {
		cwd: process.cwd(),
		agentDir: join(process.cwd(), ".catui-test-agent"),
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerCommand(name: string) {
			registeredCommands.push(name);
		},
	} as unknown as ExtensionAPI;
	return { api, handlers, registeredCommands };
}

test("builtin extensions include passive default humanizer metadata and path", () => {
	assert.ok(
		builtInExtensions.some(
			(extension) =>
				extension.id === "humanizer" &&
				extension.defaultEnabled &&
				extension.riskLevel === "passive" &&
				!extension.writesWorkspace &&
				!extension.externalProcess &&
				extension.resourceDiscovery,
		),
	);
	assert.ok(getBuiltinExtensionPaths().some((path) => path.includes(join("extensions", "builtin", "humanizer"))));
});

test("humanizer discovers one passive skill without registering a dedicated slash command", async () => {
	const { api, handlers, registeredCommands } = createApiHarness();
	await humanizerExtension(api);

	const discover = handlers.get("resources_discover")?.[0];
	assert.ok(discover);
	const resources = discover({ type: "resources_discover", cwd: process.cwd(), reason: "startup" }, {} as ExtensionContext) as ResourcesDiscoverResult;
	assert.equal(resources.skillPaths?.length, 1);
	assert.ok(resources.skillPaths?.[0]?.endsWith(join("humanizer", "SKILL.md")));
	assert.deepEqual(registeredCommands, []);

	const before = handlers.get("before_agent_start")?.[0];
	assert.ok(before);
	const result = before({ type: "before_agent_start", prompt: "Write the release notes", systemPrompt: "base" }, {} as ExtensionContext) as { appendSystemPrompt?: string };
	assert.equal(result.appendSystemPrompt, HUMANIZER_BOOTSTRAP_PROMPT);
	assert.match(result.appendSystemPrompt ?? "", /humanizer/);
	assert.match(result.appendSystemPrompt ?? "", /writing/i);
	assert.match(result.appendSystemPrompt ?? "", /never invents facts/i);
	assert.match(result.appendSystemPrompt ?? "", /via the `skill`/);
	assert.ok((result.appendSystemPrompt ?? "").length < 1_200, "Default prompt overhead should stay bounded.");
});

const HUMANIZER_ROOT = join(process.cwd(), "extensions", "builtin", "humanizer");

test("vendored humanizer SKILL.md keeps name, pattern coverage, and fact-integrity rules", () => {
	const skill = readFileSync(join(HUMANIZER_ROOT, "SKILL.md"), "utf8");
	assert.match(skill, /^name: humanizer$/m);
	assert.match(skill, /Not X but Y/);
	assert.match(skill, /One-line closers and dramatic fragments/);
	assert.match(skill, /Forced triads/);
	assert.match(skill, /Overused AI words/);
	assert.match(skill, /Chatbot residue/);
	assert.match(skill, /Do not make anything up/);
	assert.match(skill, /Never invent a source/i);
	assert.ok(existsSync(join(HUMANIZER_ROOT, "LICENSE")), "MIT license file should be vendored");
});

test("humanizer bootstrap prompt does not embed the skill body (token neutrality)", () => {
	assert.ok(HUMANIZER_BOOTSTRAP_PROMPT.length < 1_200, "bootstrap prompt must stay bounded");
	assert.ok(!HUMANIZER_BOOTSTRAP_PROMPT.includes("### 1. Not X but Y"), "skill body must not be inlined into the system prompt");
});