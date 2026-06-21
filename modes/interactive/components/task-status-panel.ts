/**
 * [WHO]: TaskStatusPanelComponent - renders persistent task status with checkboxes
 * [FROM]: Depends on @catui/tui, extensions/builtin/task/task-store
 * [TO]: Consumed by StreamRenderController
 * [HERE]: modes/interactive/components/task-status-panel.ts - CC-style task status TUI panel
 *
 * Completed tasks stay visible (no auto-dispose) and are visually de-emphasized
 * via dim + strikethrough. Tasks that just transitioned to completed are
 * prioritized for the RECENT_COMPLETED_TTL_MS window so the user can see what
 * just finished before it ages out.
 */

import { Container, Spacer, Text, truncateToWidth, type TUI } from "@catui/tui";
import type { Theme } from "../theme/theme.js";

export interface TaskStatusEntry {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
  blockedBy?: string[];
}

const TASK_SPINNER_FRAMES = ["♫", "♬"];
/** Max tasks visible before collapsing. Dynamically adjusted by terminal height. */
const MAX_VISIBLE_TASKS = 10;
const MIN_VISIBLE_TASKS = 3;
/** CC parity: a task that transitioned to `completed` within this window is
 *  promoted to the top of the completed bucket so the user can see it. */
const RECENT_COMPLETED_TTL_MS = 30_000;

export class TaskStatusPanelComponent extends Container {
  private tui: TUI;
  private theme: Theme;
  private spinnerFrame = 0;
  private spinnerTimer: NodeJS.Timeout | undefined;
  private headerText: Text;
  private taskLines: Text[] = [];
  private overflowLine: Text | undefined;
  private lastTasks: TaskStatusEntry[] = [];
  /** Tracks when each task was last observed transitioning to `completed`.
   *  Only newly-completed tasks are recorded; tasks that go back to pending
   *  have their entry removed by `pruneCompletionTimestamps()`. */
  private completionTimestamps = new Map<string, number>();
  /** Last task ID set we saw as completed. Used to detect transitions. */
  private previousCompletedIds = new Set<string>();
  /** Whether the snapshot has been seeded yet (first update call). */
  private snapshotSeeded = false;

