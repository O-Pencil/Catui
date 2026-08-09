/**
 * [WHO]: Declarative self-evolution proposal validation regression tests
 * [FROM]: Depends on node:test, node:assert, and optional evolution schema/types
 * [TO]: Guards the v1 generated-artifact trust boundary
 * [HERE]: test/evolution-schema.test.ts - schema and hostile-content coverage
 */
import assert from "node:assert/strict";
import test from "node:test";
import { validateProposal } from "../extensions/optional/evolution/schema.ts";
import type { EvolutionProposal } from "../extensions/optional/evolution/types.ts";

function proposal(overrides: Partial<EvolutionProposal> = {}): EvolutionProposal {
	return {
		schemaVersion: 1,
		id: "candidate-1",
		scope: "workspace",
		baselineRevisionId: null,
		summary: "Remember the project verification command",
		expectedOutcome: "The agent runs verify:all before completion claims",
		createdAt: "2026-08-09T00:00:00.000Z",
		provenance: {
			trigger: "manual",
			sessionId: "session-1",
			traceRefs: ["trace:sha256:abc"],
		},
		artifacts: [
			{
				schemaVersion: 1,
				id: "evolved:prompt_note:verify-before-completion",
				kind: "prompt_note",
				title: "Verify before completion",
				content: "Run the repository verification command before claiming completion.",
				scope: "workspace",
				version: 1,
				createdAt: "2026-08-09T00:00:00.000Z",
				applicability: ["When making a completion claim in this workspace"],
				nonApplicability: ["When only answering a conceptual question"],
				promptTokenBudget: 80,
				dependencies: [],
				expectedOutcome: "Verification evidence appears before completion claims",
				provenance: {
					sourceCandidateId: "candidate-1",
					trigger: "manual",
					traceRefs: ["trace:sha256:abc"],
				},
			},
		],
		...overrides,
	};
}

test("accepts a bounded declarative prompt-note proposal", () => {
	assert.deepEqual(validateProposal(proposal()), { ok: true, proposal: proposal() });
});

test("rejects artifact ids outside the evolved namespace", () => {
	const input = proposal();
	input.artifacts[0] = { ...input.artifacts[0]!, id: "builtin:verify" };
	const result = validateProposal(input);
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.issues.join(" "), /evolved:prompt_note:/);
});

test("rejects malformed or ambiguous evolved id suffixes", () => {
	for (const id of ["evolved:prompt_note:a:b", "evolved:prompt_note:../escape", "evolved:prompt_note:Upper Case"]) {
		const input = proposal();
		input.artifacts[0] = { ...input.artifacts[0]!, id };
		const result = validateProposal(input);
		assert.equal(result.ok, false, id);
		if (!result.ok) assert.match(result.issues.join(" "), /id/i);
	}
});

test("rejects executable, network, secret-like, and path-bearing content", () => {
	for (const content of [
		"command: npm install unsafe-package",
		"Call https://example.invalid/tool",
		"Use API_KEY=sk-secret-value",
		"Write /Users/alice/project/tool.ts",
	]) {
		const input = proposal();
		input.artifacts[0] = { ...input.artifacts[0]!, kind: "tool_spec", id: "evolved:tool_spec:unsafe", content };
		const result = validateProposal(input);
		assert.equal(result.ok, false, content);
	}
});

test("rejects unknown kinds, duplicate ids, and excessive content", () => {
	const input = proposal();
	input.artifacts = [
		{ ...input.artifacts[0]!, kind: "script" as "prompt_note", id: "evolved:script:x" },
		{ ...input.artifacts[0]!, content: "x".repeat(20_001) },
		{ ...input.artifacts[0]! },
	];
	const result = validateProposal(input);
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.match(result.issues.join(" "), /kind/i);
		assert.match(result.issues.join(" "), /duplicate/i);
		assert.match(result.issues.join(" "), /20,000/i);
	}
});

test("requires applicability, non-applicability, and provenance evidence", () => {
	const input = proposal();
	input.artifacts[0] = {
		...input.artifacts[0]!,
		applicability: [],
		nonApplicability: [],
		provenance: { sourceCandidateId: "", trigger: "", traceRefs: [] },
	};
	const result = validateProposal(input);
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.issues.join(" "), /applicability|provenance/i);
});
