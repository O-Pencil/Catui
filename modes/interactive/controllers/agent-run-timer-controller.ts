/**
 * [WHO]: Provides AgentRunTimerController + AgentRunTimerContext — working-message
 *        rotation (cat messages), elapsed formatting, agent-run interval timer
 * [FROM]: Depends on injected host capability closures + CatuiLoader cast;
 *         no InteractiveMode reference
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held lazily as `this.agentRunTimer`
 *       behind thin delegators: formatElapsedSeconds / getNextCatMessage / updateWorkingMessage /
 *       stopAgentRunTimer / startAgentRunTimer)
 * [HERE]: modes/interactive/controllers/agent-run-timer-controller.ts — P7 C-3d (extracted from
 *         InteractiveMode; behavior-preserving move)
 */
import { CatuiLoader } from "../components/catui-loader.js";
import { appKey } from "../components/keybinding-hints.js";
import type { KeybindingsManager } from "../../../core/platform/keybindings.js";
import type { InteractiveState } from "../state/interactive-state.js";

/** Host capabilities needed by the agent-run timer controller. */
export interface AgentRunTimerContext {
  readonly state: InteractiveState;
  readonly keybindings: KeybindingsManager;
}

export class AgentRunTimerController {
  private readonly catWorkingMessages = [
    "Purring…",
    "Meowing…",
    "Napping…",
    "Stretching…",
    "Zooming…",
    "Sneaking…",
    "Pouncing…",
    "Scratching…",
    "Yawning…",
    "Blinking…",
    "Kneading…",
    "Crouching…",
    "Spinning…",
    "Twitching…",
    "Hiding…",
  ];
  private catMessageIndex = Math.floor(Math.random() * 15);
  private catMessageLastSwitch = 0;

  constructor(private readonly ctx: AgentRunTimerContext) {}

  formatElapsedSeconds(ms: number): string {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  }

  getNextCatMessage(): string {
    const now = Date.now();
    if (now - this.catMessageLastSwitch >= 3000) {
      this.catMessageIndex++;
      this.catMessageLastSwitch = now;
    }
    return this.catWorkingMessages[this.catMessageIndex % this.catWorkingMessages.length]!;
  }

  private buildWorkingMessage(): { base: string; suffix: string } {
    const base = this.ctx.state.workingMessageOverride || this.getNextCatMessage();
    const interruptHint = `${appKey(this.ctx.keybindings, "interrupt")} to interrupt`;
    const elapsed =
      this.ctx.state.agentRunStartMs !== undefined
        ? this.formatElapsedSeconds(Date.now() - this.ctx.state.agentRunStartMs)
        : undefined;
    const suffix = elapsed
      ? `(${elapsed}, ${interruptHint})`
      : `(${interruptHint})`;
    return { base, suffix };
  }

  updateWorkingMessage(options?: { resetStallTimer?: boolean }): void {
    if (!this.ctx.state.loadingAnimation) return;
    const { base, suffix } = this.buildWorkingMessage();
    (this.ctx.state.loadingAnimation as CatuiLoader).setMessage(
      base,
      { ...options, suffix },
    );
  }

  stopAgentRunTimer(): void {
    if (this.ctx.state.agentRunTimer) {
      clearInterval(this.ctx.state.agentRunTimer);
      this.ctx.state.agentRunTimer = undefined;
    }
  }

  startAgentRunTimer(): void {
    this.stopAgentRunTimer();
    this.ctx.state.agentRunStartMs = Date.now();
    this.ctx.state.agentRunTimer = setInterval(() => {
      if (!this.ctx.state.loadingAnimation || this.ctx.state.agentRunStartMs === undefined) {
        this.stopAgentRunTimer();
        return;
      }
      // Keep stall detection meaningful while still showing live elapsed time.
      this.updateWorkingMessage({ resetStallTimer: false });
    }, 100);
  }
}
