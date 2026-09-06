import { EventStream } from "@catui/ai/events";
import type { AssistantMessage, AssistantMessageEvent, Message, Model, UserMessage } from "@catui/ai/types";
import { describe, expect, it } from "vitest";
import { Type } from "@catui/ai/schema";
import { agentLoop } from "../src/agent-loop.js";
import { structuredAdaptiveAgentLoop } from "../src/structured-adaptive-agent-loop.js";
import { replayRunTrace } from "../src/run-replay.js";
import { InMemoryRunTraceSink, RunTraceRecorder } from "../src/run-trace-recorder.js";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.js";

class FinalStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => event.type === "done" ? event.message : event.type === "error" ? event.error : message,
		);
		queueMicrotask(() => this.push({ type: "done", reason: "stop", message }));
	}
}

class ScriptedStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => event.type === "done" ? event.message : event.type === "error" ? event.error : message,
		);
		queueMicrotask(() => this.push({ type: "done", reason: message.stopReason ?? "stop", message }));
	}
}

class StreamingToolErrorStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => event.type === "done" ? event.message : event.type === "error" ? event.error : message,
		);
		const toolCall = message.content.find((part) => part.type === "toolCall");
		if (!toolCall) throw new Error("StreamingToolErrorStream requires a tool call");
		queueMicrotask(() => {
			this.push({ type: "start", partial: message });
			this.push({ type: "toolcall_start", contentIndex: 0, partial: message });
			this.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
			this.push({ type: "error", reason: "error", error: message });
		});
	}
}

class StreamingToolPendingStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => event.type === "done" ? event.message : event.type === "error" ? event.error : message,
		);
		const toolCall = message.content.find((part) => part.type === "toolCall");
		if (!toolCall) throw new Error("StreamingToolPendingStream requires a tool call");
		queueMicrotask(() => {
			this.push({ type: "start", partial: message });
			this.push({ type: "toolcall_start", contentIndex: 0, partial: message });
			this.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
		});
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

	it.each([
		["standard", agentLoop],
		["weak-model-compatible", structuredAdaptiveAgentLoop],
	] as const)("pairs tool trace events for %s", async (framework, run) => {
		const sink = new InMemoryRunTraceSink();
		const recorder = new RunTraceRecorder({ runId: `tool-${framework}`, sink });
		const schema = Type.Object({});
		const tool: AgentTool<typeof schema> = {
			name: "read", label: "Read", description: "Read", parameters: schema,
			async execute() { return { content: [{ type: "text", text: "ok" }], details: {} }; },
		};
		let call = 0;
		const stream = run([prompt], { systemPrompt: "help", messages: [], tools: [tool] }, {
			model, loopFramework: framework, convertToLlm: (messages: AgentMessage[]) => messages as Message[], runTrace: recorder,
		}, undefined, () => {
			const message = call++ === 0
				? { ...response, stopReason: "toolUse" as const, content: [{ type: "toolCall" as const, id: "call-1", name: "read", arguments: {} }] }
				: response;
			return new FinalStream(message);
		});
		for await (const _event of stream) { /* drain */ }
		const events = sink.snapshot();
		const requested = events.find((traceEvent) => traceEvent.kind === "tool.requested");
		expect(events.map((traceEvent) => traceEvent.kind)).toEqual(expect.arrayContaining(["tool.requested", "tool.started", "tool.completed"]));
		expect(requested).toMatchObject({ kind: "tool.requested", payload: { input: {} } });
		expect(events.at(-1)).toMatchObject({ kind: "run.completed", payload: { toolCallCount: 1 } });
	});

	it("accounts for streamed tools when a structured turn ends with an error", async () => {
		const sink = new InMemoryRunTraceSink();
		const recorder = new RunTraceRecorder({ runId: "streaming-tool-error", sink });
		const schema = Type.Object({});
		let executions = 0;
		const tool: AgentTool<typeof schema> = {
			name: "read", label: "Read", description: "Read", parameters: schema,
			async execute() {
				executions++;
				return { content: [{ type: "text", text: "started before model error" }], details: {} };
			},
		};
		const failedResponse: AssistantMessage = {
			...response,
			content: [{ type: "toolCall", id: "streamed-call-1", name: "read", arguments: {} }],
			stopReason: "error",
			errorMessage: "provider stream failed",
		};

		const stream = structuredAdaptiveAgentLoop(
			[prompt],
			{ systemPrompt: "help", messages: [], tools: [tool] },
			{
				model,
				loopFramework: "weak-model-compatible",
				convertToLlm: (messages: AgentMessage[]) => messages as Message[],
				runTrace: recorder,
			},
			undefined,
			() => new StreamingToolErrorStream(failedResponse),
		);
		for await (const _event of stream) { /* drain */ }

		const trace = sink.snapshot();
		expect(executions).toBe(1);
		expect(trace.map((event) => event.kind)).toEqual(expect.arrayContaining([
			"tool.requested", "tool.started", "tool.completed",
		]));
		expect(trace.at(-1)).toMatchObject({ kind: "run.completed", payload: { toolCallCount: 1 } });
		expect(replayRunTrace(trace)).toMatchObject({ ok: true });
	});

	it("accounts for streamed tools when an abort replaces the partial assistant message", async () => {
		const sink = new InMemoryRunTraceSink();
		const recorder = new RunTraceRecorder({ runId: "streaming-tool-abort", sink });
		const controller = new AbortController();
		const schema = Type.Object({});
		let executions = 0;
		const tool: AgentTool<typeof schema> = {
			name: "read", label: "Read", description: "Read", parameters: schema,
			async execute() {
				executions++;
				queueMicrotask(() => controller.abort());
				return { content: [{ type: "text", text: "started before abort" }], details: {} };
			},
		};
		const partialResponse: AssistantMessage = {
			...response,
			content: [{ type: "toolCall", id: "streamed-abort-call-1", name: "read", arguments: {} }],
			stopReason: "toolUse",
		};

		const stream = structuredAdaptiveAgentLoop(
			[prompt],
			{ systemPrompt: "help", messages: [], tools: [tool] },
			{
				model,
				loopFramework: "weak-model-compatible",
				convertToLlm: (messages: AgentMessage[]) => messages as Message[],
				runTrace: recorder,
			},
			controller.signal,
			() => new StreamingToolPendingStream(partialResponse),
		);
		for await (const _event of stream) { /* drain */ }

		const trace = sink.snapshot();
		expect(executions).toBe(1);
		expect(trace.map((event) => event.kind)).toEqual(expect.arrayContaining([
			"tool.requested", "tool.started", "tool.completed",
		]));
		expect(trace.at(-1)).toMatchObject({
			kind: "run.completed",
			payload: { stopReason: "aborted", toolCallCount: 1 },
		});
		expect(replayRunTrace(trace)).toMatchObject({ ok: true });
	});

	it.each([
		["standard", agentLoop],
		["weak-model-compatible", structuredAdaptiveAgentLoop],
	] as const)("closes failed turns before model-error recovery for %s", async (framework, run) => {
		const sink = new InMemoryRunTraceSink();
		const recorder = new RunTraceRecorder({ runId: `recovery-${framework}`, sink });
		let call = 0;
		const stream = run([prompt], { systemPrompt: "help", messages: [], tools: [] }, {
			model,
			loopFramework: framework,
			convertToLlm: (messages: AgentMessage[]) => messages as Message[],
			runTrace: recorder,
			recoverModelError: ({ errorSubtype, attempt }) => ({
				action: "retry",
				messages: [prompt],
				transition: { reason: "model_error_recovery", subtype: errorSubtype, attempt },
			}),
		}, undefined, () => {
			if (call++ > 0) return new ScriptedStream(response);
			return new ScriptedStream({
				...response,
				content: [],
				stopReason: "error",
				errorMessage: "maximum context length exceeded",
			});
		});
		for await (const _event of stream) { /* drain */ }

		const trace = sink.snapshot();
		expect(trace.filter((event) => event.kind === "turn.started")).toHaveLength(2);
		expect(trace.filter((event) => event.kind === "turn.completed")).toHaveLength(2);
		expect(trace).toEqual(expect.arrayContaining([
			expect.objectContaining({ kind: "model.failed" }),
			expect.objectContaining({ kind: "transition.applied", payload: expect.objectContaining({ reason: "model_error_recovery" }) }),
		]));
	});
});
