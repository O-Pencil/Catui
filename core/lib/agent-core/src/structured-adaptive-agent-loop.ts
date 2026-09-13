/**
 * Structured-adaptive agent loop for Catui — compatibility shim.
 *
 * The weak-model-compatible loop has converged into the standard loop
 * (core/lib/agent-core/src/agent-loop.ts). These exports remain as thin
 * wrappers so external importers keep working unchanged; `weak-model-compatible`
 * is now a capability alias of the standard loop, not a separate implementation.
 */
/**
 * [WHO]: structuredAdaptiveAgentLoop, structuredAdaptiveAgentLoopContinue — thin wrappers delegating to the unified standard loop
 * [FROM]: Depends on ./agent-loop (agentLoop, agentLoopContinue) and ./types for the public loop contract.
 * [TO]: Consumed by external importers through index.ts; kept for public API compatibility.
 * [HERE]: core/lib/agent-core/src/structured-adaptive-agent-loop.ts - legacy entry name, same behavior as standard loop
 */

import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, StreamFn } from "./types.js";
import { EventStream } from "@catui/ai/events";
import { agentLoop, agentLoopContinue } from "./agent-loop.js";

/**
 * Weak-model-compatible loop — alias of the unified standard loop.
 *
 * @deprecated Use `agentLoop` directly. This export exists only for public API
 * compatibility and behaves identically.
 */
export function structuredAdaptiveAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	return agentLoop(prompts, context, config, signal, streamFn);
}

/**
 * Weak-model-compatible continuation — alias of the unified standard loop.
 *
 * @deprecated Use `agentLoopContinue` directly. This export exists only for
 * public API compatibility and behaves identically (including the same
 * ValidationError guards for empty contexts and trailing assistant messages).
 */
export function structuredAdaptiveAgentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	return agentLoopContinue(context, config, signal, streamFn);
}