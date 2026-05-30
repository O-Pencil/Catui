/**
 * [WHO]: Verifies resource-discovery extensions expose existing skill resource paths
 * [FROM]: Depends on node:test, node:assert, node:fs, node:os, node:path, default resource-discovery extensions
 * [TO]: Guards built-in extension metadata resource-discovery contracts for browser, link-world, mcp, and discipline
 * [HERE]: test/resource-discovery-contract.test.ts - focused resources_discover contract coverage
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ResourcesDiscoverEvent, ResourcesDiscoverResult } from "../core/extensions-host/types.js";
import browserExtension from "../extensions/builtin/browser/index.js";
import disciplineExtension from "../extensions/builtin/discipline/index.js";
import linkWorldExtension from "../extensions/builtin/link-world/index.js";
import mcpExtension from "../extensions/builtin/mcp/index.js";

function createApiHarness(agentDir: string) {
	const handlers = new Map<string, Array<(event: ResourcesDiscoverEvent) => ResourcesDiscoverResult | Promise<ResourcesDiscoverResult> | undefined>>();
	const api = {
		cwd: process.cwd(),
		agentDir,
		events: { on: () => {} },
		registerTool: () => {},
		registerMessageRenderer: () => {},
		registerCommand: () => {},
		on: (event: string, handler: (event: ResourcesDiscoverEvent) => ResourcesDiscoverResult | Promise<ResourcesDiscoverResult> | undefined) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
	} as unknown as ExtensionAPI;
	return { api, handlers };
}

async function discoverSkillPaths(extension: (api: ExtensionAPI) => Promise<void>, agentDir: string): Promise<string[]> {
	const { api, handlers } = createApiHarness(agentDir);
	await extension(api);
	const discover = handlers.get("resources_discover")?.[0];
	assert.ok(discover, "Expected resources_discover handler.");

	const result = await discover({ type: "resources_discover", cwd: process.cwd(), reason: "startup" });
	return result?.skillPaths ?? [];
}

test("resource-discovery extensions return existing skill paths", async () => {
	const previousAgentDir = process.env.NANOPENCIL_CODING_AGENT_DIR;
	const root = mkdtempSync(join(tmpdir(), "nanopencil-resource-contract-"));
	const agentDir = join(root, "agent");
	process.env.NANOPENCIL_CODING_AGENT_DIR = agentDir;

	try {
		for (const [id, extension] of [
			["browser", browserExtension],
			["link-world", linkWorldExtension],
			["mcp", mcpExtension],
			["discipline", disciplineExtension],
		] as const) {
			const skillPaths = await discoverSkillPaths(extension, agentDir);
			assert.ok(skillPaths.length > 0, `${id} should expose at least one skill path.`);
			for (const skillPath of skillPaths) {
				assert.ok(existsSync(skillPath), `${id} returned missing skill path: ${skillPath}`);
			}
		}
	} finally {
		if (previousAgentDir === undefined) {
			delete process.env.NANOPENCIL_CODING_AGENT_DIR;
		} else {
			process.env.NANOPENCIL_CODING_AGENT_DIR = previousAgentDir;
		}
		rmSync(root, { recursive: true, force: true });
	}
});
