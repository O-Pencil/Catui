/**
 * [WHO]: Versioned evolution store persistence, concurrency, promotion, and rollback tests
 * [FROM]: Depends on node:test/assert/fs/os/path and optional evolution store/types
 * [TO]: Guards the immutable ledger and atomic champion pointer
 * [HERE]: test/evolution-store.test.ts - durable self-evolution store coverage
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { workspaceKeyForPath, EvolutionStore } from "../extensions/optional/evolution/store.ts";
import type { EvolutionProposal, GateEvidence } from "../extensions/optional/evolution/types.ts";

function proposal(id: string, baselineRevisionId: string | null): EvolutionProposal {
	return {
		schemaVersion: 1,
		id,
		scope: "workspace",
		baselineRevisionId,
		summary: `Candidate ${id}`,
		expectedOutcome: "Reduce repeated verification omissions",
		createdAt: "2026-08-09T00:00:00.000Z",
		provenance: { trigger: "manual", sessionId: "session-1", traceRefs: ["trace:sha256:abc"] },
		artifacts: [{
			schemaVersion: 1,
			id: `evolved:memory:${id}`,
			kind: "memory",
			title: "Verification convention",
			content: `Run verification for ${id}.`,
			scope: "workspace",
			version: 1,
			createdAt: "2026-08-09T00:00:00.000Z",
			applicability: ["Completion work"],
			nonApplicability: ["Concept-only answers"],
			promptTokenBudget: 64,
			dependencies: [],
			expectedOutcome: "Verification evidence is present",
			provenance: { sourceCandidateId: id, trigger: "manual", traceRefs: ["trace:sha256:abc"] },
		}],
	};
}

async function createStore(): Promise<{ store: EvolutionStore; agentDir: string; cwd: string }> {
	const root = await mkdtemp(join(tmpdir(), "catui-evolution-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "workspace");
	await import("node:fs/promises").then(({ mkdir }) => mkdir(cwd, { recursive: true }));
	return { store: new EvolutionStore({ agentDir, cwd, sessionId: "session-1" }), agentDir, cwd };
}

async function writePassingEvidence(store: EvolutionStore, candidateId: string): Promise<void> {
	for (const item of [
		{ gate: "static", details: {} },
		{ gate: "replay", details: { lifecyclePreserved: true, toolPairsPreserved: true, policyPreserved: true } },
		{ gate: "eval", details: { matchedScenarios: ["verify-completion"], nonInferior: true, improvement: true } },
	] as const) {
		await store.writeEvidence("workspace", candidateId, {
			schemaVersion: 1,
			gate: item.gate,
			passed: true,
			createdAt: "2026-08-09T00:01:00.000Z",
			summary: `${item.gate} passed`,
			details: item.details,
		});
	}
}

test("workspace keys are deterministic, canonical, and do not disclose the raw path", async () => {
	const { cwd } = await createStore();
	const first = await workspaceKeyForPath(cwd);
	const second = await workspaceKeyForPath(join(cwd, "."));
	assert.equal(first, second);
	assert.match(first, /^[a-f0-9]{32}$/);
	assert.equal(first.includes(cwd), false);
});

test("creates candidates lazily with private immutable proposal and artifact files", async () => {
	const { store, agentDir } = await createStore();
	const input = proposal("candidate-a", null);
	const location = await store.createCandidate("workspace", input);
	assert.match(location, /evolution\/v1\/workspaces\/[a-f0-9]{32}\/candidates\/candidate-a$/);
	assert.equal((await stat(join(location, "proposal.json"))).mode & 0o777, 0o600);
	assert.equal((await stat(join(location, "artifacts", "memories", "evolved_memory_candidate-a.json"))).mode & 0o777, 0o600);
	await assert.rejects(() => store.createCandidate("workspace", input), /already exists/i);
	await assert.rejects(() => stat(join(agentDir, "evolution", "v1", "global")));
});

test("rejects a symlinked evolution root instead of escaping agentDir", async () => {
	const { store, agentDir } = await createStore();
	const outside = await mkdtemp(join(tmpdir(), "catui-evolution-outside-"));
	await mkdir(agentDir, { recursive: true });
	await symlink(outside, join(agentDir, "evolution"));
	await assert.rejects(() => store.createCandidate("workspace", proposal("candidate-a", null)), /symlink/i);
	await assert.rejects(() => stat(join(outside, "v1")));
});

test("writes each evidence gate once", async () => {
	const { store } = await createStore();
	await store.createCandidate("workspace", proposal("candidate-a", null));
	const evidence: GateEvidence = {
		schemaVersion: 1,
		gate: "static",
		passed: true,
		createdAt: "2026-08-09T00:01:00.000Z",
		summary: "Schema passed",
		details: {},
	};
	await store.writeEvidence("workspace", "candidate-a", evidence);
	await assert.rejects(() => store.writeEvidence("workspace", "candidate-a", evidence), /already exists/i);
});

test("promotes a complete content-addressed revision and appends history", async () => {
	const { store } = await createStore();
	await store.createCandidate("workspace", proposal("candidate-a", null));
	await writePassingEvidence(store, "candidate-a");
	const result = await store.promote("workspace", "candidate-a");
	assert.match(result.revisionId, /^rev_[a-f0-9]{32}$/);
	assert.equal(result.previousRevisionId, null);
	assert.equal((await store.getCurrent("workspace"))?.revisionId, result.revisionId);
	const manifest = await store.readActiveManifest("workspace");
	assert.equal(manifest?.candidateId, "candidate-a");
	const history = await readFile((await store.scopePaths("workspace")).historyPath, "utf8");
	assert.match(history, /"event":"promoted"/);
});

test("refuses promotion when hard replay and effectiveness evidence is absent", async () => {
	const { store } = await createStore();
	await store.createCandidate("workspace", proposal("candidate-a", null));
	await assert.rejects(() => store.promote("workspace", "candidate-a"), /evidence/i);
	assert.equal(await store.getCurrent("workspace"), undefined);
});

test("restores the previous pointer when history append fails", async () => {
	const { store } = await createStore();
	await store.createCandidate("workspace", proposal("candidate-a", null));
	await writePassingEvidence(store, "candidate-a");
	const paths = await store.scopePaths("workspace");
	await mkdir(paths.historyPath, { recursive: true });
	await assert.rejects(() => store.promote("workspace", "candidate-a"));
	assert.equal(await store.getCurrent("workspace"), undefined);
});

test("recovers an activation lock owned by a dead process", async () => {
	const { store } = await createStore();
	await store.createCandidate("workspace", proposal("candidate-a", null));
	await writePassingEvidence(store, "candidate-a");
	const paths = await store.scopePaths("workspace");
	await writeFile(paths.lockPath, "99999999\n", { mode: 0o600 });
	assert.match((await store.promote("workspace", "candidate-a")).revisionId, /^rev_/);
});

test("rejects stale baselines and preserves the champion", async () => {
	const { store } = await createStore();
	await store.createCandidate("workspace", proposal("candidate-a", null));
	await writePassingEvidence(store, "candidate-a");
	const first = await store.promote("workspace", "candidate-a");
	await store.createCandidate("workspace", proposal("candidate-stale", null));
	await writePassingEvidence(store, "candidate-stale");
	await assert.rejects(() => store.promote("workspace", "candidate-stale"), /baseline/i);
	assert.equal((await store.getCurrent("workspace"))?.revisionId, first.revisionId);
});

test("rolls back by atomically activating an existing immutable revision", async () => {
	const { store } = await createStore();
	await store.createCandidate("workspace", proposal("candidate-a", null));
	await writePassingEvidence(store, "candidate-a");
	const first = await store.promote("workspace", "candidate-a");
	await store.createCandidate("workspace", proposal("candidate-b", first.revisionId));
	await writePassingEvidence(store, "candidate-b");
	const second = await store.promote("workspace", "candidate-b");
	const rolledBack = await store.rollback("workspace", first.revisionId);
	assert.equal(rolledBack.revisionId, first.revisionId);
	assert.equal(rolledBack.previousRevisionId, second.revisionId);
	assert.equal((await store.readActiveManifest("workspace"))?.candidateId, "candidate-a");
});
