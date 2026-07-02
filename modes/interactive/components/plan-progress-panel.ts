/**
 * [WHO]: PlanProgressPanelComponent - renders plan execution progress with phase checkboxes
 * [FROM]: Depends on @catui/tui, ../state/interactive-state (PlanProgressState)
 * [TO]: Consumed by StreamRenderController
 * [HERE]: modes/interactive/components/plan-progress-panel.ts - CC-style plan execution TUI panel
 */

import { Container, Spacer, Text, type TUI } from "@catui/tui";
import type { Theme } from "../theme/theme.js";
import type { PlanProgressState } from "../state/interactive-state.js";

const BRAILLE_FRAMES = ["♫", "♬"];
const CONDENSED_ROW_THRESHOLD = 16;

export class PlanProgressPanelComponent extends Container {
  private tui: TUI;
  private theme: Theme;
  private spinnerFrame = 0;
  private headerText: Text;
  private phaseLines: Text[] = [];
  private isCondensed = false;
  private condensedText: Text | undefined;
  private startTime = 0;

  constructor(tui: TUI, theme: Theme) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.headerText = new Text("", 0, 0);
    this.addChild(new Spacer(1));
    this.addChild(this.headerText);
  }

  /** Rebuild the entire panel from current plan progress state. */
  update(state: PlanProgressState): void {
    this.startTime = state.startTime;
    const anyRunning = state.phases.some((p) => p.status === "in_progress");
    const allDone = state.phases.every((p) => p.status === "completed");

    // Advance spinner
    if (anyRunning) {
      this.spinnerFrame = (this.spinnerFrame + 1) % BRAILLE_FRAMES.length;
    }
    const spinner = anyRunning
      ? this.theme.fg("accent", BRAILLE_FRAMES[this.spinnerFrame])
      : allDone
        ? this.theme.fg("success", "✔")
        : this.theme.fg("dim", "◼");

    // Check terminal size for condensed mode
    const rows = this.tui.terminal?.rows ?? 24;
    const estimatedLines = 1 + state.phases.length; // header + phase lines
    this.isCondensed = rows < CONDENSED_ROW_THRESHOLD || (rows - estimatedLines < 4);

    // Remove old phase lines
    for (const line of this.phaseLines) super.removeChild(line);
    if (this.condensedText) {
      super.removeChild(this.condensedText);
      this.condensedText = undefined;
    }
    this.phaseLines = [];

    if (this.isCondensed) {
      this.renderCondensed(state, spinner, anyRunning);
    } else {
      this.renderFull(state, spinner, anyRunning);
    }
  }

  private renderFull(state: PlanProgressState, spinner: string, anyRunning: boolean): void {
    const elapsed = Date.now() - state.startTime;
    const elapsedStr = formatElapsed(elapsed);
    const tokenStr = state.tokenCount !== undefined
      ? ` ${this.theme.fg("dim", "\u00b7")} ${this.theme.fg("dim", formatTokenCount(state.tokenCount))}`
      : "";

    // Header
    const headerLabel = anyRunning
      ? "Planning\u2026"
      : state.phases.every((p) => p.status === "completed")
        ? "Plan complete"
        : "Planning paused";
    this.headerText.setText(
      ` ${spinner} ${headerLabel}  ${this.theme.fg("dim", `(${elapsedStr}${tokenStr})`)}`,
    );

    // Phase lines
    for (let i = 0; i < state.phases.length; i++) {
      const phase = state.phases[i];
      const icon = phase.status === "completed"
        ? this.theme.fg("success", "\u2714")
        : phase.status === "in_progress"
          ? this.theme.fg("accent", "\u25fc")
          : this.theme.fg("dim", "\u25fb");
      const label = phase.status === "completed"
        ? this.theme.fg("dim", phase.label)
        : phase.status === "in_progress"
          ? phase.label
          : this.theme.fg("dim", phase.label);
      const line = new Text(` \u23bf  ${icon} ${label}`, 0, 0);
      this.phaseLines.push(line);
      this.addChild(line);
    }
  }

  private renderCondensed(state: PlanProgressState, spinner: string, _anyRunning: boolean): void {
    const currentPhase = state.phases.find((p) => p.status === "in_progress")
      ?? state.phases.find((p) => p.status === "pending");
    const elapsed = Date.now() - state.startTime;
    const elapsedStr = formatElapsed(elapsed);
    const phaseLabel = currentPhase ? currentPhase.label : "Done";
    const text = ` ${spinner} ${phaseLabel}  ${this.theme.fg("dim", `(${elapsedStr})`)}`;
    this.condensedText = new Text(text, 0, 0);
    this.addChild(this.condensedText);

    // Hide header in condensed mode
    this.headerText.setText("");
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k tokens`;
  }
  return `${count} tokens`;
}