  constructor(tui: TUI, theme: Theme) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.headerText = new Text("", 0, 0);
    this.addChild(new Spacer(1));
    this.addChild(this.headerText);
  }

  /**
   * Update completion timestamp tracking: a task only gets a fresh timestamp
   * the first time we see it transition from non-completed → completed within
   * this component's lifetime. Initial seed does not count as a transition so
   * re-rendering a session that boots up with completed tasks does not
   * promote them to "recent".
   */
  private updateCompletionTimestamps(tasks: TaskStatusEntry[]): void {
    const currentCompletedIds = new Set(
      tasks.filter((t) => t.status === "completed").map((t) => t.id),
    );
    const now = Date.now();

    if (!this.snapshotSeeded) {
      this.snapshotSeeded = true;
    } else {
      for (const id of currentCompletedIds) {
        if (!this.previousCompletedIds.has(id)) {
          this.completionTimestamps.set(id, now);
        }
      }
    }

    // Drop timestamps for tasks that left the completed bucket.
    for (const id of Array.from(this.completionTimestamps.keys())) {
      if (!currentCompletedIds.has(id)) {
        this.completionTimestamps.delete(id);
      }
    }

    this.previousCompletedIds = currentCompletedIds;
  }

  private getSummaryText(tasks: TaskStatusEntry[]): string {
    const completed = tasks.filter((t) => t.status === "completed").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const pending = tasks.length - completed - inProgress;

    const parts: string[] = [];
    if (completed > 0) parts.push(`${completed} done`);
    if (inProgress > 0) parts.push(`${inProgress} in progress`);
    if (pending > 0) parts.push(`${pending} open`);

    return parts.join(", ");
  }

  private updateHeader(tasks: TaskStatusEntry[]): void {
    const completed = tasks.filter((t) => t.status === "completed").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const anyRunning = inProgress > 0;
    const allDone = tasks.length > 0 && completed === tasks.length;

    if (!anyRunning) {
      this.spinnerFrame = 0;
    }

    const spinner = anyRunning
      ? this.theme.fg("accent", TASK_SPINNER_FRAMES[this.spinnerFrame])
      : allDone
        ? this.theme.fg("success", "✔")
        : this.theme.fg("dim", "◼");

    const summary = this.getSummaryText(tasks);
    this.headerText.setText(` ${spinner} ${this.theme.bold("Tasks")} ${this.theme.fg("dim", `(${summary})`)}`);
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % TASK_SPINNER_FRAMES.length;
      if (this.lastTasks.length > 0) {
        this.updateHeader(this.lastTasks);
        this.tui.requestRender();
      }
    }, 500);
  }

  private stopSpinner(): void {
    if (!this.spinnerTimer) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = undefined;
  }

  dispose(): void {
    this.stopSpinner();
  }

  /** Rebuild the panel from current task list. */
  update(tasks: TaskStatusEntry[]): void {
    this.lastTasks = tasks;
    this.updateCompletionTimestamps(tasks);

    // Remove old task lines
    for (const line of this.taskLines) super.removeChild(line);
    this.taskLines = [];
    if (this.overflowLine) {
      super.removeChild(this.overflowLine);
      this.overflowLine = undefined;
    }

    if (tasks.length === 0) {
      this.stopSpinner();
      this.headerText.setText("");
      return;
    }

    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const anyRunning = inProgress > 0;

    if (anyRunning) {
      this.startSpinner();
    } else {
      this.stopSpinner();
    }

    // Header — summary line like CC: "{total} tasks ({completed} done, ...)"
    this.updateHeader(tasks);

    // Compute max visible based on terminal height
    const rows = this.tui.terminal?.rows ?? 24;
    const maxVisible = Math.min(MAX_VISIBLE_TASKS, Math.max(MIN_VISIBLE_TASKS, rows - 14));

    // Prioritize: in_progress → pending → recent completed → older completed
    const sorted = this.prioritizeTasks(tasks);
    const visibleTasks = sorted.slice(0, maxVisible);
    const hiddenCount = tasks.length - maxVisible;

    const width = this.tui.terminal?.columns ?? 80;
    const maxSubjectWidth = Math.max(width - 10, 20);

    for (const task of visibleTasks) {
      let icon: string;
      let subjectStyle: (s: string) => string;

      if (task.status === "completed") {
        icon = this.theme.fg("success", "✔");
        // Completed: dim + strikethrough so the user can see it finished
        // without it competing with active work for attention.
        subjectStyle = (s: string) =>
          this.theme.fg("dim", this.theme.strikethrough(s));
      } else if (task.status === "in_progress") {
        icon = this.theme.fg("accent", "◼");
        // In-progress: bold
        subjectStyle = (s: string) => this.theme.bold(s);
      } else {
        icon = this.theme.fg("dim", "◻");
        // Pending: normal dim
        subjectStyle = (s: string) => this.theme.fg("dim", s);
      }

      // Use activeForm for in-progress tasks if available
      const displayText = task.status === "in_progress" && task.activeForm
        ? task.activeForm
        : task.subject;
      const truncated = truncateToWidth(displayText, maxSubjectWidth, "…");

      let lineText = `  ${icon} ${subjectStyle(truncated)}`;

      // Show blocked notice
      if (task.blockedBy && task.blockedBy.length > 0 && task.status !== "completed") {
        const blockedIds = task.blockedBy.map((id) => `#${id}`).join(", ");
        lineText += this.theme.fg("dim", ` ⎿ blocked by ${blockedIds}`);
      }

      const line = new Text(lineText, 0, 0);
      this.taskLines.push(line);
      this.addChild(line);
    }

    if (hiddenCount > 0) {
      // Breakdown of hidden tasks
      const hidden = tasks.slice(maxVisible);
      const hiddenInProgress = hidden.filter((t) => t.status === "in_progress").length;
      const hiddenPending = hidden.filter((t) => t.status === "pending").length;
      const hiddenCompleted = hidden.filter((t) => t.status === "completed").length;
      const parts: string[] = [];
      if (hiddenInProgress > 0) parts.push(`${hiddenInProgress} in progress`);
      if (hiddenPending > 0) parts.push(`${hiddenPending} pending`);
      if (hiddenCompleted > 0) parts.push(`${hiddenCompleted} completed`);
      this.overflowLine = new Text(
        this.theme.fg("dim", `  … +${hiddenCount} ${parts.join(", ")}`),
        0, 0,
      );
      this.addChild(this.overflowLine);
    }
  }

  /**
   * Prioritize tasks for display:
   * 1. in_progress (most important — user needs to see what's happening)
   * 2. pending (what's next)
   * 3. completed, split into:
   *    3a. recently completed (within RECENT_COMPLETED_TTL_MS) — promoted
   *    3b. older completed
   * Within each bucket, stable id order.
   */
  private prioritizeTasks(tasks: TaskStatusEntry[]): TaskStatusEntry[] {
    const inProgress = tasks
      .filter((t) => t.status === "in_progress")
      .sort((a, b) => a.id.localeCompare(b.id));
    const pending = tasks
      .filter((t) => t.status === "pending")
      .sort((a, b) => a.id.localeCompare(b.id));
    const now = Date.now();
    const completed = tasks.filter((t) => t.status === "completed");
    const recentCompleted = completed
      .filter((t) => {
        const ts = this.completionTimestamps.get(t.id);
        return ts !== undefined && now - ts < RECENT_COMPLETED_TTL_MS;
      })
      .sort((a, b) => {
        const aTs = this.completionTimestamps.get(a.id) ?? 0;
        const bTs = this.completionTimestamps.get(b.id) ?? 0;
        // Most recent first
        if (aTs !== bTs) return bTs - aTs;
        return a.id.localeCompare(b.id);
      });
    const olderCompleted = completed
      .filter((t) => {
        const ts = this.completionTimestamps.get(t.id);
        return ts === undefined || now - ts >= RECENT_COMPLETED_TTL_MS;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    return [...inProgress, ...pending, ...recentCompleted, ...olderCompleted];
  }

  /** Get the last known tasks. */
  getLastTasks(): TaskStatusEntry[] {
    return this.lastTasks;
  }
}
