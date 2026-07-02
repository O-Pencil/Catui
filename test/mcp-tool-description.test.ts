/**
 * [WHO]: Tests for createMCPTool() guidance/description format, getMcpServerHint() per-server scenarios, and inferScenariosFromSchema() schema-driven inference.
 * [FROM]: Depends on ../core/mcp/mcp-adapter.js, ../core/mcp/mcp-server-hints.js, ../core/mcp/mcp-schema-inference.js
 * [TO]: None (test file)
 * [HERE]: test/mcp-tool-description.test.ts — guards the contract that MCP tool descriptions carry scenario phrases the LLM can pattern-match against user queries
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMCPTool } from "../core/mcp/mcp-adapter.js";
import { inferScenariosFromSchema, renderSchemaInferences } from "../core/mcp/mcp-schema-inference.js";
import {
	getMcpServerHint,
	getMcpServerScenarios,
	MCP_SERVER_HINTS,
} from "../core/mcp/mcp-server-hints.js";

// Minimal MCPClient mock — createMCPTool only touches it inside execute(),
// which the tests below never invoke.
const fakeClient = {} as any;

// ── createMCPTool output shape ───────────────────────────────────────────────

describe("createMCPTool: output shape", () => {
	it("prefixes tool name with mcp_ and preserves raw name as label", () => {
		const tool = createMCPTool(fakeClient, {
			name: "filesystem/read_file",
			description: "Read a file from disk",
			inputSchema: { type: "object", properties: { path: { type: "string" } } },
		});
		assert.equal(tool.name, "mcp_filesystem_read_file");
		assert.equal(tool.label, "filesystem/read_file");
	});

	it("includes a non-empty guidance string with the server id", () => {
		const tool = createMCPTool(fakeClient, {
			name: "filesystem/read_file",
			description: "Read a file from disk",
			inputSchema: { type: "object", properties: { path: { type: "string" } } },
		});
		assert.ok(typeof tool.guidance === "string" && tool.guidance.length > 0,
			"guidance should be a non-empty string");
		assert.ok(tool.guidance.includes("filesystem"),
			"guidance should mention the server id");
		assert.ok(tool.guidance.includes("mcp_filesystem_read_file"),
			"guidance should reference the mcp_ tool name");
	});

	it("description starts with the upstream MCP tool description", () => {
		const tool = createMCPTool(fakeClient, {
			name: "fetch/fetch_html",
			description: "Fetch a URL",
			inputSchema: { type: "object", properties: { url: { type: "string" } } },
		});
		assert.ok(tool.description.startsWith("Fetch a URL"),
			"description should preserve the upstream wording as the leading clause");
	});

	it("description includes a scenario phrase from the server hint map", () => {
		const tool = createMCPTool(fakeClient, {
			name: "fetch/fetch_html",
			description: "Fetch a URL",
			inputSchema: { type: "object", properties: { url: { type: "string" } } },
		});
		// "fetch" hint's first scenario is "fetch a public web page or raw HTTP resource"
		assert.ok(tool.description.includes("fetch a public web page"),
			`description should carry fetch's scenario phrase; got: ${tool.description}`);
	});

	it("description includes (MCP: server/tool) marker preserved for UI", () => {
		const tool = createMCPTool(fakeClient, {
			name: "github/search_repositories",
			description: "Search GitHub repos",
			inputSchema: { type: "object", properties: { query: { type: "string" } } },
		});
		assert.ok(tool.description.includes("(MCP: github/search_repositories)"),
			"description should preserve the (MCP: server/tool) marker");
	});

	it("description includes schema-driven inference for path/file/url props", () => {
		const tool = createMCPTool(fakeClient, {
			name: "filesystem/read_file",
			description: "Read a file from disk",
			inputSchema: { type: "object", properties: { path: { type: "string" } } },
		});
		assert.ok(
			tool.description.includes("Takes args that operates on files or directories by path"),
			"description should include schema-inferred scenario phrase",
		);
	});

	it("falls back to '(no description from MCP server)' when upstream omits description", () => {
		const tool = createMCPTool(fakeClient, {
			name: "unknown-server/do_thing",
			// description intentionally omitted to simulate misbehaving MCP server
			inputSchema: { type: "object" },
		});
		assert.ok(tool.description.includes("(no description from MCP server)"),
			"description should be defensively filled when MCP server omits it");
		assert.ok(typeof tool.guidance === "string" && tool.guidance.length > 0,
			"guidance should still be populated even when description is missing");
	});

	it("unknown server gracefully falls back to '<serverId>'s domain' in guidance", () => {
		const tool = createMCPTool(fakeClient, {
			name: "made-up-server/x",
			description: "Mystery tool",
			inputSchema: { type: "object" },
		});
		assert.ok(tool.guidance.includes("made-up-server"),
			"guidance should at least mention the server id");
		assert.ok(tool.description.includes("made-up-server"),
			"description should at least mention the server id");
	});
});

// ── getMcpServerHint / getMcpServerScenarios ─────────────────────────────────

describe("mcp-server-hints: scenario vocabulary", () => {
	it("getMcpServerScenarios returns empty array for unknown server", () => {
		assert.deepEqual(getMcpServerScenarios("nonexistent-server"), []);
	});

	it("getMcpServerScenarios returns multiple phrases for known servers", () => {
		const scenarios = getMcpServerScenarios("filesystem");
		assert.ok(Array.isArray(scenarios));
		assert.ok(scenarios.length >= 2,
			"filesystem should have at least 2 scenario phrases");
	});

	it("getMcpServerHint formats a one-line summary for known servers", () => {
		const hint = getMcpServerHint("github");
		assert.ok(hint.length > 0);
		assert.ok(hint.includes("github") || hint.includes("GitHub"),
			"github hint should reference GitHub or github");
		assert.ok(hint.includes("repositories") || hint.includes("issues") || hint.includes("pull requests"),
			"github hint should mention repositories / issues / pull requests");
	});

	it("getMcpServerHint falls back to '<serverId>'s domain' for unknown servers", () => {
		assert.equal(getMcpServerHint("totally-unknown"), "totally-unknown's domain");
	});

	it("MCP_SERVER_HINTS covers all builtin servers from mcp-config.ts", () => {
		// Spot-check the 11 builtin ids used by the default config. Adding a
		// new server without updating MCP_SERVER_HINTS is allowed (it falls
		// back gracefully) but the expectation is that defaults are covered.
		const expectedIds = [
			"filesystem",
			"fetch",
			"sequential-thinking",
			"memory",
			"figma-desktop",
			"figma-remote",
			"sqlite",
			"github",
			"brave-search",
			"git",
			"postgres",
		];
		for (const id of expectedIds) {
			assert.ok(
				MCP_SERVER_HINTS[id] && MCP_SERVER_HINTS[id].length > 0,
				`MCP_SERVER_HINTS should have entries for ${id}`,
			);
		}
	});
});

// ── inferScenariosFromSchema / renderSchemaInferences ─────────────────────────

describe("mcp-schema-inference: schema-driven scenario phrases", () => {
	it("returns empty for null / undefined / object without properties", () => {
		assert.deepEqual(inferScenariosFromSchema(null), []);
		assert.deepEqual(inferScenariosFromSchema(undefined), []);
		assert.deepEqual(inferScenariosFromSchema({ type: "object" }), []);
	});

	it("ignores noise property names like id / name / type / value", () => {
		assert.deepEqual(
			inferScenariosFromSchema({
				type: "object",
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					type: { type: "string" },
					value: { type: "string" },
				},
			}),
			[],
		);
	});

	it("infers 'file ops' from path / file / dir property names", () => {
		const phrases = inferScenariosFromSchema({
			type: "object",
			properties: {
				path: { type: "string" },
				directory: { type: "string" },
			},
		});
		assert.ok(phrases.length >= 1, "should infer at least one phrase");
		assert.ok(
			phrases.some((p) => p.includes("file") || p.includes("director")),
			`phrases should mention file or directory; got: ${JSON.stringify(phrases)}`,
		);
	});

	it("infers 'URL / HTTP' from url / uri / endpoint property names", () => {
		const phrases = inferScenariosFromSchema({
			type: "object",
			properties: { url: { type: "string" } },
		});
		assert.ok(phrases.some((p) => p.toLowerCase().includes("url") || p.includes("HTTP")),
			`phrases should mention URL or HTTP; got: ${JSON.stringify(phrases)}`,
		);
	});

	it("infers 'search' from query / keyword / q property names", () => {
		const phrases = inferScenariosFromSchema({
			type: "object",
			properties: { query: { type: "string" } },
		});
		assert.ok(phrases.some((p) => p.toLowerCase().includes("search") || p.toLowerCase().includes("lookup")),
			`phrases should mention search or lookup; got: ${JSON.stringify(phrases)}`,
		);
	});

	it("caps the output at maxRules (default 3)", () => {
		const phrases = inferScenariosFromSchema({
			type: "object",
			properties: {
				path: { type: "string" },
				url: { type: "string" },
				query: { type: "string" },
				body: { type: "string" },
				limit: { type: "number" },
				owner: { type: "string" },
				repo: { type: "string" },
			},
		});
		assert.ok(phrases.length <= 3,
			`should cap at 3 rules; got ${phrases.length}: ${JSON.stringify(phrases)}`);
	});

	it("renderSchemaInferences returns '' for empty list", () => {
		assert.equal(renderSchemaInferences([]), "");
	});

	it("renderSchemaInferences handles 1, 2, and 3+ phrases with proper grammar", () => {
		assert.equal(
			renderSchemaInferences(["operates on files"]),
			"Takes args that operates on files.",
		);
		assert.equal(
			renderSchemaInferences(["a", "b"]),
			"Takes args that a or b.",
		);
		assert.equal(
			renderSchemaInferences(["a", "b", "c"]),
			"Takes args that a, b, or c.",
		);
	});
});
