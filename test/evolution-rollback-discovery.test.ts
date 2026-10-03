/**
 * [WHO]: Proves a rolled-back revision disappears from real skill discovery and reload
 * [FROM]: Depends on node:test/assert/fs/os/path, the evolution store's public API, and the real resource loader
 * [TO]: Consumed by test:evolution; implements SL02 and the S08 rollback-discovery acceptance
 * [HERE]: test/evolution-rollback-discovery.test.ts - S08 rollback vs active discovery coverage
 *
 * The prior behavior kept a rolled-back revision discoverable: `discoverResources` unions the
 * active-revision scan with a historical scan over every revision ever promoted, and rollback
 * only moved the `current` pointer. These tests drive the real store, then a real
 * DefaultResourceLoader reload, so "active" means what the loader actually serves.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	discoverLocalSkillPaths,
	loadActiveEvolutionSkillPaths,
	promoteEvolutionCandidate,
	readWithdrawnRevisionIds,
	rollbackEvolution,
} from "../extensions/optional/evolution/evolution-store.js";
import type { EvolutionArtifact, EvolutionCandidate, EvolutionCandidateInput } from "../extensions/optional/evolution/evolution-types.js";
import { passingEvolutionGate } from "./helpers/evolution-benchmark.js";
import { DefaultResourceLoader } from "../core/platform/config/resource-loader.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";

function promoteSkillRevision(scopeRoot: string, input: EvolutionCandidateInput): string {
	const candidate = createEvolutionCandidate(scopeRoot, input);
	const revision = promoteEvolutionCandidate(scopeRoot, candidate.id, {
		approvedBy: "test",
		gateReport: passingEvolutionGate(candidate),
	});
	return revision.id;
}

function currentRevisionId(scopeRoot: string): string {
	return JSON.parse(readFileSync(join(scopeRoot, "current.json"), "utf8")).revisionId;
}

/**
 * `label` is what these rollback tests distinguish skills by; the body only has to be a compliant
 * skill, so it is built here rather than repeated at every call site.
 */
function artifact(id: string, label: string): EvolutionArtifact {
	return {
		kind: "skill_manifest",
		id,
		title: `Skill ${id}`,
		content: [
			"## Prerequisites",
			"The matching task is already identified.",
			"",
			"## Steps",
			label,
			"",
			"## Pitfalls",
			"Do not widen this to unrelated tasks.",
			"",
			"## Verification",
			"Confirm the matching task's own success signal.",
		].join("\n"),
		applicability: "When the matching task appears.",
		nonApplicability: "Not for unrelated tasks.",
	};
}

function candidateInput(skills: EvolutionArtifact[]): EvolutionCandidateInput {
	return {
		scope: "session",
		summary: "seed skills",
		rationale: "fixture",
		expectedOutcome: "skills become discoverable",
		artifacts: skills,
		autoPromote: false,
	};
}

function withScopeRoot(run: (scopeRoot: string) => void | Promise<void>): Promise<void> {
	// A real scope root, not a bare directory: the store now derives the scope from the root it is
	// given and refuses a candidate whose declared scope disagrees with it.
	const root = mkdtempSync(join(tmpdir(), "catui-evo-rollback-"));
	const scopeRoot = getEvolutionScopeRoot(join(root, "agent"), { scope: "session", sessionId: "rollback-test" });
	return Promise.resolve(run(scopeRoot)).finally(() => rmSync(root, { recursive: true, force: true }));
}

/** Skill names a DefaultResourceLoader actually serves for these skill paths. */
async function discoveredSkillNames(paths: readonly string[]): Promise<string[]> {
	const cwd = mkdtempSync(join(tmpdir(), "catui-evo-loader-"));
	try {
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: cwd,
			settingsManager: SettingsManager.inMemory(),
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
			additionalSkillPaths: [...paths],
		});
		await loader.reload();
		return loader.getSkills().skills.map((skill) => skill.name).sort();
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("rollback withdraws that revision from both scans while keeping unrelated skills", async () => {
	await withScopeRoot(async (scopeRoot) => {
		// r1 seeds a good skill; r2 supersedes it with a bad one.
		const r1RevisionId = promoteSkillRevision(scopeRoot, candidateInput([artifact("evolved:skill_manifest:good", "Good procedure.")]));
		const r2RevisionId = promoteSkillRevision(scopeRoot, candidateInput([
			artifact("evolved:skill_manifest:good", "Good procedure."),
			artifact("evolved:skill_manifest:bad", "Bad procedure."),
		]));
		assert.notEqual(r1RevisionId, r2RevisionId);

		// A third, unrelated skill exists only in an earlier revision.
		const before = [...loadActiveEvolutionSkillPaths(scopeRoot), ...discoverLocalSkillPaths(scopeRoot)];
		assert.ok(
			(await discoveredSkillNames(before)).includes("evolved-bad"),
			"precondition: the current revision's bad skill is discoverable",
		);

		// Roll back r2 to r1.
		rollbackEvolution(scopeRoot, r1RevisionId, { requestedBy: "test" });

		assert.deepEqual(
			[...readWithdrawnRevisionIds(scopeRoot)],
			[r2RevisionId],
			"the rolled-back revision must be recorded as withdrawn",
		);

		const after = [...loadActiveEvolutionSkillPaths(scopeRoot), ...discoverLocalSkillPaths(scopeRoot)];
		const names = await discoveredSkillNames(after);
		assert.equal(names.includes("evolved-bad"), false, "withdrawn revision's skill must not be discoverable");
		assert.ok(names.includes("evolved-good"), "the rolled-back-to revision's skill must still be discoverable");
	});
});

