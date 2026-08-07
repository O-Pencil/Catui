import type { AssistantMessage } from "@catui/ai/types";
import type { AgentLoopFramework, AgentMessage } from "./types.js";
import { fingerprintTraceValue } from "./run-trace.js";
import type { RunTraceRecorder } from "./run-trace-recorder.js";

export async function traceRunStarted(
	recorder: RunTraceRecorder | undefined,
	framework: AgentLoopFramework,
	messages: readonly AgentMessage[],
): Promise<void> {
	await recorder?.record("run.started", { loopFramework: framework, inputFingerprint: fingerprintTraceValue(messages) });
}

export async function traceTurnStarted(recorder: RunTraceRecorder | undefined, turn: number): Promise<void> {
	await recorder?.record("turn.started", { turn }, { turnId: `turn-${turn}` });
}

export async function traceModelRequested(
	recorder: RunTraceRecorder | undefined,
	turn: number,
	messages: readonly AgentMessage[],
): Promise<void> {
	await recorder?.record("model.requested", { turn, requestFingerprint: fingerprintTraceValue(messages) }, { turnId: `turn-${turn}` });
}

export async function traceModelResponded(
	recorder: RunTraceRecorder | undefined,
	turn: number,
	message: AssistantMessage,
): Promise<void> {
	const context = { turnId: `turn-${turn}` };
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		await recorder?.record("model.failed", {
			turn,
			errorSubtype: message.stopReason,
			errorFingerprint: fingerprintTraceValue(message.errorMessage ?? message),
		}, context);
		return;
	}
	await recorder?.record("model.responded", {
		turn,
		stopReason: message.stopReason,
		responseFingerprint: fingerprintTraceValue(message),
	}, context);
}

export async function traceTurnCompleted(
	recorder: RunTraceRecorder | undefined,
	turn: number,
	message: AssistantMessage,
): Promise<void> {
	await recorder?.record("turn.completed", {
		turn,
		stopReason: message.stopReason,
		outputFingerprint: fingerprintTraceValue(message),
	}, { turnId: `turn-${turn}` });
}

export async function traceRunCompleted(
	recorder: RunTraceRecorder | undefined,
	result: { stopReason: string; turnCount: number; toolCallCount: number; messages: readonly AgentMessage[] },
): Promise<void> {
	if (!recorder) return;
	await recorder.record("run.completed", {
		stopReason: result.stopReason,
		turnCount: result.turnCount,
		toolCallCount: result.toolCallCount,
		outputFingerprint: fingerprintTraceValue(result.messages),
	});
	await recorder.flush();
}
