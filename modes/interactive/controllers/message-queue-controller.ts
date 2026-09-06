/**
 * [WHO]: Provides MessageQueueController + MessageQueueContext — steering/follow-up/
 *        compaction queue management (queue, flush, restore-to-editor, pending display)
 * [FROM]: Depends on injected host capability closures + @catui/tui; no InteractiveMode
 *         reference; all cross-mode calls route through ctx callbacks so host-side method
 *         patching (partial-mode tests) keeps intercepting them
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held lazily as `this.messageQueue`
 *       behind thin delegators: handleFollowUp / handleDequeue / promptAfterRender /
 *       getAllQueuedMessages / clearAllQueues / updatePendingMessagesDisplay /
 *       restoreQueuedMessagesToEditor / queueCompactionMessage / flushCompactionQueue)
 * [HERE]: modes/interactive/controllers/message-queue-controller.ts — P7 C-3d (extracted from
 *         InteractiveMode; behavior-preserving move)
 */
import { Spacer, TruncatedText, type Container, type EditorComponent, type TUI } from "@catui/tui";
import type { AgentSession, PromptOptions } from "../../../core/runtime/agent-session.js";
import type { AppAction } from "../../../core/platform/keybindings.js";
import type { InteractiveState } from "../state/interactive-state.js";
import { theme } from "../theme/theme.js";

/** Host capabilities needed by the message-queue controller. */
export interface MessageQueueContext {
  readonly session: AgentSession;
  readonly state: InteractiveState;
  readonly editor: EditorComponent;
  readonly ui: TUI;
  readonly pendingMessagesContainer: Container;
  readonly agent: { abort(): void };

  isExtensionCommand(text: string): boolean;
  getAppKeyDisplay(action: AppAction): string;
  promptAfterRender(text: string, options?: PromptOptions): Promise<void>;
  showStatus(message: string): void;
  showError(errorMessage: string): void;
}

export class MessageQueueController {
  constructor(private readonly ctx: MessageQueueContext) {}

  async handleFollowUp(): Promise<void> {
    const text = (
      this.ctx.editor.getExpandedText?.() ?? this.ctx.editor.getText()
    ).trim();
    if (!text) return;

    // Queue input during compaction (extension commands execute immediately)
    if (this.ctx.session.isCompacting) {
      if (this.ctx.isExtensionCommand(text)) {
        this.ctx.editor.addToHistory?.(text);
        this.ctx.editor.setText("");
        await this.promptAfterRender(text);
      } else {
        this.queueCompactionMessage(text, "followUp");
      }
      return;
    }

    // Alt+Enter queues a follow-up message (waits until agent finishes)
    // This handles extension commands (execute immediately), prompt template expansion, and queueing
    if (this.ctx.session.isStreaming) {
      this.ctx.editor.addToHistory?.(text);
      this.ctx.editor.setText("");
      await this.promptAfterRender(text, { streamingBehavior: "followUp" });
      this.updatePendingMessagesDisplay();
      this.ctx.ui.requestRender();
    }
    // If not streaming, Alt+Enter acts like regular Enter (trigger onSubmit)
    else if (this.ctx.editor.onSubmit) {
      this.ctx.editor.onSubmit(text);
    }
  }

  handleDequeue(): void {
    const restored = this.restoreQueuedMessagesToEditor();
    if (restored === 0) {
      this.ctx.showStatus("No queued messages to restore");
    } else {
      this.ctx.showStatus(
        `Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`,
      );
    }
  }

  async promptAfterRender(
    text: string,
    options?: PromptOptions,
  ): Promise<void> {
    const renderAwareUi = this.ctx.ui as TUI & {
      awaitRender?: () => Promise<void>;
    };
    if (typeof renderAwareUi.awaitRender === "function") {
      await renderAwareUi.awaitRender();
    } else {
      await new Promise<void>((resolve) => process.nextTick(resolve));
    }
    await this.ctx.session.prompt(text, options);
  }

