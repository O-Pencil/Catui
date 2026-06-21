/**
 * [WHO]: Provides StreamRenderController + StreamRenderContext (state/layout/loaders/toolTrace/runtime/
 *        escape/surface ports) — the interactive streaming render layer (handleEvent)
 * [FROM]: Depends on interactive-state (shared render fields), tui (Container/Text/Spacer/TUI/MarkdownTheme),
 *         components (Assistant/Tool/CatuiLoader), theme, agent-session (AgentSessionEvent), ai (Message),
 *         agent-core (AgentMessage), extensions-host (ToolDefinition), buddy pet-sprites (BuddyState)
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held as `this.streamRender`; subscribeToAgent's
 *       handleEvent forwards here)
 * [HERE]: modes/interactive/controllers/stream-render-controller.ts — P5 UI04 render-layer slice (scope A)
 *
 * Owns the AgentSession event → TUI render orchestration: run lifecycle/loader, assistant streaming,
 * user/custom echo, tool-execution display, and the auto-compaction / auto-retry overlays. It is a render
 * layer: it reads session events and writes components, and NEVER submits any message to AgentSession
 * (token-neutral). Shared render state stays in the consolidated `interactive-state` holder (accessed via
 * the `state` port — that holder's stated purpose); the auto-compaction / auto-retry loader+escape state
 * (zero external readers) is owned privately here. The escape override during compaction/retry goes through
 * the `escape` port — the single controlled channel onto `defaultEditor.onEscape` shared with
 * InterruptController (whose dispatchEscape closure is what gets saved and restored).
 * See ../../../.dev-docs/architecture-review/interactive-ui-review/handle-event-analysis.md
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@catui/agent-core";
import type { Message } from "@catui/ai/types";
import {
  type CachedContainer,
  type Component,
  type Container,
  type MarkdownTheme,
  Spacer,
  Text,
  type TUI,
} from "@catui/tui";
import type { ToolDefinition } from "../../../core/extensions-host/types.js";
import type { AgentSessionEvent } from "../../../core/runtime/agent-session.js";
import { AssistantMessageComponent } from "../components/assistant-message.js";
import type { BuddyState } from "../components/buddy/pet-sprites.js";
import { CatuiLoader } from "../components/catui-loader.js";
import { ToolExecutionComponent } from "../components/tool-execution.js";
import { SubAgentPanelComponent } from "../components/sub-agent-panel.js";
import { PlanProgressPanelComponent } from "../components/plan-progress-panel.js";
import { TaskStatusPanelComponent, type TaskStatusEntry } from "../components/task-status-panel.js";
import type { InteractiveState, PlanProgressState, SubAgentState } from "../state/interactive-state.js";
import { theme } from "../theme/theme.js";
import { consumeMatchingVisibleUserQuery } from "../user-query-dedupe.js";
import { listTasks, onTasksUpdated, resetTaskList, getTaskListId } from "../../../extensions/builtin/task/task-store.js";
import { DEFAULT_TASK_LIST_ID } from "../../../extensions/builtin/task/task-types.js";

export interface StreamRenderStatePort {
  get(): InteractiveState;
}

export interface StreamRenderLayoutPort {
  getUi(): TUI;
  getChatContainer(): CachedContainer;
  getStatusContainer(): Container;
  addMessageToChat(message: AgentMessage): void;
  updatePendingMessagesDisplay(): void;
  rebuildChatFromMessages(): void;
  requestRender(): void;
  invalidateFooter(): void;
}

export interface StreamRenderLoadersPort {
  getSessionId(): string;
  getDefaultWorkingMessage(): string;
  /** Localized "<key> to cancel" hint key for the interrupt action. */
  getInterruptKeyHint(): string;
  setBuddyPetState(
    state: BuddyState,
    speechBubble?: string,
    options?: { resetTo?: BuddyState; afterMs?: number },
  ): void;
  startAgentRunTimer(): void;
  stopAgentRunTimer(): void;
  updateWorkingMessage(options?: { resetStallTimer?: boolean }): void;
  formatElapsedSeconds(ms: number): string;
  isInPlanMode(): boolean;
}

