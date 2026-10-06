/**
 * [WHO]: UpdateProgressComponent — estimated install progress capped at 90 until exit
 * [FROM]: Depends on @catui/tui width helpers and interactive theme
 * [TO]: Consumed by controllers/self-update-controller.ts
 * [HERE]: modes/interactive/components/update-progress.ts — update display with owned timer
 */
import { type Component, truncateToWidth } from "@catui/tui";
import { theme } from "../theme/theme.js";

export class UpdateProgressComponent implements Component {
  private readonly started = Date.now();
  private finishedAt: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private state: "installing" | "complete" | "failed" = "installing";

  constructor(private readonly from: string, private readonly to: string, requestRender: () => void) {
    this.timer = setInterval(requestRender, 250);
    this.timer.unref();
  }

  finish(success: boolean): void {
    this.finishedAt = Date.now();
    this.state = success ? "complete" : "failed";
    this.dispose();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  invalidate(): void { /* Rendering is computed from the current theme and time. */ }

  render(width: number): string[] {
    const elapsed = Math.max(0, (this.finishedAt ?? Date.now()) - this.started);
    const percent = this.state === "complete" ? 100 : Math.min(90, Math.round(90 * (1 - (1 - Math.min(elapsed / 20000, 1)) ** 2)));
    const cells = Math.min(48, Math.max(1, width - 20));
    const filled = Math.round(cells * percent / 100);
    const role = this.state === "failed" ? "error" : this.state === "complete" ? "success" : "accent";
    const title = this.state === "failed" ? "× Update failed" : this.state === "complete" ? "☻ Update installed" : "◌ Installing update";
    const bar = theme.fg(this.state === "failed" ? "error" : "success", "▮".repeat(filled)) + theme.fg("dim", "▯".repeat(cells - filled));
    const lines = [theme.fg(role, `  ${title}`), theme.fg("dim", `  v${this.from} → v${this.to}`), "",
      `  ${bar}  ${theme.fg("dim", `${percent}%  ${Math.floor(elapsed / 1000)}s`)}`];
    if (this.state === "installing") lines.push("", theme.fg("dim", "  Estimated progress · waits at 90% until installation finishes."));
    return lines.map(line => truncateToWidth(line, width));
  }
}