test("a withdrawn revision's materialized directory is removed, not just unreferenced", async () => {
	await withScopeRoot(async (scopeRoot) => {
		const r1 = promoteSkillRevision(scopeRoot, candidateInput([artifact("evolved:skill_manifest:a", "A.")]));
		const r2 = promoteSkillRevision(scopeRoot, candidateInput([artifact("evolved:skill_manifest:b", "B.")]));

		discoverLocalSkillPaths(scopeRoot);
		const materialized = join(scopeRoot, "resources", "skills", "_local", r2);
		assert.ok(existsSync(materialized), "precondition: the historical scan materialized r2");

		rollbackEvolution(scopeRoot, r1, { requestedBy: "test" });
		discoverLocalSkillPaths(scopeRoot);
		assert.equal(existsSync(materialized), false, "withdrawn revision's on-disk skills must be deleted");
	});
});

test("a second rollback does not resurrect the first withdrawn revision", async () => {
	await withScopeRoot(async (scopeRoot) => {
		const mk = (id: string) => promoteSkillRevision(scopeRoot, candidateInput([artifact(`evolved:skill_manifest:${id}`, `${id}.`)]));
		const r1 = mk("one");
		const r2 = mk("two");
		rollbackEvolution(scopeRoot, r1, { requestedBy: "test" });

		const r3 = mk("three");
		rollbackEvolution(scopeRoot, r1, { requestedBy: "test" });

		const withdrawn = readWithdrawnRevisionIds(scopeRoot);
		assert.ok(withdrawn.has(r2), "the first withdrawn revision must still be withdrawn");
		assert.ok(withdrawn.has(r3), "the second withdrawn revision must be withdrawn");
		assert.equal(discoverLocalSkillPaths(scopeRoot).some((p) => p.endsWith(r2)), false);
		assert.equal(discoverLocalSkillPaths(scopeRoot).some((p) => p.endsWith(r3)), false);
	});
});

test("a malformed history log degrades to nothing withdrawn rather than throwing", async () => {
	await withScopeRoot(async (scopeRoot) => {
		promoteSkillRevision(scopeRoot, candidateInput([artifact("evolved:skill_manifest:x", "X.")]));
		appendCorruptHistory(scopeRoot);
		assert.deepEqual([...readWithdrawnRevisionIds(scopeRoot)], []);
		assert.ok(discoverLocalSkillPaths(scopeRoot).length > 0, "discovery must keep working");
	});
});

function appendCorruptHistory(scopeRoot: string): void {
	// A truncated JSON line must not break resource discovery.
	mkdirSync(scopeRoot, { recursive: true, mode: 0o700 });
	appendFileSync(join(scopeRoot, "history.jsonl"), '{"event":"rolled_back","rollbackOf"\n', { encoding: "utf8", mode: 0o600 });
}

test("skills unrelated to the rollback stay discoverable", async () => {
	await withScopeRoot(async (scopeRoot) => {
		// r1 carries two skills; r2 supersedes with a third. Rolling back r2 must keep both
		// original skills and drop only what r2 added.
		const r1 = promoteSkillRevision(scopeRoot, candidateInput([
			artifact("evolved:skill_manifest:keep1", "Keep one."),
			artifact("evolved:skill_manifest:keep2", "Keep two."),
		]));
		promoteSkillRevision(scopeRoot, candidateInput([
			artifact("evolved:skill_manifest:keep1", "Keep one."),
			artifact("evolved:skill_manifest:keep2", "Keep two."),
			artifact("evolved:skill_manifest:added", "Added later."),
		]));
		rollbackEvolution(scopeRoot, r1, { requestedBy: "test" });

		const names = await discoveredSkillNames([...loadActiveEvolutionSkillPaths(scopeRoot), ...discoverLocalSkillPaths(scopeRoot)]);
		assert.ok(names.includes("evolved-keep1"));
		assert.ok(names.includes("evolved-keep2"));
		assert.equal(names.includes("evolved-added"), false);
	});
});
