/**
 * [WHO]: Tests for buildMcpCapabilitiesHint() and the end-to-end injection pipeline
 *      (createCustomMessage → sessionManager.appendMessage → convertToLlm → LLM context).
 * [FROM]: Depends on ../core/mcp/mcp-adapter.js (createMCPTool),
 *         ../core/mcp/mcp-capabilities-hint.js (buildMcpCapabilitiesHint, MCP_CAPABILITIES_CUSTOM_TYPE),
 *         ../core/messages.js (createCustomMessage, convertToLlm, CUSTOM_MESSAGE_TYPES_EXCLUDED_FROM_CONTEXT).
 * [TO]: None (test file).
 * [HERE]: test/mcp-hint-injection.test.ts — verifies the warmup-time hint reaches the LLM as expected:
 *   - hint body lists ≤ 8 tools before folding
 *   - hint uses MCP_CAPABILITIES_CUSTOM_TYPE customType
 *   - the CustomMessage enters LLM context (not excluded by the filter)
 *   - the hint is hidden from the user chat stream (display=false)
 *   - empty / large inputs are handled gracefully
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMCPTool } from "../core/mcp/mcp-adapter.js";
import {
	buildMcpCapabilitiesHint,
	MCP_CAPABILITIES_CUSTOM_TYPE,
} from "../core/mcp/mcp-capabilities-hint.js";
import {
	createCustomMessage,
	convertToLlm,
	CUSTOM_MESSAGE_TYPES_EXCLUDED_FROM_CONTEXT,
} from "../core/messages.js";
import type { ToolDefinition } from "../core/extensions-host/types.js";

const fakeClient = {} as any;

function makeMcpTool(name: string, description: string): ToolDefinition {
	return createMCPTool(fakeClient, { name, description, inputSchema: { type: "object" } });
}

// ── buildMcpCapabilitiesHint: contract ───────────────────────────────────────

describe("buildMcpCapabilitiesHint: shape", () => {
	it("returns empty string for empty input array", () => {
		assert.equal(buildMcpCapabilitiesHint([]), "");
	});

	it("includes a top-level explanation that this is an awareness reminder", () => {
		const out = buildMcpCapabilitiesHint([
			makeMcpTool("filesystem/read_file", "Read a file"),
		]);
		assert.ok(out.includes("[MCP capabilities loaded]"),
			"output should start with [MCP capabilities loaded] marker");
		assert.ok(out.includes("awareness reminder"),
			"output should mention 'awareness reminder' so the LLM doesn't feel obligated");
		assert.ok(out.includes("mcp_*"),
			"output should reference mcp_* prefix");
	});

	it("MCP_CAPABILITIES_CUSTOM_TYPE is set and namespaced", () => {
		assert.equal(MCP_CAPABILITIES_CUSTOM_TYPE, "mcp.capabilities");
		// Namespace guard: a customType without a dot risks colliding with
		// single-word identifiers; the dot is what makes this safe to add
		// to the global customType registry.
		assert.ok(MCP_CAPABILITIES_CUSTOM_TYPE.includes("."),
			"customType should be namespaced (contain a dot)");
	});

	it("lists up to 8 tools with name + truncated description line each", () => {
		const tools = Array.from({ length: 8 }, (_, i) =>
			makeMcpTool(`filesystem/operation_${i}`, `Description for operation number ${i}, ${"with extra prose. ".repeat(20)}`),
		);
		const out = buildMcpCapabilitiesHint(tools);
		assert.ok(out.length > 0);
		// One bullet per listed tool
		const bullets = out.split("\n").filter((line) => line.startsWith("- "));
		assert.equal(bullets.length, 8,
			`should list exactly 8 bullets for 8 tools; got ${bullets.length}`);
		for (const bullet of bullets) {
			assert.ok(bullet.startsWith("- mcp_filesystem_operation_"),
				`bullet should start with tool name; got '${bullet.slice(0, 60)}'`);
		}
	});

	it("folds over 8 tools into a '+N more' summary line", () => {
		const tools = Array.from({ length: 15 }, (_, i) =>
			makeMcpTool(`filesystem/operation_${i}`, `Description ${i}`),
		);
		const out = buildMcpCapabilitiesHint(tools);
		assert.ok(out.includes("+7 more"),
			`15 tools with cap=8 should produce '+7 more'; got: ${out.slice(-150)}`);
	});

	it("does not fold at the 8-tool boundary (cap inclusive)", () => {
		const tools = Array.from({ length: 8 }, (_, i) =>
			makeMcpTool(`filesystem/operation_${i}`, `Description ${i}`),
		);
		const out = buildMcpCapabilitiesHint(tools);
		assert.ok(!out.includes("more"),
			`exactly 8 tools should NOT trigger '+N more'; got: ${out.slice(-100)}`);
	});

	it("truncates long descriptions to 2 sentences max per tool", () => {
		const long = `First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence. Sixth sentence.`;
		const tools = [makeMcpTool("filesystem/read", long)];
		const out = buildMcpCapabilitiesHint(tools);
		// Expect at most the first two sentences; the rest must be dropped.
		// The format is "<original>. <suffix>." where suffix is the
		// scenario phrase from MCP awareness — so we should NOT see "Sixth".
		assert.ok(!out.includes("Sixth"),
			`long description should be truncated; got: ${out}`);
		assert.ok(out.includes("First") && out.includes("Second"),
			"first two sentences should be preserved");
	});
});

// ── end-to-end pipeline: hint → customType → LLM context ─────────────────────

describe("hint injection: end-to-end pipeline", () => {
	it("hint wraps correctly as CustomMessage with display=false", () => {
		const tools = [makeMcpTool("filesystem/read_file", "Read a file")];
		const hintBody = buildMcpCapabilitiesHint(tools);
		const now = new Date().toISOString();
		const msg = createCustomMessage(
			MCP_CAPABILITIES_CUSTOM_TYPE,
			hintBody,
			false, // display=false → hidden from user UI
			undefined,
			now,
		);

		assert.equal(msg.role, "custom");
		assert.equal(msg.customType, MCP_CAPABILITIES_CUSTOM_TYPE);
		assert.equal(msg.display, false,
			"display must be false so the hint does not appear in the chat stream");
		assert.equal(msg.content, hintBody);
	});

	it("customType is NOT in the LLM-excluded set → hint enters LLM context", () => {
		// This is the critical step: if we accidentally added 'mcp.capabilities'
		// to CUSTOM_MESSAGE_TYPES_EXCLUDED_FROM_CONTEXT the hint would be a no-op.
		assert.equal(
			CUSTOM_MESSAGE_TYPES_EXCLUDED_FROM_CONTEXT.has(MCP_CAPABILITIES_CUSTOM_TYPE),
			false,
			`${MCP_CAPABILITIES_CUSTOM_TYPE} must NOT be in CUSTOM_MESSAGE_TYPES_EXCLUDED_FROM_CONTEXT`,
		);
	});

	it("convertToLlm transforms the hint into a role:user message", () => {
		const tools = [
			makeMcpTool("filesystem/read_file", "Read a file from disk"),
			makeMcpTool("fetch/fetch_html", "Fetch a URL"),
		];
		const hintBody = buildMcpCapabilitiesHint(tools);
		const msg = createCustomMessage(
			MCP_CAPABILITIES_CUSTOM_TYPE,
			hintBody,
			false,
			undefined,
			new Date().toISOString(),
		);

		const llmMessages = convertToLlm([msg]);
		assert.equal(llmMessages.length, 1,
			"one CustomMessage should map to exactly one LLM message");
		assert.equal(llmMessages[0].role, "user",
			"hint should land in LLM context as role:user (per convertToLlm switch)");
		assert.ok(Array.isArray(llmMessages[0].content));
		const content = llmMessages[0].content as Array<{ type: string; text: string }>;
		assert.equal(content[0].type, "text");
		assert.ok(content[0].text.includes("[MCP capabilities loaded]"),
			"LLM should see the hint body, not the customType metadata");
		assert.ok(content[0].text.includes("mcp_filesystem_read_file"),
			"hint body should include the tool name");
	});

	it("the convertToLlm output preserves a copy of tool descriptions", () => {
		// Regression guard: if the hint body changes shape (e.g. fails to
		// include descriptions) the LLM loses the "what does this tool do"
		// signal that the hint is for. Make sure descriptions survive the
		// conversion.
		const tools = [
			makeMcpTool("filesystem/read_file", "Read a file from disk"),
		];
		const hintBody = buildMcpCapabilitiesHint(tools);
		const msg = createCustomMessage(
			MCP_CAPABILITIES_CUSTOM_TYPE,
			hintBody,
			false,
			undefined,
			new Date().toISOString(),
		);
		const llmMessages = convertToLlm([msg]);
		const text = (llmMessages[0].content as Array<{ type: string; text: string }>)[0].text;
		assert.ok(text.includes("Read a file"),
			`LLM-visible text should include the tool description; got: ${text.slice(0, 200)}`);
	});

	it("multiple hints can coexist in a session (not deduped by convertToLlm)", () => {
		// Idempotency is enforced at the agent-session level via
		// _mcpCapabilitiesInjected; convertToLlm itself does NOT dedupe
		// (deliberately — the dedupe flag lives one layer up). This test
		// documents the pipeline contract.
		const t1 = createCustomMessage(
			MCP_CAPABILITIES_CUSTOM_TYPE,
			"first hint body",
			false,
			undefined,
			new Date().toISOString(),
		);
		const t2 = createCustomMessage(
			MCP_CAPABILITIES_CUSTOM_TYPE,
			"second hint body",
			false,
			undefined,
			new Date().toISOString(),
		);
		const out = convertToLlm([t1, t2]);
		assert.equal(out.length, 2,
			"convertToLlm passes both hints through; dedupe is the caller's job");
		assert.equal(
			(out[0].content as Array<{ type: string; text: string }>)[0].text,
			"first hint body",
		);
		assert.equal(
			(out[1].content as Array<{ type: string; text: string }>)[0].text,
			"second hint body",
		);
	});
});

// ── idempotency note (documentation in test form) ────────────────────────────

describe("hint injection: idempotency contract (documented)", () => {
	it("agent-session uses _mcpCapabilitiesInjected flag (out of band)", () => {
		// The hint builder itself is pure and deterministic — calling it
		// twice with the same input gives the same output. The agent-session
		// layer (warmupMcpTools in core/runtime/agent-session.ts) gates
		// repeated calls via the _mcpCapabilitiesInjected flag, so this
		// library-level helper doesn't need its own cache.
		const tools = [makeMcpTool("filesystem/read_file", "Read a file")];
		const a = buildMcpCapabilitiesHint(tools);
		const b = buildMcpCapabilitiesHint(tools);
		assert.equal(a, b, "hint builder must be deterministic for the same input");
	});
});
