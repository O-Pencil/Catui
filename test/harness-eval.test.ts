import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { runHarnessEval, validateHarnessEvalManifest } from "../core/harness-eval/runner.js";
import type { HarnessEvalFixture, HarnessEvalManifest } from "../core/harness-eval/types.js";
import type { RunTraceEventV1 } from "@catui/agent-core";

function trace(framework: "standard" | "weak-model-compatible"): RunTraceEventV1[] {
	return [
		{ version: 1, eventId: "e1", sequence: 1, timestamp: 1, runId: "run", kind: "run.started", payload: { loopFramework: framework, inputFingerprint: "sha256:in" } },
		{ version: 1, eventId: "e2", sequence: 2, timestamp: 2, runId: "run", kind: "run.completed", payload: { stopReason: "stop", turnCount: 0, toolCallCount: 0, outputFingerprint: "sha256:out" } },
	];
}

const manifest: HarnessEvalManifest = {
	version: 1,
	thresholds: { minimumPassRate: 1, maximumReplayDivergences: 0, maximumPolicyViolations: 0, maximumUnpairedToolCalls: 0 },
	scenarios: [{ id: "smoke", fixture: "smoke", frameworks: "both" }],
};

test("harness eval expands both frameworks with deterministic isolated contexts", async () => {
	const workspaces: string[] = [];
	const fixture: HarnessEvalFixture = async (context) => {
		workspaces.push(context.workspace);
		assert.equal(context.networkEnabled, false);
		assert.equal(context.now(), 1);
		assert.equal(context.now(), 2);
		assert.equal(context.nextId(), "eval-1");
		await assert.rejects(context.fetch("https://example.com"), /disabled/i);
		return { recorded: trace(context.framework), observed: trace(context.framework), policyViolations: 0 };
	};
	const report = await runHarnessEval(manifest, { smoke: fixture });
	assert.equal(report.passed, true);
	assert.equal(report.results.length, 2);
	assert.deepEqual(report.metrics, { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 });
	for (const workspace of workspaces) await assert.rejects(access(workspace));
});

test("harness eval fails closed on a replay divergence and threshold breach", async () => {
	const fixture: HarnessEvalFixture = async (context) => {
		const observed = trace(context.framework);
		observed[1] = { ...observed[1], payload: { ...observed[1].payload, outputFingerprint: "sha256:changed" } } as RunTraceEventV1;
		return { recorded: trace(context.framework), observed, policyViolations: 1 };
	};
	const report = await runHarnessEval(manifest, { smoke: fixture });
	assert.equal(report.passed, false);
	assert.equal(report.metrics.replayDivergences, 2);
	assert.equal(report.metrics.policyViolations, 2);
	assert.match(report.results[0].failure ?? "", /diverged/i);
});

test("harness eval validates manifests and missing fixture registrations", async () => {
	assert.throws(() => validateHarnessEvalManifest({ version: 2 }), /version/i);
	assert.throws(() => validateHarnessEvalManifest({ version: 1, scenarios: [] }), /scenario/i);
	await assert.rejects(runHarnessEval(manifest, {}), /fixture.*smoke/i);
});

test("harness eval runs isolated, sequential, and interleaved stream scenarios", async () => {
	const observed: string[] = [];
	const streamManifest: HarnessEvalManifest = {
		version: 1,
		thresholds: { minimumPassRate: 1, maximumReplayDivergences: 0, maximumPolicyViolations: 0, maximumUnpairedToolCalls: 0 },
		streams: [
			{ id: "isolated-stream", mode: "isolated", scenarios: ["alpha", "beta"] },
			{ id: "sequential-stream", mode: "sequential", scenarios: ["alpha", "beta"] },
			{ id: "interleaved-stream", mode: "interleaved", scenarios: ["alpha", "beta"] },
		],
		scenarios: [
			{ id: "alpha", fixture: "alpha", frameworks: ["standard"] },
			{ id: "beta", fixture: "beta", frameworks: ["standard"] },
		],
	};
	const fixture = (name: string): HarnessEvalFixture => async (context) => {
		observed.push(`${context.streamId}:${context.streamMode}:${context.scenarioId}:${context.streamPosition}:${context.workspace}`);
		return { recorded: trace(context.framework), observed: trace(context.framework), policyViolations: 0 };
	};

	const report = await runHarnessEval(streamManifest, { alpha: fixture("alpha"), beta: fixture("beta") });

	assert.equal(report.passed, true);
	assert.equal(report.streams?.length, 3);
	assert.deepEqual(report.streams?.map((stream) => stream.mode), ["isolated", "sequential", "interleaved"]);
	assert.equal(report.streams?.find((stream) => stream.id === "sequential-stream")?.results.length, 2);
	assert.equal(report.streams?.find((stream) => stream.id === "interleaved-stream")?.results.map((result) => result.scenarioId).join(","), "alpha,beta");
	const sequentialWorkspaces = observed
		.filter((entry) => entry.startsWith("sequential-stream:"))
		.map((entry) => entry.split(":").at(-1));
	assert.equal(new Set(sequentialWorkspaces).size, 1);
	const isolatedWorkspaces = observed
		.filter((entry) => entry.startsWith("isolated-stream:"))
		.map((entry) => entry.split(":").at(-1));
	assert.equal(new Set(isolatedWorkspaces).size, 2);
});
