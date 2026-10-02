/**
 * [WHO]: SessionMessageQueue owns pending UI text and next-turn custom context
 * [FROM]: CustomMessage type only; no runtime host dependency
 * [TO]: AgentSession delivery, cancellation and lifecycle adapters
 * [HERE]: core/runtime/session-message-queue.ts - session input queue state
 */
import type { CustomMessage } from "../messages.js";

export class SessionMessageQueue {
  private steeringTexts: string[] = [];
  private followUpTexts: string[] = [];
  private nextTurnMessages: CustomMessage[] = [];

  get steering(): readonly string[] { return this.steeringTexts; }
  get followUp(): readonly string[] { return this.followUpTexts; }
  get pendingCount(): number { return this.steeringTexts.length + this.followUpTexts.length; }

  enqueue(mode: "steer" | "followUp", text: string): void {
    (mode === "steer" ? this.steeringTexts : this.followUpTexts).push(text);
  }

  delivered(text: string): void {
    if (!text) return;
    for (const queue of [this.steeringTexts, this.followUpTexts]) {
      const index = queue.indexOf(text);
      if (index !== -1) { queue.splice(index, 1); return; }
    }
  }

  clear(): { steering: string[]; followUp: string[] } {
    const pending = { steering: [...this.steeringTexts], followUp: [...this.followUpTexts] };
    this.steeringTexts = [];
    this.followUpTexts = [];
    return pending;
  }

  clearFollowUp(matches?: (text: string) => boolean): void {
    this.followUpTexts = matches ? this.followUpTexts.filter(text => !matches(text)) : [];
  }

  nextTurn(message: CustomMessage): void { this.nextTurnMessages.push(message); }

  drainNextTurn(): CustomMessage[] {
    const messages = this.nextTurnMessages;
    this.nextTurnMessages = [];
    return messages;
  }
}