export interface StreamRenderToolTracePort {
  shouldRenderToolTrace(toolName: string): boolean;
  getRegisteredToolDefinition(toolName: string): ToolDefinition | undefined;
  getShowImages(): boolean;
}

export interface StreamRenderRuntimePort {
  getRetryAttempt(): number;
  abortCompaction(): void;
  abortRetry(): void;
  flushCompactionQueue(options: { willRetry: boolean }): void;
  checkShutdownRequested(): Promise<void>;
  clearAttachments(): void;
  getAgentDir(): string;
}

/** The single controlled channel onto defaultEditor.onEscape, shared with InterruptController. */
export interface StreamRenderEscapePort {
  getHandler(): (() => void) | undefined;
  setHandler(handler: (() => void) | undefined): void;
}

export interface StreamRenderSurfacePort {
  ensureInitialized(): Promise<void>;
  restoreEditorFocusIfPossible(): void;
  getUserMessageText(message: Message): string;
  getMarkdownThemeWithSettings(): MarkdownTheme;
  showStatus(message: string): void;
  showError(message: string): void;
}

export interface StreamRenderContext {
  state: StreamRenderStatePort;
  layout: StreamRenderLayoutPort;
  loaders: StreamRenderLoadersPort;
  toolTrace: StreamRenderToolTracePort;
  runtime: StreamRenderRuntimePort;
  escape: StreamRenderEscapePort;
  surface: StreamRenderSurfacePort;
}

