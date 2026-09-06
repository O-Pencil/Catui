/**
 * [WHO]: Provides executable built-in harness fixtures backed by both production agent loops
 * [FROM]: Depends on agent-core loops, AI EventStream/types/schema, and harness eval fixture contracts
 * [TO]: Consumed by core/harness-eval/scenarios.ts as the required offline regression corpus
 * [HERE]: core/harness-eval/agent-fixtures.ts - scripted-model execution scenarios with real tools and traces
 */
import assert from "node:assert/strict";
import {
	agentLoop,
	InMemoryCheckpointStore,
	InMemoryRunTraceSink,
	RunTraceRecorder,
	structuredAdaptiveAgentLoop,
	type AgentContext,
	type AgentEvent,
	type AgentLoopConfig,
	type AgentMessage,
	type AgentTool,
	type StreamFn,
} from "@catui/agent-core";
import { EventStream } from "@catui/ai/events";
import { Type } from "@catui/ai/schema";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	Message,
	Model,
	UserMessage,
} from "@catui/ai/types";
import type { HarnessEvalContext, HarnessEvalFixture, HarnessEvalFixtureResult } from "./types.js";

type ScenarioKind =
	| "policy-ordering"
	| "approval-checkpoint"
	| "livelock"
	| "tool-exception-pairing"
	| "steering-followup"
	| "recovery-continuation"
	| "compaction-boundary"
	| "concurrent-safe-tools";

class ScriptedAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected scripted assistant event");
			},
		);
	}
}

