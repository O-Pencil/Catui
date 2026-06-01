/**
 * [WHO]: Provides pickThinkingLevelOnModelChange(), nextCyclicIndex() — pure model-cycle decisions
 * [FROM]: Depends on @pencil-agent/ai (Model), @pencil-agent/agent-core (ThinkingLevel)
 * [TO]: Consumed by core/runtime/agent-session.ts model switching/cycling
 * [HERE]: core/runtime/agent-session.ts split (P4.2) — stateless model-cycle logic, no session state
 *
 * Extracted from AgentSession: the pure decisions in setModel / cycleModel. The side-effecting
 * apply sequence (agent.setModel, persistence, emit) stays in the session.
 */

import type { Model } from "@pencil-agent/ai";
import type { ThinkingLevel } from "@pencil-agent/agent-core";

/**
 * Thinking level to use after switching to `model`, given the current level:
 * - model without reasoning → "off"
 * - reasoning model but currently "off" → "medium" (sensible default)
 * - otherwise keep the current level (the provider clamps to capabilities)
 */
export function pickThinkingLevelOnModelChange(model: Model<any>, currentLevel: ThinkingLevel): ThinkingLevel {
  if (!model.reasoning) return "off";
  if (currentLevel === "off") return "medium";
  return currentLevel;
}

/** Next index when cycling through a list of length `length`. */
export function nextCyclicIndex(currentIndex: number, length: number, direction: "forward" | "backward"): number {
  return direction === "forward" ? (currentIndex + 1) % length : (currentIndex - 1 + length) % length;
}