  /**
   * Get all queued messages (read-only).
   * Combines session queue and compaction queue.
   */
  getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
    return {
      steering: [
        ...this.ctx.session.getSteeringMessages(),
        ...this.ctx.state.compactionQueuedMessages
          .filter((msg) => msg.mode === "steer")
          .map((msg) => msg.text),
      ],
      followUp: [
        ...this.ctx.session.getFollowUpMessages(),
        ...this.ctx.state.compactionQueuedMessages
          .filter((msg) => msg.mode === "followUp")
          .map((msg) => msg.text),
      ],
    };
  }

  /**
   * Clear all queued messages and return their contents.
   * Clears both session queue and compaction queue.
   */
  clearAllQueues(): { steering: string[]; followUp: string[] } {
    const { steering, followUp } = this.ctx.session.clearQueue();
    const compactionSteering = this.ctx.state.compactionQueuedMessages
      .filter((msg) => msg.mode === "steer")
      .map((msg) => msg.text);
    const compactionFollowUp = this.ctx.state.compactionQueuedMessages
      .filter((msg) => msg.mode === "followUp")
      .map((msg) => msg.text);
    this.ctx.state.compactionQueuedMessages = [];
    return {
      steering: [...steering, ...compactionSteering],
      followUp: [...followUp, ...compactionFollowUp],
    };
  }

  updatePendingMessagesDisplay(): void {
    this.ctx.pendingMessagesContainer.clear();
    const { steering: steeringMessages, followUp: followUpMessages } =
      this.getAllQueuedMessages();
    if (steeringMessages.length > 0 || followUpMessages.length > 0) {
      this.ctx.pendingMessagesContainer.addChild(new Spacer(1));
      for (const message of steeringMessages) {
        const text = theme.fg("dim", `Steering: ${message}`);
        this.ctx.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      for (const message of followUpMessages) {
        const text = theme.fg("dim", `Follow-up: ${message}`);
        this.ctx.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      const dequeueHint = this.ctx.getAppKeyDisplay("dequeue");
      const hintText = theme.fg(
        "dim",
        `↳ ${dequeueHint} to edit all queued messages`,
      );
      this.ctx.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
    }
  }

  restoreQueuedMessagesToEditor(options?: {
    abort?: boolean;
    currentText?: string;
  }): number {
    const { steering, followUp } = this.clearAllQueues();
    const allQueued = [...steering, ...followUp];
    if (allQueued.length === 0) {
      this.updatePendingMessagesDisplay();
      if (options?.abort) {
        this.ctx.agent.abort();
      }
      return 0;
    }
    const queuedText = allQueued.join("\n\n");
    const currentText = options?.currentText ?? this.ctx.editor.getText();
    const combinedText = [queuedText, currentText]
      .filter((t) => t.trim())
      .join("\n\n");
    this.ctx.editor.setText(combinedText);
    this.updatePendingMessagesDisplay();
    if (options?.abort) {
      this.ctx.agent.abort();
    }
    return allQueued.length;
  }

  queueCompactionMessage(
    text: string,
    mode: "steer" | "followUp",
  ): void {
    this.ctx.state.compactionQueuedMessages.push({ text, mode });
    this.ctx.editor.addToHistory?.(text);
    this.ctx.editor.setText("");
    this.updatePendingMessagesDisplay();
    this.ctx.showStatus("Queued message for after compaction");
  }

  async flushCompactionQueue(options?: {
    willRetry?: boolean;
  }): Promise<void> {
    if (this.ctx.state.compactionQueuedMessages.length === 0) {
      return;
    }

    const queuedMessages = [...this.ctx.state.compactionQueuedMessages];
    this.ctx.state.compactionQueuedMessages = [];
    this.updatePendingMessagesDisplay();

    const restoreQueue = (error: unknown) => {
      this.ctx.session.clearQueue();
      this.ctx.state.compactionQueuedMessages = queuedMessages;
      this.updatePendingMessagesDisplay();
      this.ctx.showError(
        `Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    };

    try {
      if (options?.willRetry) {
        // When retry is pending, queue messages for the retry turn
        for (const message of queuedMessages) {
          if (this.ctx.isExtensionCommand(message.text)) {
            await this.promptAfterRender(message.text);
          } else if (message.mode === "followUp") {
            await this.ctx.session.followUp(message.text);
          } else {
            await this.ctx.session.steer(message.text);
          }
        }
        this.updatePendingMessagesDisplay();
        return;
      }

      // Find first non-extension-command message to use as prompt
      const firstPromptIndex = queuedMessages.findIndex(
        (message) => !this.ctx.isExtensionCommand(message.text),
      );
      if (firstPromptIndex === -1) {
        // All extension commands - execute them all
        for (const message of queuedMessages) {
          await this.promptAfterRender(message.text);
        }
        return;
      }

      // Execute any extension commands before the first prompt
      const preCommands = queuedMessages.slice(0, firstPromptIndex);
      const firstPrompt = queuedMessages[firstPromptIndex];
      const rest = queuedMessages.slice(firstPromptIndex + 1);

      for (const message of preCommands) {
        await this.promptAfterRender(message.text);
      }

      // Send first prompt (starts streaming)
      const promptPromise = this
        .promptAfterRender(firstPrompt.text)
        .catch((error) => {
          restoreQueue(error);
        });

      // Queue remaining messages
      for (const message of rest) {
        if (this.ctx.isExtensionCommand(message.text)) {
          await this.promptAfterRender(message.text);
        } else if (message.mode === "followUp") {
          await this.ctx.session.followUp(message.text);
        } else {
          await this.ctx.session.steer(message.text);
        }
      }
      this.updatePendingMessagesDisplay();
      void promptPromise;
    } catch (error) {
      restoreQueue(error);
    }
  }
}