/** Task tool names that should trigger a task panel refresh. */
const TASK_TOOL_NAMES = new Set(["TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "TaskDelete"]);

const _dbgEnabled = process.env.CATUI_DEBUG === "1";
const debugLogPath = path.join(os.homedir(), ".catui", "agent", "catui-debug.log");
function dbg(msg: string): void {
	// Off by default; never write or crash in a release (ENOENT on fresh install).
	if (!_dbgEnabled) return;
	try {
		fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
		fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] [render] ${msg}\n`);
	} catch {
		// debug logging is best-effort
	}
}

/** Delay before auto-hiding the task panel after all tasks complete. */
const TASK_AUTO_HIDE_DELAY_MS = 5000;

export class StreamRenderController {
  // Auto-compaction / auto-retry overlay state — zero external readers, owned here.
  private autoCompactionLoader: Component | undefined = undefined;
  private autoCompactionEscapeHandler: (() => void) | undefined = undefined;
  private retryLoader: Component | undefined = undefined;
  private retryEscapeHandler: (() => void) | undefined = undefined;

  // Task status panel subscription
  private taskUpdateUnsubscribe: (() => void) | undefined = undefined;
  private taskAutoHideTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  constructor(private readonly ctx: StreamRenderContext) {}

  async handle(event: AgentSessionEvent): Promise<void> {
    dbg(`handle event: ${event.type}`);
    await this.ctx.surface.ensureInitialized();

    this.ctx.layout.invalidateFooter();

    const state = this.ctx.state.get();
    const ui = this.ctx.layout.getUi();
    const chatContainer = this.ctx.layout.getChatContainer();
    const statusContainer = this.ctx.layout.getStatusContainer();

    switch (event.type) {
      case "agent_start":
        // Restore main escape handler if retry handler is still active
        // (retry success event fires later, but we need main handler now)
        if (this.retryEscapeHandler) {
          this.ctx.escape.setHandler(this.retryEscapeHandler);
          this.retryEscapeHandler = undefined;
        }
        if (this.retryLoader) {
          (this.retryLoader as CatuiLoader).stop();
          this.retryLoader = undefined;
        }
        if (state.loadingAnimation) {
          (state.loadingAnimation as CatuiLoader).stop();
        }
        statusContainer.clear();
        state.loadingAnimation = new CatuiLoader(
          ui,
          theme,
          this.ctx.loaders.getDefaultWorkingMessage(),
          this.ctx.loaders.getSessionId(),
        );
        statusContainer.addChild(state.loadingAnimation);
        this.ctx.loaders.setBuddyPetState("working", "Working...");
        // Apply any pending working message queued before loader existed
        if (state.pendingWorkingMessage !== undefined) {
          state.workingMessageOverride = state.pendingWorkingMessage || undefined;
          state.pendingWorkingMessage = undefined;
        }
        this.ctx.loaders.startAgentRunTimer();
        this.ctx.loaders.updateWorkingMessage({ resetStallTimer: false });
        // Create plan progress panel if in plan mode
        if (this.ctx.loaders.isInPlanMode()) {
          state.planProgress = createInitialPlanProgress();
          state.planProgressPanel = new PlanProgressPanelComponent(ui, theme);
          statusContainer.addChild(state.planProgressPanel);
          state.planProgressPanel.update(state.planProgress);
        }
        // Load existing tasks and subscribe to task updates
        this.refreshTaskPanel(state, ui, statusContainer).catch(() => {});
        this.taskUpdateUnsubscribe?.();
        this.taskUpdateUnsubscribe = onTasksUpdated(() => {
          this.refreshTaskPanel(state, ui, statusContainer).catch(() => {});
        });
        this.ctx.surface.restoreEditorFocusIfPossible();
        this.ctx.layout.requestRender();
        break;

      case "message_start":
        if (event.message.role === "custom") {
          this.ctx.layout.addMessageToChat(event.message);
          this.ctx.layout.requestRender();
        } else if (event.message.role === "user") {
          const textContent = this.ctx.surface.getUserMessageText(event.message);
          if (
            consumeMatchingVisibleUserQuery(state.optimisticUserMessages, textContent, {
              consumeOldestOnMismatch: true,
            })
          ) {
            break;
          }
          this.ctx.layout.addMessageToChat(event.message);
          this.ctx.layout.updatePendingMessagesDisplay();
          this.ctx.layout.requestRender();
        } else if (event.message.role === "assistant") {
          state.streamingComponent = new AssistantMessageComponent(
            undefined,
            state.hideThinkingBlock,
            this.ctx.surface.getMarkdownThemeWithSettings(),
          );
          state.streamingMessage = event.message;
          chatContainer.addChild(state.streamingComponent);
          state.streamingComponent.updateContent(state.streamingMessage);
          this.ctx.layout.requestRender();
        }
        break;

      case "message_update":
        if (state.streamingComponent && event.message.role === "assistant") {
          // Reset stall timer on new output - spinner should not show as stuck
          if (state.loadingAnimation) {
            (state.loadingAnimation as CatuiLoader).resetStallTimer();
          }
          state.streamingMessage = event.message;
          state.streamingComponent.updateContent(state.streamingMessage);
          chatContainer.markDirty(state.streamingComponent);

          for (const content of state.streamingMessage.content) {
            if (content.type === "toolCall") {
              if (!this.ctx.toolTrace.shouldRenderToolTrace(content.name)) {
                continue;
              }
              if (!state.pendingTools.has(content.id)) {
                chatContainer.addChild(new Text("", 0, 0));
                const component = new ToolExecutionComponent(
                  content.name,
                  content.arguments,
                  {
                    showImages: this.ctx.toolTrace.getShowImages(),
                  },
                  this.ctx.toolTrace.getRegisteredToolDefinition(content.name),
                  ui,
                );
                component.setExpanded(state.toolOutputExpanded);
                chatContainer.addChild(component);
                state.pendingTools.set(content.id, component);
              } else {
                const component = state.pendingTools.get(content.id);
                if (component) {
                  component.updateArgs(content.arguments);
                  chatContainer.markDirty(component);
                }
              }
            }
          }
          this.ctx.layout.requestRender();
        }
        break;

      case "message_end":
        if (event.message.role === "user") break;
        if (state.streamingComponent && event.message.role === "assistant") {
          state.streamingMessage = event.message;
          let errorMessage: string | undefined;
          if (state.streamingMessage.stopReason === "aborted") {
            const retryAttempt = this.ctx.runtime.getRetryAttempt();
            errorMessage =
              retryAttempt > 0
                ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
                : "Operation aborted";
            state.streamingMessage.errorMessage = errorMessage;
          }
          state.streamingComponent.updateContent(state.streamingMessage);
          chatContainer.markDirty(state.streamingComponent);

          if (
            state.streamingMessage.stopReason === "aborted" ||
            state.streamingMessage.stopReason === "error"
          ) {
            if (!errorMessage) {
              errorMessage = state.streamingMessage.errorMessage || "Error";
            }
            for (const [, component] of state.pendingTools.entries()) {
              component.updateResult({
                content: [{ type: "text", text: errorMessage }],
                isError: true,
              });
              chatContainer.markDirty(component);
            }
            state.pendingTools.clear();
          } else {
            // Args are now complete - trigger diff computation for edit tools
            for (const [, component] of state.pendingTools.entries()) {
              component.setArgsComplete();
              chatContainer.markDirty(component);
            }
          }
          state.streamingComponent = undefined;
          state.streamingMessage = undefined;
          this.ctx.layout.invalidateFooter();
        }
        this.ctx.layout.requestRender();
        break;

      case "tool_execution_start": {
        // Detect plan phase transitions
        if (state.planProgress && state.planProgressPanel) {
          detectPlanPhaseTransition(state.planProgress, event.toolName, event.args);
          state.planProgressPanel.update(state.planProgress);
          this.ctx.layout.requestRender();
        }
        if (!this.ctx.toolTrace.shouldRenderToolTrace(event.toolName)) {
          break;
        }
        if (!state.pendingTools.has(event.toolCallId)) {
          const component = new ToolExecutionComponent(
            event.toolName,
            event.args,
            {
              showImages: this.ctx.toolTrace.getShowImages(),
            },
            this.ctx.toolTrace.getRegisteredToolDefinition(event.toolName),
            ui,
          );
          component.setExpanded(state.toolOutputExpanded);
          chatContainer.addChild(component);
          state.pendingTools.set(event.toolCallId, component);
          this.ctx.layout.requestRender();
        }
        break;
      }

      case "tool_execution_update": {
        const component = state.pendingTools.get(event.toolCallId);
        if (component) {
          component.updateResult(
            { ...event.partialResult, isError: false },
            true,
          );
          chatContainer.markDirty(component);
          this.ctx.layout.requestRender();
        }
        break;
      }

      case "tool_execution_end": {
        const component = state.pendingTools.get(event.toolCallId);
        if (component) {
          component.updateResult({ ...event.result, isError: event.isError });
          chatContainer.markDirty(component);
          state.pendingTools.delete(event.toolCallId);
          this.ctx.layout.requestRender();
        }
        break;
      }

      case "agent_end": {
        dbg("agent_end received");
        const finalElapsed =
          state.agentRunStartMs !== undefined
            ? this.ctx.loaders.formatElapsedSeconds(Date.now() - state.agentRunStartMs)
            : undefined;
        this.ctx.loaders.stopAgentRunTimer();
        state.agentRunStartMs = undefined;
        state.workingMessageOverride = undefined;
        if (state.loadingAnimation) {
          (state.loadingAnimation as CatuiLoader).stop();
          state.loadingAnimation = undefined;
          statusContainer.clear();
        }
        if (state.streamingComponent) {
          chatContainer.removeChild(state.streamingComponent);
          state.streamingComponent = undefined;
          state.streamingMessage = undefined;
        }
        state.pendingTools.clear();
        // Clean up sub-agent panel
        if (state.subAgentPanelComponent) {
          statusContainer.removeChild(state.subAgentPanelComponent);
          state.subAgentPanelComponent = undefined;
        }
        state.subAgentStates.clear();
        // Clean up plan progress panel
        if (state.planProgressPanel) {
          statusContainer.removeChild(state.planProgressPanel);
          state.planProgressPanel = undefined;
        }
        state.planProgress = undefined;
        // Clean up task status panel
        if (state.taskStatusPanel) {
          state.taskStatusPanel.dispose?.();
          statusContainer.removeChild(state.taskStatusPanel);
          state.taskStatusPanel = undefined;
        }
        if (this.taskAutoHideTimer) {
          clearTimeout(this.taskAutoHideTimer);
          this.taskAutoHideTimer = undefined;
        }
        // Clear any leftover attachments when the turn ends so the bar doesn't
        // accumulate across conversations (sent attachments are already cleared
        // at submit; this also covers images consumed via on-disk file reads).
        this.ctx.runtime.clearAttachments();
        this.ctx.loaders.setBuddyPetState("happy", "Done!", {
          resetTo: "idle",
          afterMs: 1800,
        });
        if (finalElapsed) {
          this.ctx.surface.showStatus(`Completed in ${finalElapsed}`);
        }

        await this.ctx.runtime.checkShutdownRequested();

        this.ctx.surface.restoreEditorFocusIfPossible();
        this.ctx.layout.requestRender();
        break;
      }

      // ── Sub-agent lifecycle events ────────────────────────────────
      case "sub_agent_start": {
        const sa: SubAgentState = {
          id: event.subAgentId,
          agentType: event.agentType,
          description: event.description,
          isAsync: event.isAsync,
          isResolved: false,
          isError: false,
          toolUseCount: 0,
          lastToolName: null,
          startTime: Date.now(),
        };
        state.subAgentStates.set(event.subAgentId, sa);
        if (!state.subAgentPanelComponent) {
          state.subAgentPanelComponent = new SubAgentPanelComponent(ui, theme);
          statusContainer.addChild(state.subAgentPanelComponent);
        }
        (state.subAgentPanelComponent as SubAgentPanelComponent).update(state.subAgentStates);
        this.ctx.layout.requestRender();
        break;
      }

      case "sub_agent_tool_start": {
        const sa = state.subAgentStates.get(event.subAgentId);
        if (sa) {
          sa.lastToolName = event.toolName;
          if (state.subAgentPanelComponent) {
            (state.subAgentPanelComponent as SubAgentPanelComponent).update(state.subAgentStates);
          }
          this.ctx.layout.requestRender();
        }
        break;
      }

      case "sub_agent_tool_end": {
        const sa = state.subAgentStates.get(event.subAgentId);
        if (sa) {
          sa.toolUseCount += 1;
          sa.lastToolName = null;
          if (state.subAgentPanelComponent) {
            (state.subAgentPanelComponent as SubAgentPanelComponent).update(state.subAgentStates);
          }
          this.ctx.layout.requestRender();
        }
        break;
      }

      case "sub_agent_end": {
        const sa = state.subAgentStates.get(event.subAgentId);
        if (sa) {
          sa.isResolved = true;
          sa.isError = !event.success;
          sa.lastToolName = null;
          if (state.subAgentPanelComponent) {
            (state.subAgentPanelComponent as SubAgentPanelComponent).update(state.subAgentStates);
          }
          this.ctx.layout.requestRender();
        }
        break;
      }

      case "auto_compaction_start": {
        // Keep editor active; submissions are queued during compaction.
        // Set up escape to abort auto-compaction
        this.autoCompactionEscapeHandler = this.ctx.escape.getHandler();
        this.ctx.escape.setHandler(() => {
          this.ctx.runtime.abortCompaction();
        });
        // Show compacting indicator with reason
        statusContainer.clear();
        const reasonText =
          event.reason === "overflow" ? "Context overflow detected, " : "";
        this.autoCompactionLoader = new CatuiLoader(
          ui,
          theme,
          `${reasonText}Auto-compacting... (${this.ctx.loaders.getInterruptKeyHint()} to cancel)`,
        );
        statusContainer.addChild(this.autoCompactionLoader);
        this.ctx.layout.requestRender();
        break;
      }

      case "auto_compaction_end": {
        // Restore escape handler
        if (this.autoCompactionEscapeHandler) {
          this.ctx.escape.setHandler(this.autoCompactionEscapeHandler);
          this.autoCompactionEscapeHandler = undefined;
        }
        // Stop loader
        if (this.autoCompactionLoader) {
          (this.autoCompactionLoader as CatuiLoader).stop();
          this.autoCompactionLoader = undefined;
          statusContainer.clear();
        }
        // Handle result
        if (event.aborted) {
          this.ctx.surface.showStatus("Auto-compaction cancelled");
        } else if (event.result) {
          // Rebuild chat to show compacted state
          chatContainer.clear();
          this.ctx.layout.rebuildChatFromMessages();
          // Add compaction component at bottom so user sees it without scrolling
          this.ctx.layout.addMessageToChat({
            role: "compactionSummary",
            tokensBefore: event.result.tokensBefore,
            summary: event.result.summary,
            timestamp: Date.now(),
          });
          this.ctx.layout.invalidateFooter();
        } else if (event.errorMessage) {
          // Compaction failed (e.g., quota exceeded, API error)
          chatContainer.addChild(new Spacer(1));
          chatContainer.addChild(
            new Text(theme.fg("error", event.errorMessage), 1, 0),
          );
        }
        this.ctx.runtime.flushCompactionQueue({ willRetry: event.willRetry });
        this.ctx.layout.requestRender();
        break;
      }

      case "auto_retry_start": {
        // Set up escape to abort retry
        this.retryEscapeHandler = this.ctx.escape.getHandler();
        this.ctx.escape.setHandler(() => {
          this.ctx.runtime.abortRetry();
        });
        // Show retry indicator
        statusContainer.clear();
        const delaySeconds = Math.round(event.delayMs / 1000);
        this.retryLoader = new CatuiLoader(
          ui,
          theme,
          `Retrying (${event.attempt}/${event.maxAttempts}) in ${delaySeconds}s... (${this.ctx.loaders.getInterruptKeyHint()} to cancel)`,
        );
        statusContainer.addChild(this.retryLoader);
        this.ctx.layout.requestRender();
        break;
      }

      case "auto_retry_end": {
        // Restore escape handler
        if (this.retryEscapeHandler) {
          this.ctx.escape.setHandler(this.retryEscapeHandler);
          this.retryEscapeHandler = undefined;
        }
        // Stop loader
        if (this.retryLoader) {
          (this.retryLoader as CatuiLoader).stop();
          this.retryLoader = undefined;
          statusContainer.clear();
        }
        // Show error only on final failure (success shows normal response)
        if (!event.success) {
          this.ctx.surface.showError(
            `Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
          );
        }
        this.ctx.layout.requestRender();
        break;
      }
    }
  }

  // ── Task status panel helpers ────────────────────────────────────────

  /** Task tool names that should trigger a panel refresh. */
  private static readonly TASK_TOOL_NAMES = new Set([
    "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "TaskDelete",
  ]);

  /** Refresh the task status panel from disk. */
  private async refreshTaskPanel(
    state: InteractiveState,
    ui: TUI,
    statusContainer: Container,
  ): Promise<void> {
    const agentDir = this.ctx.runtime.getAgentDir();
    if (!agentDir) return;

    // Resolve task list ID per CC semantics (env > team > session ID)
    const sessionId = this.ctx.loaders.getSessionId?.();
    const taskListId = getTaskListId(sessionId);

    try {
      const rawTasks = await listTasks(agentDir, taskListId);
      // Filter out internal tasks
      const tasks = rawTasks
        .filter((t) => !(t.metadata as Record<string, unknown>)?._internal)
        .map((t) => ({
          id: t.id,
          subject: t.subject,
          status: t.status as "pending" | "in_progress" | "completed",
          activeForm: t.activeForm,
          blockedBy: t.blockedBy.filter((id) => {
            // Only show unresolved blockers
            return rawTasks.some((bt) => bt.id === id && bt.status !== "completed");
          }),
        }));

      if (tasks.length === 0) {
        // No tasks — remove panel if it exists
        if (state.taskStatusPanel) {
          state.taskStatusPanel.dispose?.();
          statusContainer.removeChild(state.taskStatusPanel);
          state.taskStatusPanel = undefined;
        }
        if (this.taskAutoHideTimer) {
          clearTimeout(this.taskAutoHideTimer);
          this.taskAutoHideTimer = undefined;
        }
        return;
      }

      // Create panel if it doesn't exist
      if (!state.taskStatusPanel) {
        state.taskStatusPanel = new TaskStatusPanelComponent(ui, theme);
        statusContainer.addChild(state.taskStatusPanel);
      }

      state.taskStatusPanel.update(tasks);
      this.ctx.layout.requestRender();

      // Auto-hide after all tasks complete (like CC)
      const allDone = tasks.every((t) => t.status === "completed");
      if (allDone) {
        if (!this.taskAutoHideTimer) {
          this.taskAutoHideTimer = setTimeout(async () => {
            this.taskAutoHideTimer = undefined;
            // Verify still all done
            const currentTasks = await listTasks(agentDir, taskListId)
              .catch(() => []);
            const stillAllDone = currentTasks.length > 0 &&
              currentTasks.every((t) => t.status === "completed");
            if (stillAllDone) {
              // Just remove the panel — don't reset the task list (user may want to review)
              if (state.taskStatusPanel) {
                state.taskStatusPanel.dispose?.();
                statusContainer.removeChild(state.taskStatusPanel);
                state.taskStatusPanel = undefined;
              }
              this.ctx.layout.requestRender();
            }
          }, TASK_AUTO_HIDE_DELAY_MS);
        }
      } else {
        // Not all done — cancel any pending auto-hide
        if (this.taskAutoHideTimer) {
          clearTimeout(this.taskAutoHideTimer);
          this.taskAutoHideTimer = undefined;
        }
      }
    } catch {
      // Ignore errors reading tasks
    }
  }
}

