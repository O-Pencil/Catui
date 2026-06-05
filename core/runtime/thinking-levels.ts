/**
 * [WHO]: Provides THINKING_LEVELS, THINKING_LEVELS_WITH_XHIGH, modelSupportsThinking,
 *        modelSupportsXhigh, availableThinkingLevels, clampThinkingLevel, nextThinkingLevel
 * [FROM]: Depends on @pencil-agent/ai (supportsXhigh, Model) and @pencil-agent/agent-core (ThinkingLevel)
 * [TO]: Consumed by core/runtime/model-controller.ts and core/runtime/agent-session.ts; reusable by any caller that maps a model to
 *       its thinking-level vocabulary (e.g. rpc/print mode)
 * [HERE]: core/runtime/agent-session.ts split (P4.2) — pure thinking-level logic, no session state
 *
 * Extracted from AgentSession: the stateless decision logic for which thinking levels a model
 * supports, clamping a requested level into the supported set, and cycling. AgentSession's
 * setThinkingLevel/cycleThinkingLevel/getAvailableThinkingLevels/supportsThinking methods
 * delegate here; the side-effects (agent.setThinkingLevel, persistence) stay in the session.
 */

import type { Model } from "@pencil-agent/ai/types";
import { supportsXhigh } from "@pencil-agent/ai/models";
import type { ThinkingLevel } from "@pencil-agent/agent-core";

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

/** Thinking levels including xhigh (for supported models). */
export const THINKING_LEVELS_WITH_XHIGH: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** Whether a model supports thinking/reasoning at all. */
export function modelSupportsThinking(model: Model<any> | undefined): boolean {
  return !!model?.reasoning;
}

/** Whether a model supports the xhigh thinking level. */
export function modelSupportsXhigh(model: Model<any> | undefined): boolean {
  return model ? supportsXhigh(model) : false;
}

/**
 * Thinking levels available for a model. The provider clamps further to what the
 * specific model supports internally.
 */
export function availableThinkingLevels(model: Model<any> | undefined): ThinkingLevel[] {
  if (!modelSupportsThinking(model)) return ["off"];
  return modelSupportsXhigh(model) ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS;
}

/** Clamp a requested level into the available set (prefer higher, then lower, then first). */
export function clampThinkingLevel(level: ThinkingLevel, availableLevels: ThinkingLevel[]): ThinkingLevel {
  const ordered = THINKING_LEVELS_WITH_XHIGH;
  const available = new Set(availableLevels);
  const requestedIndex = ordered.indexOf(level);
  if (requestedIndex === -1) {
    return availableLevels[0] ?? "off";
  }
  for (let i = requestedIndex; i < ordered.length; i++) {
    const candidate = ordered[i];
    if (available.has(candidate)) return candidate;
  }
  for (let i = requestedIndex - 1; i >= 0; i--) {
    const candidate = ordered[i];
    if (available.has(candidate)) return candidate;
  }
  return availableLevels[0] ?? "off";
}

/** Next level when cycling; undefined if the model does not support thinking. */
export function nextThinkingLevel(current: ThinkingLevel, model: Model<any> | undefined): ThinkingLevel | undefined {
  if (!modelSupportsThinking(model)) return undefined;
  const levels = availableThinkingLevels(model);
  const currentIndex = levels.indexOf(current);
  const nextIndex = (currentIndex + 1) % levels.length;
  return levels[nextIndex];
}
