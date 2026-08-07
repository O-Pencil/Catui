/**
 * [WHO]: ToolPolicyPipeline and typed pre-execution policy contracts
 * [FROM]: Depends on node:crypto and ./run-checkpoint checkpoint port
 * [TO]: Consumed by both agent loop implementations and runtime policy adapters
 * [HERE]: core/lib/agent-core/src/tool-policy.ts - deterministic, fail-closed tool policy evaluation
 */

import { randomUUID } from "node:crypto";
import type { CheckpointStore } from "./run-checkpoint.js";
import type { AgentToolResult } from "./types.js";

export interface AgentToolPolicyEvent {
	toolCallId: string;
	toolName: string;
	requestedToolName: string;
	input: unknown;
	rawInput: unknown;
}

export type AgentToolPolicyDecision =
	| { decision: "allow"; input?: unknown }
	| { decision: "deny"; reason?: string; policyId?: string }
	| { decision: "pause"; reason: string; policyId?: string; metadata?: Record<string, unknown>; checkpointId?: string };

export interface AgentToolPolicy {
	id: string;
	beforeTool?(event: AgentToolPolicyEvent): AgentToolPolicyDecision | void | Promise<AgentToolPolicyDecision | void>;
	afterTool?(event: AgentToolPolicyResultEvent): { result: AgentToolResult<unknown> } | void | Promise<{ result: AgentToolResult<unknown> } | void>;
}

export interface AgentToolPolicyResultEvent extends AgentToolPolicyEvent {
	result: AgentToolResult<unknown>;
	isError: boolean;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

export class ToolPolicyPipeline {
	readonly #policies: readonly AgentToolPolicy[];
	readonly #options: ToolPolicyPipelineOptions;

	constructor(policies: readonly AgentToolPolicy[], options: ToolPolicyPipelineOptions = {}) {
		const ids = new Set<string>();
		for (const policy of policies) {
			if (!policy.id.trim()) throw new Error("Tool policy id must not be empty");
			if (ids.has(policy.id)) throw new Error(`Duplicate tool policy id: ${policy.id}`);
			ids.add(policy.id);
		}
		this.#policies = [...policies];
		this.#options = options;
	}

	async evaluateBefore(event: AgentToolPolicyEvent): Promise<AgentToolPolicyDecision> {
		let input = event.input;
		for (const policy of this.#policies) {
			if (!policy.beforeTool) continue;
			let decision: AgentToolPolicyDecision | void;
			try {
				decision = await policy.beforeTool({ ...event, input });
			} catch (error) {
				if (isAbortError(error)) throw error;
				const message = error instanceof Error ? error.message : String(error);
				return { decision: "deny", policyId: policy.id, reason: `Policy ${policy.id} failed: ${message}` };
			}
			if (!decision || decision.decision === "allow") {
				if (decision?.input !== undefined) input = decision.input;
				continue;
			}
			const policyId = decision.policyId ?? policy.id;
			if (decision.decision === "pause" && this.#options.checkpointStore) {
				const now = this.#options.now?.() ?? Date.now();
				const checkpointId = this.#options.createCheckpointId?.() ?? randomUUID();
				await this.#options.checkpointStore.save({
					version: 1,
					id: checkpointId,
					createdAt: now,
					expiresAt: this.#options.checkpointTtlMs === undefined ? undefined : now + this.#options.checkpointTtlMs,
					policyId,
					toolCall: { id: event.toolCallId, name: event.toolName, input },
					metadata: decision.metadata,
				});
				return { ...decision, policyId, checkpointId };
			}
			return { ...decision, policyId };
		}
		return { decision: "allow", input };
	}

	async evaluateAfter(event: AgentToolPolicyResultEvent): Promise<AgentToolResult<unknown>> {
		let result = event.result;
		for (const policy of this.#policies) {
			if (!policy.afterTool) continue;
			try {
				const decision = await policy.afterTool({ ...event, result });
				if (decision) result = decision.result;
			} catch (error) {
				if (isAbortError(error)) throw error;
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Result policy ${policy.id} failed: ${message}` }],
					details: { errorType: "result_policy_failed", policyId: policy.id },
				};
			}
		}
		return result;
	}
}

export interface ToolPolicyPipelineOptions {
	checkpointStore?: CheckpointStore;
	checkpointTtlMs?: number;
	createCheckpointId?: () => string;
	now?: () => number;
}
