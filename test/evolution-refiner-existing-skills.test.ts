/**
 * [WHO]: Proves the refiner sees already-active artifacts at the target scope before proposing
 * [FROM]: Depends on node:test/assert/fs/os/path, the real refiner, and a real promoted revision
 * [TO]: Consumed by test:evolution-boundaries; covers S06.3 retrieval so a refinement updates one artifact instead of duplicating it
 * [HERE]: test/evolution-refiner-existing-skills.test.ts - S06.3 existing-artifact retrieval coverage
 *
 * The inventory is only useful if it names the artifacts the model would otherwise duplicate, so
 * these tests promote a real revision and then read the prompt the refiner actually sent. They
 * also pin the two properties that make the listing trustworthy rather than noisy: it is scoped
 * to the same root the candidate will be written to, and it travels the same redaction path as
 * session text.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planEvolutionCandidate } from "../extensions/optional/evolution/evolution-refiner.js";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	promoteEvolutionCandidate,
} from "../extensions/optional/evolution/evolution-store.js";
import { compareEvolutionBenchmarks, DEFAULT_EVOLUTION_BENCHMARK_POLICY } from "../extensions/optional/evolution/benchmark-comparison.js";
import type { EvolutionBenchmarkRunV1, EvolutionBenchmarkSnapshotV1 } from "../extensions/optional/evolution/benchmark-types.js";
import type { EvolutionCandidate, EvolutionGateReport } from "../extensions/optional/evolution/evolution-types.js";
import type { ExtensionCommandContext } from "../core/extensions-host/types.js";

const SESSION_ID = "existing-skills-test";

function runs(role: "baseline" | "candidate"): EvolutionBenchmarkRunV1[] {
	return Array.from({ length: 40 }, (_, task) => Array.from({ length: 3 }, (_, repetition) => {
		const success = task < (role === "baseline" ? 20 : 30);
		return {
			taskId: `task-${task}`,
			repetition: repetition + 1,
			split: "heldout" as const,
			slices: [task % 2 === 0 ? "coding" : "tool-use"],
			success,
			score: success ? 1 : 0,
			costUsd: 1,
			latencyMs: 1_000,
			policyViolations: 0,
			replayDivergences: 0,
			unpairedToolCalls: 0,
		};
	})).flat();
}

function snapshot(role: "baseline" | "candidate", candidate: EvolutionCandidate): EvolutionBenchmarkSnapshotV1 {
	return {
		schemaVersion: 1,
		kind: "catui-evolution-benchmark-snapshot",
		role,
		...(role === "candidate" ? { candidateId: candidate.id, candidateContentHash: candidate.contentHash } : {}),
		createdAt: "2026-08-25T00:00:00.000Z",
		corpus: { id: "pawbench", version: "1.0", digest: `sha256:${"a".repeat(64)}` },
		harness: { revisionId: role, commitSha: "a".repeat(40) },
		execution: { model: "frozen-model", modelVersion: "v1", temperature: 0, maxTokens: 32_768, timeoutMs: 60_000, budgetUsd: 100 },
		runs: runs(role),
	};
}

/** Real integrity-bound evidence, produced by the real comparator rather than hand-written. */
function gateFor(candidate: EvolutionCandidate): EvolutionGateReport {
	return {
		name: "builtin-harness-eval+heldout-benchmark",
		passed: true,
		checkedAt: "2026-08-25T01:00:00.000Z",
		metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
		benchmark: compareEvolutionBenchmarks(
			snapshot("baseline", candidate),
			snapshot("candidate", candidate),
			DEFAULT_EVOLUTION_BENCHMARK_POLICY,
			{
				candidateId: candidate.id,
				baselineRevisionId: candidate.baselineRevisionId ?? null,
				checkedAt: "2026-08-25T01:00:00.000Z",
			},
		),
	};
}

interface Seen {
	user?: string;
}

function context(agentDir: string, cwd: string, seen: Seen, sessionId = SESSION_ID): ExtensionCommandContext {
	return {
		agentDir,
		cwd,
		sessionManager: {
			getSessionId: () => sessionId,
			getEntries: () => [
				{ type: "message", timestamp: new Date().toISOString(), message: { role: "user", content: "Refine please." } },
			],
		},
		completeSimple: async (_system: string, user: string) => {
			seen.user = user;
			return JSON.stringify({ artifacts: [], predictions: [] });
		},
	} as unknown as ExtensionCommandContext;
}

