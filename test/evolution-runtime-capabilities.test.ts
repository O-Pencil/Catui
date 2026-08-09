/**
 * [WHO]: Evolution-facing runtime trace, replay, and harness eval capability tests
 * [FROM]: Depends on node:test/assert, ExtensionRunner, AgentSession, and extension host contracts
 * [TO]: Guards read-only evidence ports used by the optional evolution extension
 * [HERE]: test/evolution-runtime-capabilities.test.ts - runtime evidence seam coverage
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionRunner } from "../core/extensions-host/runner.js";
import type { ExtensionRuntime } from "../core/extensions-host/types.js";
import { AgentSession } from "../core/runtime/agent-session.js";

function runtime(): ExtensionRuntime {
	return {
		flagValues: new Map(), pendingProviderRegistrations: [], sendMessage: () => {}, sendUserMessage: () => {},
		executeCommand: async () => false, appendEntry: () => {}, setSessionName: () => {}, getSessionName: () => undefined,
		setLabel: () => {}, getActiveTools: () => [], getAllTools: () => [], setActiveTools: () => {}, getCommands: () => [],
		setModel: async () => false, getThinkingLevel: () => "off", setThinkingLevel: () => {}, isIdle: () => true,
	};
}

test("extension context exposes read-only run trace replay and harness eval capabilities", async () => {
	const shared = runtime();
	const runner = new ExtensionRunner([], shared, process.cwd(), process.cwd(), { getEntries: () => [] } as never, {} as never);
	const trace = [{ version: 1, kind: "run.started" }] as const;
	runner.bindCore(
		{
			sendMessage: shared.sendMessage, sendUserMessage: shared.sendUserMessage, executeCommand: shared.executeCommand,
			appendEntry: shared.appendEntry, setSessionName: shared.setSessionName, getSessionName: shared.getSessionName,
			setLabel: shared.setLabel, getActiveTools: shared.getActiveTools, getAllTools: shared.getAllTools,
			setActiveTools: shared.setActiveTools, getCommands: shared.getCommands, setModel: shared.setModel,
			getThinkingLevel: shared.getThinkingLevel, setThinkingLevel: shared.setThinkingLevel,
		},
		{
			getModel: () => undefined, completeSimple: async () => undefined, completeSimpleWithUsage: async () => undefined,
			isIdle: () => true, abort: () => {}, clearFollowUpQueue: () => {}, hasPendingMessages: () => false,
			shutdown: () => {}, getContextUsage: () => undefined, compact: () => {}, getSystemPrompt: () => "",
			getSoulManager: () => undefined, getSettings: () => ({}), getSkills: () => [], getLastRunTrace: () => trace,
			replayRunTrace: () => ({ ok: true, summary: { runId: "run-1", stopReason: "stop", turnCount: 1, toolCallCount: 0, checkpointCount: 0 } }),
			runHarnessEval: async () => ({ passed: true, scenarioIds: ["policy-ordering"], metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 } }),
		},
	);
	const ctx = runner.createContext();
	assert.deepEqual(ctx.getLastRunTrace?.(), trace);
	assert.equal(ctx.replayRunTrace?.(trace).ok, true);
	assert.deepEqual((await ctx.runHarnessEval?.())?.scenarioIds, ["policy-ordering"]);
});

test("agent session returns an isolated snapshot of the latest completed run trace", () => {
	const trace = [{ version: 1, eventId: "event-1", sequence: 1, timestamp: 1, runId: "run-1", kind: "run.started", payload: { loopFramework: "standard", inputFingerprint: "sha256:input" } }] as const;
	const session = Object.create(AgentSession.prototype) as { _lastRunTrace: readonly unknown[]; getLastRunTrace(): readonly unknown[] | undefined };
	session._lastRunTrace = trace;
	const snapshot = session.getLastRunTrace();
	assert.deepEqual(snapshot, trace);
	assert.notEqual(snapshot, trace);
});
