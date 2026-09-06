/**
 * [WHO]: Provides StatusDisplayController + StatusDisplayContext — chat status/error/warning
 *        lines with auto-dismiss timers, dedup-by-last-line, priority notifications
 * [FROM]: Depends on injected host capability closures + @catui/tui + NotificationQueue;
 *         no InteractiveMode reference
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held lazily as `this.statusDisplay`
 *       behind thin delegators: showStatus / showError / showWarning / notify / clearStatusTimers)
 * [HERE]: modes/interactive/controllers/status-display-controller.ts — P7 C-3d (extracted from
 *         InteractiveMode; behavior-preserving move)
 */
import { Spacer, Text, type CachedContainer, type TUI } from "@catui/tui";
import type { NotificationQueue } from "../components/notification-queue.js";
import type { BuddyState } from "../components/buddy/pet-sprites.js";
import type { InteractiveState } from "../state/interactive-state.js";
import { theme } from "../theme/theme.js";

/** Host capabilities needed by the status display controller. */
export interface StatusDisplayContext {
  readonly chatContainer: CachedContainer;
  readonly state: InteractiveState;
  readonly ui: TUI;
  readonly notificationQueue: NotificationQueue;
  setBuddyPetState(
    state: BuddyState,
    speechBubble?: string,
    options?: { resetTo?: BuddyState; afterMs?: number },
  ): void;
}

export class StatusDisplayController {
  private readonly statusTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly ctx: StatusDisplayContext) {}

  /**
   * Show a status message in the chat.
   *
   * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
   * we update the previous status line instead of appending new ones to avoid log spam.
   * Auto-dismisses after 5 seconds.
   */
  showStatus(message: string): void {
    const children = this.ctx.chatContainer.children;
    const last =
      children.length > 0 ? children[children.length - 1] : undefined;
    const secondLast =
      children.length > 1 ? children[children.length - 2] : undefined;

    if (
      last &&
      secondLast &&
      last === this.ctx.state.lastStatusText &&
      secondLast === this.ctx.state.lastStatusSpacer
    ) {
      this.ctx.state.lastStatusText.setText(theme.fg("dim", message));
      this.scheduleStatusDismiss(this.ctx.state.lastStatusSpacer!, this.ctx.state.lastStatusText);
      this.ctx.ui.requestRender();
      return;
    }

    const spacer = new Spacer(1);
    const text = new Text(theme.fg("dim", message), 1, 0);
    this.ctx.chatContainer.addChild(spacer);
    this.ctx.chatContainer.addChild(text);
    this.ctx.state.lastStatusSpacer = spacer;
    this.ctx.state.lastStatusText = text;
    this.scheduleStatusDismiss(spacer, text);
    this.ctx.ui.requestRender();
  }

  showError(errorMessage: string): void {
    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(
      new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0),
    );
    this.ctx.setBuddyPetState("error", "Oops...", {
      resetTo: "idle",
      afterMs: 2200,
    });
    this.ctx.ui.requestRender();
  }

  showWarning(warningMessage: string): void {
    const spacer = new Spacer(1);
    const text = new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0);
    this.ctx.chatContainer.addChild(spacer);
    this.ctx.chatContainer.addChild(text);
    this.scheduleStatusDismiss(spacer, text);
    this.ctx.setBuddyPetState("error", "Careful.", {
      resetTo: "idle",
      afterMs: 1800,
    });
    this.ctx.ui.requestRender();
  }

  /**
   * Schedule auto-removal of a status/warning message after 5 seconds.
   */
  private scheduleStatusDismiss(spacer: Spacer, text: Text): void {
    const timer = setTimeout(() => {
      this.statusTimers.delete(timer);
      this.ctx.chatContainer.removeChild(spacer);
      this.ctx.chatContainer.removeChild(text);
      // Clear lastStatus tracking if it matches the removed message
      if (this.ctx.state.lastStatusText === text) {
        this.ctx.state.lastStatusText = undefined;
        this.ctx.state.lastStatusSpacer = undefined;
      }
      this.ctx.ui.requestRender();
    }, 5000);
    this.statusTimers.add(timer);
  }

  /**
   * Cancel all pending status dismiss timers (e.g., on /clear).
   */
  clearStatusTimers(): void {
    for (const timer of this.statusTimers) {
      clearTimeout(timer);
    }
    this.statusTimers.clear();
    this.ctx.notificationQueue.clearAll();
  }

  /**
   * Show a priority notification (floating, auto-dismiss, dedup by key).
   */
  notify(message: string, options?: { key?: string; priority?: "immediate" | "high" | "medium" | "low"; type?: "info" | "warning" | "error"; duration?: number }): void {
    this.ctx.notificationQueue.notify(message, options);
  }
}