/**
 * Seeds a real promoted revision at the session scope, then captures the prompt the model receives.
 *
 * `steps` is the text a test cares about; the four required sections are built around it so every
 * seeded skill is one the store would actually accept.
 */
async function withActiveSkill(
	artifact: { id: string; title: string; steps: string },
	run: (seen: Seen) => Promise<void>,
	sessionId = SESSION_ID,
): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-existing-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "work");
	const scopeRoot = getEvolutionScopeRoot(agentDir, { scope: "session", sessionId });
	try {
		const candidate = createEvolutionCandidate(scopeRoot, {
			scope: "session",
			summary: "Existing skill",
			rationale: "Seeded so the refiner has something to reuse.",
			expectedOutcome: "The refiner can reference it.",
			artifacts: [{
				id: artifact.id,
				kind: "skill_manifest",
				title: artifact.title,
				content: [
					"## Prerequisites",
					"The matching task is already identified.",
					"",
					"## Steps",
					artifact.steps,
					"",
					"## Pitfalls",
					"Do not widen this to unrelated tasks.",
					"",
					"## Verification",
					"Confirm the matching task's own success signal.",
				].join("\n"),
				applicability: "When the matching task appears.",
				nonApplicability: "Not for unrelated tasks.",
			}],
			evidence: { source: "test" },
		});
		promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) });

		const seen: Seen = {};
		await planEvolutionCandidate(context(agentDir, cwd, seen, sessionId), "session", "refine");
		await run(seen);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

