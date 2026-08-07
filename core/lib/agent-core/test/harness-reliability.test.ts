import { describe, expect, it } from "vitest";
import {
	InMemoryCheckpointStore,
	LoopProgressTracker,
	resolveRunCheckpoint,
	ToolPolicyPipeline,
	type AgentRunCheckpoint,
} from "../src/index.js";

describe("ToolPolicyPipeline", () => {
	it("evaluates policies in order and carries transformed input forward", async () => {
		const seen: unknown[] = [];
		const pipeline = new ToolPolicyPipeline([
			{
				id: "normalize",
				beforeTool(event) {
					return { decision: "allow", input: { ...(event.input as object), normalized: true } };
				},
			},
			{
				id: "audit",
				beforeTool(event) {
					seen.push(event.input);
					return { decision: "allow" };
				},
			},
		]);

		const result = await pipeline.evaluateBefore({
			toolCallId: "call-1",
			toolName: "write",
			requestedToolName: "Write",
			input: { path: "plan.md" },
			rawInput: { path: "plan.md" },
		});

		expect(result).toEqual({ decision: "allow", input: { path: "plan.md", normalized: true } });
		expect(seen).toEqual([{ path: "plan.md", normalized: true }]);
	});

	it("fails closed with the policy identity", async () => {
		const pipeline = new ToolPolicyPipeline([{ id: "broken", beforeTool: () => { throw new Error("boom"); } }]);
		await expect(pipeline.evaluateBefore({
			toolCallId: "call-1",
			toolName: "bash",
			requestedToolName: "bash",
			input: {},
			rawInput: {},
		})).resolves.toEqual({ decision: "deny", policyId: "broken", reason: "Policy broken failed: boom" });
	});

	it("fails closed when a pausing policy has no checkpoint store", async () => {
		const pipeline = new ToolPolicyPipeline([
			{ id: "approval", beforeTool: () => ({ decision: "pause", reason: "approve" }) },
		]);
		await expect(pipeline.evaluateBefore({
			toolCallId: "call-1", toolName: "bash", requestedToolName: "bash", input: {}, rawInput: {},
		})).resolves.toEqual({
			decision: "deny", policyId: "approval", reason: "Cannot pause without a checkpoint store",
		});
	});

	it("applies ordered result policies after execution", async () => {
		const pipeline = new ToolPolicyPipeline([
			{ id: "first", afterTool: (event) => ({ result: { ...event.result, details: { stage: 1 } }, isError: true }) },
			{ id: "second", afterTool: (event) => ({ result: { ...event.result, details: { ...(event.result.details as object), stage: 2, sawError: event.isError } } }) },
		]);
		const result = await pipeline.evaluateAfter({
			toolCallId: "call-1", toolName: "read", requestedToolName: "read", input: {}, rawInput: {},
			result: { content: [{ type: "text", text: "ok" }], details: {} }, isError: false,
		});
		expect(result.result.details).toEqual({ stage: 2, sawError: true });
		expect(result.isError).toBe(true);
	});

	it("preserves abort semantics", async () => {
		const abort = new DOMException("stopped", "AbortError");
		const pipeline = new ToolPolicyPipeline([{ id: "abort", beforeTool: () => { throw abort; } }]);
		await expect(pipeline.evaluateBefore({
			toolCallId: "call-1", toolName: "bash", requestedToolName: "bash", input: {}, rawInput: {},
		})).rejects.toBe(abort);
	});

	it("persists pause decisions as resumable checkpoints", async () => {
		const store = new InMemoryCheckpointStore();
		const pipeline = new ToolPolicyPipeline([
			{ id: "approval", beforeTool: () => ({ decision: "pause", reason: "human approval required" }) },
		], { checkpointStore: store, createCheckpointId: () => "checkpoint-1", now: () => 100, checkpointTtlMs: 50 });
		const decision = await pipeline.evaluateBefore({
			toolCallId: "call-1", toolName: "bash", requestedToolName: "bash",
			input: { command: "deploy" }, rawInput: { command: "deploy" },
		});
		expect(decision).toMatchObject({ decision: "pause", policyId: "approval", checkpointId: "checkpoint-1" });
		expect(await store.consume("checkpoint-1", 120)).toMatchObject({
			id: "checkpoint-1", policyId: "approval",
			toolCall: { id: "call-1", name: "bash", input: { command: "deploy" } },
		});
	});

	it("fails closed for non-finite checkpoint TTLs", async () => {
		const pipeline = new ToolPolicyPipeline([
			{ id: "approval", beforeTool: () => ({ decision: "pause", reason: "approve" }) },
		], { checkpointStore: new InMemoryCheckpointStore(), checkpointTtlMs: Number.NaN });
		await expect(pipeline.evaluateBefore({
			toolCallId: "call-1", toolName: "bash", requestedToolName: "bash", input: {}, rawInput: {},
		})).resolves.toMatchObject({ decision: "deny", reason: expect.stringMatching(/TTL/) });
	});
});

