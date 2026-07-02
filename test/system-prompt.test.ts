/**
 * [WHO]: Regression tests for buildSystemPrompt's main-template output shape, with focus on the contract that project context files (AGENT.md / .CATUI.md / etc.) reach the system prompt on the default code path.
 * [FROM]: Depends on ../core/prompt/system-prompt.js
 * [TO]: None (test file)
 * [HERE]: test/system-prompt.test.ts — guards against a regression where the Project Context block was accidentally removed from the main template path (only the customPrompt branch kept it). If buildSystemPrompt's main path ever stops injecting context files again, these tests fail loud.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSystemPrompt } from "../core/prompt/system-prompt.js";

// ── main template: project context injection ─────────────────────────────────

describe("buildSystemPrompt: main template injects project context", () => {
	it("renders the '# Project Context' header when context files are provided", () => {
		const out = buildSystemPrompt({
			selectedTools: ["read", "bash"],
			contextFiles: [
				{ path: "/Users/cunyu666/Dev/catui/AGENT.md", content: "P1 nav content" },
			],
		});
		assert.ok(out.includes("# Project Context"),
			"main template should render '# Project Context' header when contextFiles is non-empty");
	});

	it("renders each context file's path and content under Project Context", () => {
		const out = buildSystemPrompt({
			selectedTools: ["read", "bash"],
			contextFiles: [
				{ path: "/Users/cunyu666/Dev/catui/AGENT.md", content: "P1 nav content" },
				{ path: "/Users/cunyu666/Dev/catui/core/mcp/AGENT.md", content: "mcp P2 content" },
			],
		});
		assert.ok(out.includes("## /Users/cunyu666/Dev/catui/AGENT.md"),
			"should render '## <path>' heading for each file");
		assert.ok(out.includes("P1 nav content"),
			"should inject first file's content");
		assert.ok(out.includes("mcp P2 content"),
			"should inject second file's content");
	});

	it("omits Project Context when contextFiles is empty", () => {
		const out = buildSystemPrompt({ selectedTools: ["read", "bash"] });
		assert.ok(!out.includes("# Project Context"),
			"should NOT render '# Project Context' header when no context files exist");
	});

	it("keeps persona files in the Identity section, not in Project Context", () => {
		// Persona CATUI.md lives under /personas/<name>/CATUI.md. The isPersonaFile
		// filter routes those to the "Your Identity" section higher up in the
		// main template; they must NOT also appear in the Project Context
		// block (that would duplicate content and bloat the prompt).
		const out = buildSystemPrompt({
			selectedTools: ["read", "bash"],
			contextFiles: [
				{ path: "/Users/cunyu666/personas/aria/CATUI.md", content: "PERSONA_MARKER_AAA" },
				{ path: "/Users/cunyu666/Dev/catui/AGENT.md", content: "PROJECT_MARKER_BBB" },
			],
		});

		const idxIdentity = out.indexOf("# Your Identity");
		const idxProject = out.indexOf("# Project Context");
		assert.ok(idxIdentity > 0, "main template should have a 'Your Identity' section");
		assert.ok(idxProject > 0, "main template should have a 'Project Context' section");
		assert.ok(idxProject > idxIdentity,
			"'Project Context' should appear after 'Your Identity' in the main template");

		// Persona content lives ONLY in Identity.
		const identitySlice = out.slice(idxIdentity, idxProject);
		const projectSlice = out.slice(idxProject);
		assert.ok(identitySlice.includes("PERSONA_MARKER_AAA"),
			"persona content should appear under 'Your Identity'");
		assert.ok(!projectSlice.includes("PERSONA_MARKER_AAA"),
			"persona content must NOT be duplicated into 'Project Context'");

		// Project content lives ONLY in Project Context.
		assert.ok(projectSlice.includes("PROJECT_MARKER_BBB"),
			"project content should appear under 'Project Context'");
	});

	it("omits the Project Context block when contextFiles is missing entirely", () => {
		// Some callers (e.g. test harnesses, SDK users) pass no contextFiles
		// at all. The default Code path must still produce a valid prompt
		// without throwing or producing an empty '# Project Context\n' stub.
		const out = buildSystemPrompt({ selectedTools: ["read", "bash"] });
		assert.ok(!out.includes("# Project Context"));
		assert.ok(out.length > 1000, "prompt should still be substantive without context files");
	});
});

// ── customPrompt branch: still injects (parallel guarantee) ──────────────────

describe("buildSystemPrompt: customPrompt branch also injects project context", () => {
	it("renders Project Context when a customPrompt is supplied", () => {
		// The customPrompt branch builds the prompt from scratch; it has its
		// own Project Context block. Regression guard: if the customPrompt
		// branch ever drops its block (or both branches share the same
		// broken logic), this test fails.
		const out = buildSystemPrompt({
			selectedTools: ["read", "bash"],
			customPrompt: "USER SUPPLIED PROMPT",
			contextFiles: [
				{ path: "/Users/cunyu666/Dev/catui/AGENT.md", content: "PROJECT_MARKER_CUSTOM" },
			],
		});
		assert.ok(out.includes("USER SUPPLIED PROMPT"),
			"custom prompt should be the seed of the output");
		assert.ok(out.includes("USER SUPPLIED PROMPT PROJECT_MARKER_CUSTOM".replace("USER SUPPLIED PROMPT ", ""))
				|| out.includes("PROJECT_MARKER_CUSTOM"),
			"project content should also appear in the customPrompt branch output");
		assert.ok(out.includes("# Project Context"),
			"customPrompt branch should still render '# Project Context'");
	});

	it("does not render Project Context in customPrompt branch when contextFiles is empty", () => {
		const out = buildSystemPrompt({
			selectedTools: ["read", "bash"],
			customPrompt: "USER SUPPLIED PROMPT",
		});
		assert.ok(!out.includes("# Project Context"));
		assert.ok(out.startsWith("USER SUPPLIED PROMPT"),
			"customPrompt should be the leading clause");
	});
});

// ── regression guard: BOTH branches inject Project Context ───────────────────

describe("buildSystemPrompt: parallel injection contract (regression guard)", () => {
	it("BOTH the main template AND the customPrompt branch inject Project Context", () => {
		// This is the property the original regression broke: only the
		// customPrompt branch kept its Project Context block. The test
		// fails if either branch ever silently drops the block.
		const contextFiles = [
			{ path: "/Users/cunyu666/Dev/catui/AGENT.md", content: "SHARED_CONTEXT_MARKER" },
		];

		const mainPath = buildSystemPrompt({ selectedTools: ["read", "bash"], contextFiles });
		const customPath = buildSystemPrompt({
			selectedTools: ["read", "bash"],
			customPrompt: "CUSTOM",
			contextFiles,
		});

		assert.ok(mainPath.includes("# Project Context"),
			"main template path must inject Project Context (regression guard)");
		assert.ok(mainPath.includes("SHARED_CONTEXT_MARKER"),
			"main template path must inject context file content");

		assert.ok(customPath.includes("# Project Context"),
			"customPrompt path must inject Project Context (regression guard)");
		assert.ok(customPath.includes("SHARED_CONTEXT_MARKER"),
			"customPrompt path must inject context file content");
	});
});
