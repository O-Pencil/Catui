/**
 * [WHO]: Provides InteractiveState, CompactionQueuedMessage — the shared render/turn UI state container
 * [FROM]: Depends on @pencil-agent/ai (AssistantMessage), @pencil-agent/tui (Component/Spacer/Text),
 *         components (AssistantMessageComponent/CustomMessageComponent/ToolExecutionComponent) — types only
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (holds one as `this.state`); will be read by the
 *       render-layer controller when handleEvent is sliced (UI04)
 * [HERE]: modes/interactive/state/interactive-state.ts — P5 state 合一 (UI02)
 *
 * Consolidates the ~20 scattered `this._` fields that describe the *current/streaming turn's render
 * state* (streaming message, tool components, loaders, run timers, status line, optimistic + compaction
 * queues). Plain field holder — no behavior; relocated verbatim from InteractiveMode so behavior is
 * identical. Concern-local state (bash, extension widgets, cancellation, skill, buddy) stays with its
 * own owner and is not consolidated here.
 */

import type { AssistantMessage } from "@pencil-agent/ai";
import type { Component, Spacer, Text } from "@pencil-agent/tui";
import type { AssistantMessageComponent } from "../components/assistant-message.js";
import type { CustomMessageComponent } from "../components/custom-message.js";
import type { ToolExecutionComponent } from "../components/tool-execution.js";

export type CompactionQueuedMessage = {
  text: string;
  mode: "steer" | "followUp";
};

export class InteractiveState {
  // Working message / run timers
  loadingAnimation: Component | undefined = undefined;
  pendingWorkingMessage: string | undefined = undefined;
  workingMessageOverride: string | undefined = undefined;
  agentRunStartMs: number | undefined = undefined;
  agentRunTimer: ReturnType<typeof setInterval> | undefined = undefined;
  welcomeBannerTimer: ReturnType<typeof setInterval> | undefined = undefined;

  // Status line tracking (for mutating immediately-sequential status updates)
  lastStatusSpacer: Spacer | undefined = undefined;
  lastStatusText: Text | undefined = undefined;

  // Streaming message tracking
  streamingComponent: AssistantMessageComponent | undefined = undefined;
  streamingMessage: AssistantMessage | undefined = undefined;
  customStreamComponents = new Map<string, CustomMessageComponent>();

  // Tool execution tracking: toolCallId -> component
  pendingTools = new Map<string, ToolExecutionComponent>();

  // Tool output expansion state
  toolOutputExpanded = false;

  // Thinking block visibility state
  hideThinkingBlock = false;

  // Auto-compaction state
  autoCompactionLoader: Component | undefined = undefined;
  autoCompactionEscapeHandler?: () => void;

  // Auto-retry state
  retryLoader: Component | undefined = undefined;
  retryEscapeHandler?: () => void;

  // Messages queued while compaction is running
  compactionQueuedMessages: CompactionQueuedMessage[] = [];
  // User messages rendered optimistically before Agent emits message_start
  optimisticUserMessages: Array<{ text: string }> = [];
}