// ============================================================================
// Plan progress helpers
// ============================================================================

const PLAN_PHASE_LABELS = [
  "Phase 1: Initial Understanding",
  "Phase 2: Design",
  "Phase 3: Review",
  "Phase 4: Final Plan",
  "Phase 5: Call ExitPlanMode",
] as const;

function createInitialPlanProgress(): PlanProgressState {
  return {
    phases: PLAN_PHASE_LABELS.map((label, i) => ({
      label,
      status: i === 0 ? "in_progress" : "pending",
    })),
    currentPhaseIndex: 0,
    startTime: Date.now(),
  };
}

/**
 * Detect plan phase transitions based on tool execution events.
 * Maps tool usage to plan workflow phases:
 * - Agent (Explore) → Phase 1 (Initial Understanding)
 * - Agent (Plan) → Phase 2 (Design)
 * - Read/Grep/Find in plan mode → Phase 3 (Review)
 * - Write/Edit targeting plan file → Phase 4 (Final Plan)
 * - ExitPlanMode → Phase 5 (completed)
 */
function detectPlanPhaseTransition(
  progress: PlanProgressState,
  toolName: string,
  args: Record<string, unknown>,
): void {
  let targetPhase: number;

  if (toolName === "ExitPlanMode") {
    // Mark all phases as completed
    for (const phase of progress.phases) {
      phase.status = "completed";
    }
    progress.currentPhaseIndex = progress.phases.length;
    return;
  }

  if (toolName === "Agent") {
    // Check agent type from args to distinguish Explore vs Plan
    const agentType = (args.subagent_type as string) ?? "";
    if (agentType.toLowerCase() === "plan") {
      targetPhase = 1; // Phase 2: Design (0-indexed)
    } else {
      targetPhase = 0; // Phase 1: Initial Understanding (Explore or default)
    }
  } else if (toolName === "Read" || toolName === "Grep" || toolName === "Find") {
    targetPhase = 2; // Phase 3: Review
  } else if (toolName === "Write" || toolName === "Edit") {
    targetPhase = 3; // Phase 4: Final Plan
  } else if (toolName === "AskUserQuestion") {
    // Stay in current phase — asking questions is part of any phase
    return;
  } else {
    // Unknown tool — don't change phase
    return;
  }

  // Only advance, never go backward
  if (targetPhase > progress.currentPhaseIndex) {
    // Mark all phases up to target as completed
    for (let i = progress.currentPhaseIndex; i < targetPhase; i++) {
      progress.phases[i].status = "completed";
    }
    progress.currentPhaseIndex = targetPhase;
    progress.phases[targetPhase].status = "in_progress";
  }
}