function usage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function model(): Model<"openai-responses"> {
	return {
		id: "harness-scripted",
		name: "Harness scripted model",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function assistant(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "harness-scripted",
		usage: usage(),
		stopReason,
		timestamp: Date.now(),
	};
}

function user(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((message) =>
		message.role === "user" || message.role === "assistant" || message.role === "toolResult"
	) as Message[];
}

function response(message: AssistantMessage): ScriptedAssistantStream {
	const stream = new ScriptedAssistantStream();
	queueMicrotask(() => {
		if (message.stopReason === "error" || message.stopReason === "aborted") {
			stream.push({ type: "error", reason: message.stopReason, error: message });
			return;
		}
		stream.push({
			type: "done",
			reason: message.stopReason === "length" || message.stopReason === "toolUse" ? message.stopReason : "stop",
			message,
		});
	});
	return stream;
}

function agentResult(events: readonly AgentEvent[]): Extract<AgentEvent, { type: "agent_result" }> {
	const result = events.find((event): event is Extract<AgentEvent, { type: "agent_result" }> => event.type === "agent_result");
	assert.ok(result, "scenario did not emit agent_result");
	return result;
}

interface ExecutableScenario {
	prompt: string;
	tools?: AgentTool<any>[];
	config?: Partial<AgentLoopConfig>;
	streamFn: StreamFn;
	verify(result: {
		context: HarnessEvalContext;
		events: readonly AgentEvent[];
		messages: readonly AgentMessage[];
		trace: HarnessEvalFixtureResult["recorded"];
	}): void | Promise<void>;
}

async function executeScenario(
	context: HarnessEvalContext,
	scenario: ExecutableScenario,
): Promise<HarnessEvalFixtureResult> {
	const sink = new InMemoryRunTraceSink();
	const recorder = new RunTraceRecorder({
		runId: `${context.scenarioId}-${context.framework}`,
		sessionId: `eval-${context.scenarioId}`,
		sink,
		now: context.now,
		createEventId: context.nextId,
		failureMode: "required",
	});
	const agentContext: AgentContext = {
		systemPrompt: "You are executing a deterministic offline harness scenario.",
		messages: [],
		tools: scenario.tools ?? [],
	};
	const config: AgentLoopConfig = {
		model: model(),
		convertToLlm: identityConverter,
		maxTurnsPerPrompt: 12,
		maxToolCallsPerPrompt: 32,
		runTrace: recorder,
		...scenario.config,
	};
	const run = context.framework === "weak-model-compatible" ? structuredAdaptiveAgentLoop : agentLoop;
	const stream = run([user(scenario.prompt)], agentContext, config, undefined, scenario.streamFn);
	const events: AgentEvent[] = [];
	for await (const event of stream) events.push(event);
	const messages = await stream.result();
	await recorder.flush();
	const trace = sink.snapshot();
	await scenario.verify({ context, events, messages, trace });
	return { recorded: trace, policyViolations: 0 };
}

function policyOrdering(): HarnessEvalFixture {
	return async (context) => {
		const schema = Type.Object({ value: Type.String(), normalized: Type.Optional(Type.Boolean()) });
		const executed: unknown[] = [];
		const audited: unknown[] = [];
		const tool: AgentTool<typeof schema> = {
			name: "policy_probe",
			label: "Policy probe",
			description: "Records policy-transformed input",
			parameters: schema,
			async execute(_id, input) {
				executed.push(input);
				return { content: [{ type: "text", text: "policy-ok" }], details: { input } };
			},
		};
		let call = 0;
		return executeScenario(context, {
			prompt: "Run the policy probe.",
			tools: [tool],
			config: {
				toolPolicies: [
					{ id: "normalize", mayPause: false, beforeTool: (event) => ({ decision: "allow", input: { ...(event.input as object), normalized: true } }) },
					{ id: "audit", mayPause: false, beforeTool: (event) => { audited.push(event.input); return { decision: "allow" }; } },
				],
			},
			streamFn: () => response(call++ === 0
				? assistant([{ type: "toolCall", id: "policy-1", name: "policy_probe", arguments: { value: "raw" } }], "toolUse")
				: assistant([{ type: "text", text: "done" }])),
			verify: ({ events, trace }) => {
				assert.deepEqual(executed, [{ value: "raw", normalized: true }]);
				assert.deepEqual(audited, [{ value: "raw", normalized: true }]);
				assert.equal(agentResult(events).stopReason, "stop");
				assert.ok(trace.some((event) => event.kind === "policy.decided" && event.payload.decision === "allow"));
			},
		});
	};
}

function approvalCheckpoint(): HarnessEvalFixture {
	return async (context) => {
		const schema = Type.Object({ target: Type.String() });
		let executed = false;
		const tool: AgentTool<typeof schema> = {
			name: "deploy",
			label: "Deploy",
			description: "Approval-gated deployment",
			parameters: schema,
			async execute() {
				executed = true;
				return { content: [{ type: "text", text: "deployed" }], details: {} };
			},
		};
		return executeScenario(context, {
			prompt: "Deploy production.",
			tools: [tool],
			config: {
				checkpointStore: new InMemoryCheckpointStore(),
				toolPolicies: [{
					id: "human-approval",
					beforeTool: () => ({ decision: "pause", reason: "approval required" }),
				}],
			},
			streamFn: () => response(assistant([
				{ type: "toolCall", id: "deploy-1", name: "deploy", arguments: { target: "production" } },
			], "toolUse")),
			verify: ({ events, trace }) => {
				assert.equal(executed, false);
				assert.equal(agentResult(events).errorSubtype, "approval_required");
				assert.ok(trace.some((event) =>
					event.kind === "policy.decided" && event.payload.policyId === "human-approval" && event.payload.decision === "pause"
				));
				assert.ok(trace.some((event) =>
					event.kind === "checkpoint.created" && event.payload.policyId === "human-approval"
				));
				assert.ok(trace.some((event) => event.kind === "tool.completed" && event.payload.outcome === "paused"));
			},
		});
	};
}

function livelock(): HarnessEvalFixture {
	return async (context) => {
		const schema = Type.Object({ value: Type.String() });
		let calls = 0;
		const tool: AgentTool<typeof schema> = {
			name: "stuck",
			label: "Stuck",
			description: "Always fails",
			parameters: schema,
			async execute() { throw new Error("still stuck"); },
		};
		return executeScenario(context, {
			prompt: "Keep trying the stuck operation.",
			tools: [tool],
			config: { loopProgress: { repetitionThreshold: 3 } },
			streamFn: () => {
				calls += 1;
				return response(assistant([
					{ type: "toolCall", id: `stuck-${calls}`, name: "stuck", arguments: { value: "same" } },
				], "toolUse"));
			},
			verify: ({ events, trace }) => {
				assert.equal(calls, 3);
				assert.equal(agentResult(events).errorSubtype, "livelock_detected");
				assert.ok(trace.some((event) => event.kind === "transition.applied" && event.payload.reason === "livelock_detected"));
			},
		});
	};
}

function toolExceptionPairing(): HarnessEvalFixture {
	return async (context) => {
		const schema = Type.Object({});
		let executions = 0;
		const tool: AgentTool<typeof schema> = {
			name: "explode",
			label: "Explode",
			description: "Throws deterministically",
			parameters: schema,
			async execute() { executions += 1; throw new Error("fixture explosion"); },
		};
		let call = 0;
		return executeScenario(context, {
			prompt: "Exercise exception pairing.",
			tools: [tool],
			streamFn: () => response(call++ === 0
				? assistant([{ type: "toolCall", id: "explode-1", name: "explode", arguments: {} }], "toolUse")
				: assistant([{ type: "text", text: "handled" }])),
			verify: ({ events, trace }) => {
				assert.equal(executions, 1);
				assert.equal(agentResult(events).stopReason, "stop");
				assert.ok(trace.some((event) => event.kind === "tool.completed" && event.payload.outcome === "error"));
			},
		});
	};
}

function steeringFollowup(): HarnessEvalFixture {
	return async (context) => {
		const schema = Type.Object({ value: Type.String() });
		const executed: string[] = [];
		let steeringDelivered = false;
		let sawSteering = false;
			const tool: AgentTool<typeof schema> = {
			name: "step",
			label: "Step",
			description: "Sequential step",
			parameters: schema,
			async execute(_id, input) {
				executed.push(input.value);
				return { content: [{ type: "text", text: input.value }], details: {} };
			},
		};
		let call = 0;
		return executeScenario(context, {
			prompt: "Run two steps unless steered.",
			tools: [tool],
			config: {
				getSteeringMessages: async () => {
					if (executed.length === 1 && !steeringDelivered) {
						steeringDelivered = true;
						return [user("change direction")];
					}
					return [];
				},
			},
			streamFn: (_model, agentContext) => {
				if (call === 1) {
					sawSteering = agentContext.messages.some((message) => message.role === "user" && message.content === "change direction");
				}
				return response(call++ === 0
					? assistant([
						{ type: "toolCall", id: "step-1", name: "step", arguments: { value: "first" } },
						{ type: "toolCall", id: "step-2", name: "step", arguments: { value: "second" } },
					], "toolUse")
					: assistant([{ type: "text", text: "redirected" }]));
			},
			verify: ({ events, trace }) => {
				assert.deepEqual(executed, ["first"]);
				assert.equal(sawSteering, true);
				assert.equal(agentResult(events).stopReason, "stop");
				assert.ok(trace.some((event) => event.kind === "transition.applied" && event.payload.reason === "steering"));
			},
		});
	};
}

function recoveryContinuation(): HarnessEvalFixture {
	return async (context) => {
		let call = 0;
		let sawRecoveryPrompt = false;
		return executeScenario(context, {
			prompt: "Produce a long answer.",
			config: { maxTokens: 100 },
			streamFn: (_model, agentContext) => {
				if (call === 1) {
					sawRecoveryPrompt = agentContext.messages.some((message) => {
						if (message.role !== "user") return false;
						if (typeof message.content === "string") return message.content.includes("output-token recovery");
						return message.content.some((part) => part.type === "text" && part.text.includes("output-token recovery"));
					});
				}
				if (call++ === 0) {
					const partial = assistant([{ type: "text", text: "partial" }], "length");
					partial.usage.output = 100;
					partial.usage.totalTokens = 100;
					return response(partial);
				}
				return response(assistant([{ type: "text", text: "continued" }]));
			},
			verify: ({ events, trace }) => {
				assert.equal(call, 2);
				assert.equal(sawRecoveryPrompt, true);
				assert.equal(agentResult(events).lastTransition?.reason, "max_output_tokens_recovery");
				assert.ok(trace.some((event) => event.kind === "transition.applied" && event.payload.reason === "max_output_tokens_recovery"));
			},
		});
	};
}

function compactionBoundary(): HarnessEvalFixture {
	return async (context) => {
		let call = 0;
		let sawCompactedContext = false;
		return executeScenario(context, {
			prompt: "Recover from context overflow.",
			config: {
				recoverModelError: ({ errorSubtype, attempt }) => ({
					action: "retry",
					messages: [user("compacted context")],
					transition: { reason: "model_error_recovery", subtype: errorSubtype, attempt },
				}),
			},
			streamFn: (_model, agentContext) => {
				if (call === 1) {
					sawCompactedContext = agentContext.messages.some((message) => message.role === "user" && message.content === "compacted context");
				}
				if (call++ === 0) {
					const failed = assistant([], "error");
					failed.errorMessage = "maximum context length is 8192 tokens";
					return response(failed);
				}
				return response(assistant([{ type: "text", text: "recovered" }]));
			},
			verify: ({ events, messages, trace }) => {
				assert.equal(call, 2);
				assert.equal(sawCompactedContext, true);
				assert.equal(messages.some((message) => message.role === "assistant" && message.stopReason === "error"), false);
				assert.equal(agentResult(events).lastTransition?.reason, "model_error_recovery");
				assert.ok(trace.some((event) => event.kind === "transition.applied" && event.payload.reason === "model_error_recovery"));
			},
		});
	};
}

function concurrentSafeTools(): HarnessEvalFixture {
	return async (context) => {
		const schema = Type.Object({ value: Type.String() });
		let active = 0;
		let maxActive = 0;
		const executions: string[] = [];
		const makeTool = (name: string, waitMs: number): AgentTool<typeof schema> => ({
			name,
			label: name,
			description: "Concurrency-safe deterministic read",
			parameters: schema,
			isConcurrencySafe: true,
			async execute(_id, input) {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, waitMs));
				executions.push(input.value);
				active -= 1;
				return { content: [{ type: "text", text: input.value }], details: {} };
			},
		});
		let call = 0;
		return executeScenario(context, {
			prompt: "Read both values.",
			tools: [makeTool("safe_slow", 15), makeTool("safe_fast", 5)],
			streamFn: () => response(call++ === 0
				? assistant([
					{ type: "toolCall", id: "safe-1", name: "safe_slow", arguments: { value: "first" } },
					{ type: "toolCall", id: "safe-2", name: "safe_fast", arguments: { value: "second" } },
				], "toolUse")
				: assistant([{ type: "text", text: "done" }])),
			verify: ({ events, trace }) => {
				assert.deepEqual([...executions].sort(), ["first", "second"]);
				assert.equal(maxActive, context.framework === "weak-model-compatible" ? 2 : 1);
				assert.equal(agentResult(events).stopReason, "stop");
				assert.equal(trace.filter((event) => event.kind === "tool.completed").length, 2);
			},
		});
	};
}

export const EXECUTABLE_HARNESS_EVAL_FIXTURES: Readonly<Record<ScenarioKind, HarnessEvalFixture>> = {
	"policy-ordering": policyOrdering(),
	"approval-checkpoint": approvalCheckpoint(),
	livelock: livelock(),
	"tool-exception-pairing": toolExceptionPairing(),
	"steering-followup": steeringFollowup(),
	"recovery-continuation": recoveryContinuation(),
	"compaction-boundary": compactionBoundary(),
	"concurrent-safe-tools": concurrentSafeTools(),
};