/** Runs the refiner against a scope with nothing active, capturing the prompt. */
async function capturePromptWithoutActiveArtifacts(sessionId = SESSION_ID): Promise<string> {
	const root = mkdtempSync(join(tmpdir(), "catui-evo-empty-"));
	try {
		const seen: Seen = {};
		await planEvolutionCandidate(context(join(root, "agent"), join(root, "work"), seen, sessionId), "session", "refine");
		assert.ok(seen.user, "the refiner must have issued a completion call");
		return seen.user;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("the refiner is shown the ids and titles of already-active artifacts", async () => {
	await withActiveSkill(
		{ id: "evolved:skill_manifest:run-a-bounded-eval", title: "Run a bounded eval", steps: "Run the bounded eval." },
		async (seen) => {
			assert.ok(seen.user, "the refiner must have issued a completion call");
			assert.match(
				seen.user!,
				/evolved:skill_manifest:run-a-bounded-eval/,
				"the existing skill id must reach the model, or it cannot choose to update it",
			);
			assert.match(seen.user!, /Run a bounded eval/, "the title is what lets the model judge relevance");
			assert.match(seen.user!, /skill_manifest/, "the kind is needed to tell a reusable procedure from a fact");
		},
	);
});

test("the inventory tells the model to reuse an existing id rather than duplicate it", async () => {
	await withActiveSkill(
		{ id: "evolved:skill_manifest:verify-before-claiming", title: "Verify before claiming", steps: "Verify before claiming." },
		async (seen) => {
			assert.match(seen.user!, /Reuse one of these ids/, "reuse must be instructed, not merely implied by listing");
			assert.match(seen.user!, /propose a new id only when nothing above covers it/);
		},
	);
});

test("the inventory lists ids and titles only, never the full body of a live artifact", async () => {
	const content = "SENTINEL_FULL_BODY_OF_LIVE_SKILL that the refiner should not restate";
	await withActiveSkill(
		{ id: "evolved:skill_manifest:body-check", title: "Body check", steps: content },
		async (seen) => {
			assert.equal(
				seen.user!.includes(content),
				false,
				"the model is about to author a competing version; handing it the body invites a copy",
			);
		},
	);
});

test("no inventory section is emitted when nothing is active at the scope", async () => {
	const prompt = await capturePromptWithoutActiveArtifacts();

	assert.equal(
		/Reuse one of these ids/.test(prompt),
		false,
		"an empty inventory must not instruct the model to reuse artifacts that do not exist",
	);
	assert.match(prompt, /User refinement instructions/, "the prompt must still do its original job");
	assert.match(prompt, /Recent session trajectory/, "session evidence must survive the inventory lookup");
});

test("artifacts active at another scope are not listed", async () => {
	// Counter-example for scoping. Both a sibling session and the global scope hold a live skill
	// that a session-scoped refinement must not be pointed at: nothing dedupes ids across scopes
	// when artifacts are assembled for the prompt append, so reusing a foreign id is how a
	// duplicate gets created rather than avoided. A listing that ignored the target scope would
	// instruct the model to do exactly that.
	const root = mkdtempSync(join(tmpdir(), "catui-evo-scope-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "work");
	try {
		const seed = async (scopeRoot: string, scope: "global" | "session", id: string, title: string) => {
			const candidate = createEvolutionCandidate(scopeRoot, {
				scope,
				summary: "Seeded elsewhere",
				rationale: "Belongs to a scope this refinement is not writing to.",
				expectedOutcome: "Proves the inventory is scoped.",
				artifacts: [{
					id,
					kind: "skill_manifest",
					title,
					content: [
						"## Prerequisites",
						"The matching task is already identified.",
						"",
						"## Steps",
						"Work the matching task.",
						"",
						"## Pitfalls",
						"Do not widen this to unrelated tasks.",
						"",
						"## Verification",
						"Confirm the matching task's own success signal.",
					].join("\n"),
					applicability: "When the matching task appears.",
					nonApplicability: "Not for unrelated tasks.",
				}],
				evidence: { source: "test" },
			});
			promoteEvolutionCandidate(scopeRoot, candidate.id, { approvedBy: "test", gateReport: gateFor(candidate) });
		};
		await seed(
			getEvolutionScopeRoot(agentDir, { scope: "session", sessionId: "seeded-session" }),
			"session",
			"evolved:skill_manifest:other-session-only",
			"Other session only",
		);
		await seed(
			getEvolutionScopeRoot(agentDir, { scope: "global" }),
			"global",
			"evolved:skill_manifest:global-only",
			"Global only",
		);

		const seen: Seen = {};
		await planEvolutionCandidate(context(agentDir, cwd, seen, "asking-session"), "session", "refine");

		assert.ok(seen.user);
		assert.equal(
			seen.user!.includes("other-session-only"),
			false,
			"a sibling session's library is not what this candidate would supersede",
		);
		assert.equal(
			seen.user!.includes("global-only"),
			false,
			"a session-scoped candidate must not be told to reuse an id owned by the global scope",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a title carrying a private path in the inventory is still redacted", async () => {
	// The store already refuses to persist a credential in an artifact title, so the only
	// leak-shaped field that can reach the inventory is a path. If this ever passes a raw
	// /Users/... path, the inventory has become a redaction bypass.
	await withActiveSkill(
		{
			id: "evolved:skill_manifest:leaky",
			title: "Read the infra notes in /Users/dana/private/infra first",
			steps: "Read the infra notes.",
		},
		async (seen) => {
			assert.ok(seen.user);
			assert.equal(
				seen.user!.includes("/Users/dana/private/infra"),
				false,
				"a persisted title is historical data and must not bypass redaction",
			);
			assert.match(seen.user!, /\[REDACTED_PATH\]/, "the title is listed, just scrubbed");
			assert.match(seen.user!, /evolved:skill_manifest:leaky/, "the id itself stays usable after redaction");
		},
	);
});

test("the store refuses a credential in an artifact title, so the inventory cannot carry one", async () => {
	// Guards the premise of the redaction test above: if this ever stops throwing, the redaction
	// test is no longer exercising the worst case and must be rewritten.
	const root = mkdtempSync(join(tmpdir(), "catui-evo-guard-"));
	try {
		const scopeRoot = getEvolutionScopeRoot(join(root, "agent"), { scope: "session", sessionId: SESSION_ID });
		assert.throws(
			() => createEvolutionCandidate(scopeRoot, {
				scope: "session",
				summary: "Leaky",
				rationale: "Guards the redaction test premise.",
				expectedOutcome: "Rejected before persistence.",
				artifacts: [
					{
						id: "evolved:skill_manifest:leaky",
						kind: "skill_manifest",
						title: "deploy key sk-proj-abcdefghijklmnopqrstuvwx",
						content: "Steps.",
					},
				],
				evidence: { source: "test" },
			}),
			/executable command, package, credential, or server content/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