describe("LoopProgressTracker", () => {
	it("detects a bounded repeated no-progress cycle and resets on novelty", () => {
		const tracker = new LoopProgressTracker({ repetitionThreshold: 3, historySize: 4 });
		expect(tracker.observe({ toolName: "read", input: { b: 2, a: 1 }, outcome: "error" })).toBeUndefined();
		expect(tracker.observe({ toolName: "read", input: { a: 1, b: 2 }, outcome: "error" })).toBeUndefined();
		expect(tracker.observe({ toolName: "read", input: { a: 1, b: 2 }, outcome: "error" })).toMatchObject({ repeatCount: 3 });
		expect(tracker.observe({ toolName: "read", input: { a: 2, b: 2 }, outcome: "success" })).toBeUndefined();
		expect(tracker.stagnationCount).toBe(0);
	});

	it("detects repeated multi-step cycles and supports explicit reset", () => {
		const tracker = new LoopProgressTracker({ repetitionThreshold: 3, historySize: 8 });
		for (let round = 0; round < 2; round++) {
			expect(tracker.observe({ toolName: "a", input: {}, outcome: "error" })).toBeUndefined();
			expect(tracker.observe({ toolName: "b", input: {}, outcome: "denied" })).toBeUndefined();
		}
		expect(tracker.observe({ toolName: "a", input: {}, outcome: "error" })).toBeUndefined();
		expect(tracker.observe({ toolName: "b", input: {}, outcome: "denied" })).toMatchObject({ repeatCount: 3 });
		tracker.reset();
		expect(tracker.stagnationCount).toBe(0);
	});

	it("detects repeated successful calls with identical outputs", () => {
		const tracker = new LoopProgressTracker({ repetitionThreshold: 3 });
		const evidence = { toolName: "read", input: { path: "a" }, output: { text: "same" }, outcome: "success" as const };
		expect(tracker.observe(evidence)).toBeUndefined();
		expect(tracker.observe(evidence)).toBeUndefined();
		expect(tracker.observe(evidence)).toMatchObject({ repeatCount: 3 });
		expect(tracker.observe({ ...evidence, output: { text: "changed" } })).toBeUndefined();
		expect(tracker.stagnationCount).toBe(0);
	});
});

describe("InMemoryCheckpointStore", () => {
	it("atomically consumes a versioned checkpoint once", async () => {
		const store = new InMemoryCheckpointStore();
		const checkpoint: AgentRunCheckpoint = {
			version: 1,
			id: "checkpoint-1",
			createdAt: 100,
			expiresAt: 200,
			policyId: "approval",
			toolCall: { id: "call-1", name: "bash", input: { command: "deploy" } },
		};
		await store.save(checkpoint);
		expect(await store.consume("checkpoint-1", 150)).toEqual(checkpoint);
		expect(await store.consume("checkpoint-1", 150)).toBeUndefined();
	});

	it("drops expired checkpoints", async () => {
		const store = new InMemoryCheckpointStore();
		await store.save({
			version: 1, id: "expired", createdAt: 100, expiresAt: 101, policyId: "approval",
			toolCall: { id: "call-1", name: "bash", input: {} },
		});
		expect(await store.consume("expired", 102)).toBeUndefined();
	});

	it("does not consume a checkpoint when conditional validation fails", async () => {
		const store = new InMemoryCheckpointStore();
		await store.save({
			version: 1, id: "guarded", createdAt: 100, policyId: "approval",
			toolCall: { id: "call-1", name: "bash", input: {} },
		});
		expect(await store.consume("guarded", 101, () => false)).toBeUndefined();
		expect(await store.consume("guarded", 101, () => true)).toMatchObject({ id: "guarded" });
	});

	it("resolves approval exactly once and returns the pending call", async () => {
		const store = new InMemoryCheckpointStore();
		await store.save({
			version: 1, id: "approval", createdAt: 100, policyId: "human",
			toolCall: { id: "call-1", name: "deploy", input: { target: "prod" } },
		});
		expect(await resolveRunCheckpoint(store, "approval", "approve", 101)).toMatchObject({
			status: "approved", toolCall: { name: "deploy", input: { target: "prod" } },
		});
		expect(await resolveRunCheckpoint(store, "approval", "approve", 101)).toEqual({ status: "unavailable" });
	});
});
