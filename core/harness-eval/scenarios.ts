/**
 * [WHO]: Built-in harness eval manifest and eight semantic regression fixtures
 * [FROM]: Depends on deterministic eval contexts and agent-core trace recording
 * [TO]: Consumed by scripts/harness-eval.ts and CI
 * [HERE]: core/harness-eval/scenarios.ts - required offline evaluation corpus
 */
import { InMemoryRunTraceSink, RunTraceRecorder, type TraceToolOutcome } from "@catui/agent-core";
import type { HarnessEvalContext, HarnessEvalFixture, HarnessEvalManifest } from "./types.js";

type ScenarioKind =
	| "policy-ordering"
	| "approval-checkpoint"
	| "livelock"
	| "tool-exception-pairing"
	| "steering-followup"
	| "recovery-continuation"
	| "compaction-boundary"
	| "concurrent-safe-tools";

const scenarioKinds: readonly ScenarioKind[] = [
	"policy-ordering",
	"approval-checkpoint",
	"livelock",
	"tool-exception-pairing",
	"steering-followup",
	"recovery-continuation",
	"compaction-boundary",
	"concurrent-safe-tools",
];

export const BUILTIN_HARNESS_EVAL_MANIFEST: HarnessEvalManifest = {
	version: 1,
	thresholds: {
		minimumPassRate: 1,
		maximumReplayDivergences: 0,
		maximumPolicyViolations: 0,
		maximumUnpairedToolCalls: 0,
	},
	scenarios: scenarioKinds.map((kind) => ({ id: kind, fixture: kind, frameworks: "both" })),
};

async function emitTool(
	recorder: RunTraceRecorder,
	id: string,
	outcome: TraceToolOutcome,
	options: { policy?: "allow" | "deny" | "pause"; start?: boolean } = {},
): Promise<void> {
	await recorder.record("tool.requested", { toolCallId: id, toolName: "fixture", inputFingerprint: `sha256:input-${id}` });
	if (options.policy) {
		await recorder.record("policy.decided", { toolCallId: id, policyId: `policy-${id}`, decision: options.policy, inputFingerprint: `sha256:input-${id}` });
	}
	if (options.start !== false) await recorder.record("tool.started", { toolCallId: id, toolName: "fixture" });
	await recorder.record("tool.completed", { toolCallId: id, toolName: "fixture", outcome, outputFingerprint: `sha256:output-${id}` });
}

function fixture(kind: ScenarioKind): HarnessEvalFixture {
	return async (context: HarnessEvalContext) => {
		const sink = new InMemoryRunTraceSink();
		const recorder = new RunTraceRecorder({
			runId: `${context.scenarioId}-${context.framework}`,
			sink,
			now: context.now,
			createEventId: context.nextId,
			failureMode: "required",
		});
		await recorder.record("run.started", { loopFramework: context.framework, inputFingerprint: "sha256:input" });
		await recorder.record("turn.started", { turn: 1 }, { turnId: "turn-1" });
		await recorder.record("model.requested", { turn: 1, requestFingerprint: "sha256:request" }, { turnId: "turn-1" });
		await recorder.record("model.responded", { turn: 1, stopReason: "toolUse", responseFingerprint: "sha256:response" }, { turnId: "turn-1" });

		let toolCallCount = 0;
		switch (kind) {
			case "policy-ordering":
				await emitTool(recorder, "policy", "success", { policy: "allow" });
				toolCallCount = 1;
				break;
			case "approval-checkpoint":
				await recorder.record("tool.requested", { toolCallId: "approval", toolName: "fixture", inputFingerprint: "sha256:approval" });
				await recorder.record("policy.decided", { toolCallId: "approval", policyId: "human", decision: "pause", inputFingerprint: "sha256:approval" });
				await recorder.record("checkpoint.created", { checkpointId: "checkpoint-1", policyId: "human", toolCallId: "approval" });
				await recorder.record("checkpoint.resolved", { checkpointId: "checkpoint-1", resolution: "approved" });
				await recorder.record("tool.completed", { toolCallId: "approval", toolName: "fixture", outcome: "paused", outputFingerprint: "sha256:paused" });
				toolCallCount = 1;
				break;
			case "livelock":
				await emitTool(recorder, "repeat", "error");
				await recorder.record("progress.observed", { fingerprint: "sha256:repeat", repeatCount: 3, outcome: "error" });
				await recorder.record("transition.applied", { reason: "livelock_detected", transitionFingerprint: "sha256:livelock" });
				toolCallCount = 1;
				break;
			case "tool-exception-pairing":
				await emitTool(recorder, "exception", "error");
				toolCallCount = 1;
				break;
			case "steering-followup":
				await recorder.record("transition.applied", { reason: "follow_up", transitionFingerprint: "sha256:follow-up" });
				break;
			case "recovery-continuation":
				await recorder.record("transition.applied", { reason: "model_error_recovery", transitionFingerprint: "sha256:recovery" });
				break;
			case "compaction-boundary":
				await recorder.record("transition.applied", { reason: "context_compacted", transitionFingerprint: "sha256:compaction" });
				break;
			case "concurrent-safe-tools":
				await recorder.record("tool.requested", { toolCallId: "parallel-a", toolName: "fixture", inputFingerprint: "sha256:a" });
				await recorder.record("tool.requested", { toolCallId: "parallel-b", toolName: "fixture", inputFingerprint: "sha256:b" });
				await recorder.record("tool.started", { toolCallId: "parallel-a", toolName: "fixture" });
				await recorder.record("tool.started", { toolCallId: "parallel-b", toolName: "fixture" });
				await recorder.record("tool.completed", { toolCallId: "parallel-b", toolName: "fixture", outcome: "success", outputFingerprint: "sha256:b-out" });
				await recorder.record("tool.completed", { toolCallId: "parallel-a", toolName: "fixture", outcome: "success", outputFingerprint: "sha256:a-out" });
				toolCallCount = 2;
				break;
		}

		await recorder.record("turn.completed", { turn: 1, stopReason: "stop", outputFingerprint: "sha256:output" }, { turnId: "turn-1" });
		await recorder.record("run.completed", { stopReason: "stop", turnCount: 1, toolCallCount, outputFingerprint: "sha256:output" });
		await recorder.flush();
		const recorded = sink.snapshot();
		return { recorded, observed: structuredClone(recorded), policyViolations: 0 };
	};
}

export const BUILTIN_HARNESS_EVAL_FIXTURES: Readonly<Record<string, HarnessEvalFixture>> = Object.fromEntries(
	scenarioKinds.map((kind) => [kind, fixture(kind)]),
);
