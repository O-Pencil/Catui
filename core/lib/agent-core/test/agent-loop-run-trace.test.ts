import { EventStream } from "@catui/ai/events";
import type { AssistantMessage, AssistantMessageEvent, Message, Model, UserMessage } from "@catui/ai/types";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.js";
import { structuredAdaptiveAgentLoop } from "../src/structured-adaptive-agent-loop.js";
import { InMemoryRunTraceSink, RunTraceRecorder } from "../src/run-trace-recorder.js";
import type { AgentContext, AgentLoopConfig, AgentMessage } from "../src/types.js";

class FinalStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => event.type === "done" ? event.message : event.type === "error" ? event.error : message,
		);
		queueMicrotask(() => this.push({ type: "done", reason: "stop", message }));
	}
}

const model: Model<"openai-responses"> = {
	id: "mock", name: "mock", api: "openai-responses", provider: "openai",
	baseUrl: "https://example.invalid", reasoning: false, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 2048,
};

const prompt: UserMessage = { role: "user", content: "hello", timestamp: 1 };
const response: AssistantMessage = {
	role: "assistant", content: [{ type: "text", text: "hi" }], api: "openai-responses",
	provider: "openai", model: "mock", stopReason: "stop", timestamp: 2,
	usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
};

describe("agent loop run tracing", () => {
	it.each([
		["standard", agentLoop],
		["weak-model-compatible", structuredAdaptiveAgentLoop],
	] as const)("emits the same ordered lifecycle for %s", async (framework, run) => {
		const sink = new InMemoryRunTraceSink();
		let eventId = 0;
		const recorder = new RunTraceRecorder({ runId: `run-${framework}`, sink, now: () => 100 + eventId, createEventId: () => `event-${++eventId}` });
		const context: AgentContext = { systemPrompt: "help", messages: [], tools: [] };
		const config: AgentLoopConfig = {
			model,
			loopFramework: framework,
			convertToLlm: (messages: AgentMessage[]) => messages as Message[],
			runTrace: recorder,
		};
		const stream = run([prompt], context, config, undefined, () => new FinalStream(response));
		for await (const _event of stream) { /* drain */ }

		expect(sink.snapshot().map((traceEvent) => traceEvent.kind)).toEqual([
			"run.started", "turn.started", "model.requested", "model.responded", "turn.completed", "run.completed",
		]);
		expect(sink.snapshot().at(-1)).toMatchObject({ payload: { stopReason: "stop", turnCount: 1, toolCallCount: 0 } });
	});
});
