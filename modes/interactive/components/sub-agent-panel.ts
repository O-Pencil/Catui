/**
 * [WHO]: SubAgentPanelComponent - renders grouped sub-agent progress with tree layout
 * [FROM]: Depends on @catui/tui, ../state/interactive-state (SubAgentState)
 * [TO]: Consumed by StreamRenderController
 * [HERE]: modes/interactive/components/sub-agent-panel.ts - CC-style multi-agent TUI panel
 */

import { Container, Spacer, Text, type TUI } from "@catui/tui";
import type { Theme } from "../theme/theme.js";
import type { SubAgentState } from "../state/interactive-state.js";

const BRAILLE_FRAMES = ["♫", "♬"];
const CONDENSED_ROW_THRESHOLD = 16;

export class SubAgentPanelComponent extends Container {
  private tui: TUI;
  private theme: Theme;
  private spinnerFrame = 0;
  private headerText: Text;
  private agentLines: Text[] = [];
  private statusLines: Text[] = [];
  private isCondensed = false;
  private condensedText: Text | undefined;

  constructor(tui: TUI, theme: Theme) {
    super();
    this.tui = tui;
    this.theme = theme;
    this.headerText = new Text("", 0, 0);
    this.addChild(new Spacer(1));
    this.addChild(this.headerText);
  }

  /** Rebuild the entire panel from current sub-agent states. */
  update(agents: Map<string, SubAgentState>): void {
    const list = Array.from(agents.values());
    const anyRunning = list.some((a) => !a.isResolved);
    const anyError = list.some((a) => a.isError);

    // Advance spinner
    if (anyRunning) {
      this.spinnerFrame = (this.spinnerFrame + 1) % BRAILLE_FRAMES.length;
    }
    const spinner = anyRunning
      ? this.theme.fg("accent", BRAILLE_FRAMES[this.spinnerFrame])
      : anyError
        ? this.theme.fg("error", "✖")
        : this.theme.fg("success", "✔");

    // Check terminal size for condensed mode
    const rows = this.tui.terminal?.rows ?? 24;
    const estimatedLines = 1 + list.length * 2; // header + 2 lines per agent
    this.isCondensed = rows < CONDENSED_ROW_THRESHOLD || (rows - estimatedLines < 4);

    // Remove old per-agent children
    for (const line of this.agentLines) super.removeChild(line);
    for (const line of this.statusLines) super.removeChild(line);
    if (this.condensedText) {
      super.removeChild(this.condensedText);
      this.condensedText = undefined;
    }
    this.agentLines = [];
    this.statusLines = [];

    if (this.isCondensed) {
      this.renderCondensed(list, spinner, anyRunning);
    } else {
      this.renderFull(list, spinner, anyRunning);
    }
  }

  private renderFull(list: SubAgentState[], spinner: string, anyRunning: boolean): void {
    const totalTools = list.reduce((s, a) => s + a.toolUseCount, 0);
    const resolvedCount = list.filter((a) => a.isResolved).length;

    // Header
    const statusText = anyRunning
      ? `Running ${list.length} agent${list.length > 1 ? "s" : ""}…`
      : `${resolvedCount} agent${resolvedCount > 1 ? "s" : ""} finished`;
    this.headerText.setText(` ${spinner} ${statusText}  ${this.theme.fg("dim", "·")} ${totalTools} tool use${totalTools !== 1 ? "s" : ""}`);

    // Per-agent lines
    for (let i = 0; i < list.length; i++) {
      const agent = list[i];
      const isLast = i === list.length - 1;
      const treeChar = isLast ? "└─" : "├─";
      const treeCont = isLast ? "   " : "│  ";

      // Row 1: agent identity + stats
      const typeLabel = this.theme.fg("accent", agent.agentType);
      const descLabel = agent.description
        ? ` ${this.theme.fg("dim", `(${agent.description})`)}`
        : "";
      const toolsLabel = agent.toolUseCount > 0
        ? ` ${this.theme.fg("dim", "·")} ${agent.toolUseCount} tool use${agent.toolUseCount !== 1 ? "s" : ""}`
        : "";
      const dim = !agent.isResolved ? (t: string) => this.theme.fg("dim", t) : (t: string) => t;
      const line1 = new Text(
        dim(` ${treeChar} ${typeLabel}${descLabel}${toolsLabel}`),
        0, 0,
      );
      this.agentLines.push(line1);
      this.addChild(line1);

      // Row 2: status line
      let statusStr: string;
      if (!agent.isResolved) {
        statusStr = agent.lastToolName
          ? this.theme.fg("dim", agent.lastToolName)
          : this.theme.fg("dim", "Initializing…");
      } else if (agent.isError) {
        statusStr = this.theme.fg("error", "Error");
      } else {
        statusStr = this.theme.fg("success", "Done");
      }
      const line2 = new Text(
        ` ${treeCont}  ⎿  ${statusStr}`,
        0, 0,
      );
      this.statusLines.push(line2);
      this.addChild(line2);
    }
  }

  private renderCondensed(list: SubAgentState[], spinner: string, anyRunning: boolean): void {
    const totalTools = list.reduce((s, a) => s + a.toolUseCount, 0);
    const statusText = anyRunning ? "In progress…" : "Done";
    const text = ` ${spinner} ${statusText} ${this.theme.fg("dim", "·")} ${totalTools} tool use${totalTools !== 1 ? "s" : ""}`;
    this.condensedText = new Text(text, 0, 0);
    this.addChild(this.condensedText);

    // Hide header in condensed mode
    this.headerText.setText("");
  }
}
