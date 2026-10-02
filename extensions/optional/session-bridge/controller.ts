/**
 * [WHO]: BridgeController binds requests and receipts to one live session and run
 * [FROM]: Node crypto plus private bridge capabilities and limits
 * [TO]: HTTP server dispatch and extension lifecycle hooks
 * [HERE]: extensions/optional/session-bridge/controller.ts - same-session authority
 */
import { createHash, randomUUID } from "node:crypto";
import { BridgeError, MAX_MESSAGE_CHARS, MAX_RECEIPTS, object, type BridgeHost, type Receipt } from "./contracts.js";

export class BridgeController {
  readonly sessionId: string;
  private active = true;
  private runId: string | null;
  private receipts = new Map<string, { fingerprint: string; receipt: Receipt; text: string }>();
  private recent: Array<{ at: string; event: string; text?: string }> = [];
  constructor(private readonly host: BridgeHost) {
    this.sessionId = host.sessionId();
    this.runId = host.isIdle() ? null : randomUUID();
  }
  revoke(): void { this.active = false; }
  private assertCurrent(): void {
    if (!this.active || this.host.sessionId() !== this.sessionId) throw new BridgeError(410, "Bridge session is no longer active; start a new bridge explicitly");
  }
  event(event: string, text?: string): void {
    if (event === "agent_start") this.runId = randomUUID();
    if (event === "agent_end" || event === "agent_abort") this.runId = null;
    this.recent.push({ at: new Date().toISOString(), event, ...(text ? { text: text.slice(0, 4000) } : {}) });
    this.recent = this.recent.slice(-20);
  }
  observe(text: string): void {
    for (const entry of this.receipts.values()) {
      if (text === entry.text && entry.receipt.status === "submitted") {
        entry.receipt.status = "observed";
        entry.receipt.observedAt = new Date().toISOString();
      }
    }
  }
  status(): object {
    this.assertCurrent();
    return { sessionId: this.sessionId, idle: this.host.isIdle(), pendingMessages: this.host.hasPendingMessages(),
      runId: this.host.isIdle() ? null : this.runId, recent: [...this.recent],
      receipts: [...this.receipts.values()].map(({ receipt }) => ({ ...receipt })),
      receiptMeaning: "submitted means handed to the host, not guaranteed delivery; observed means a user-message event was seen, not task completion" };
  }
  dispatch(value: unknown): object {
    this.assertCurrent();
    const input = object(value);
    if (input.sessionId !== this.sessionId) throw new BridgeError(409, "Session mismatch");
    if (input.action === "cancel") {
      if (typeof input.runId !== "string" || !input.runId || input.runId !== this.runId || this.host.isIdle()) {
        throw new BridgeError(409, "Run changed or is idle; refresh progress before cancellation");
      }
      this.host.abort();
      return { status: "cancellation_requested", runId: input.runId };
    }
    if (input.action !== "send") throw new BridgeError(400, "Unknown action");
    const { requestId, message, mode = "followUp" } = input;
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)) throw new BridgeError(400, "Invalid requestId");
    if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_CHARS) throw new BridgeError(400, "Message must contain 1-12000 characters");
    if (mode !== "followUp" && mode !== "steer") throw new BridgeError(400, "Invalid delivery mode");
    const fingerprint = createHash("sha256").update(JSON.stringify([message, mode])).digest("hex");
    const previous = this.receipts.get(requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new BridgeError(409, "requestId already used for different content");
      return { ...previous.receipt, duplicate: true };
    }
    if (this.receipts.size >= MAX_RECEIPTS) throw new BridgeError(429, "Receipt limit reached; explicitly restart the bridge before more messages");
    if ([...this.receipts.values()].filter(x => x.receipt.status === "submitted").length >= 8) throw new BridgeError(429, "Too many unobserved messages; inspect progress before sending more");
    const text = `[Delegated bridge message ${requestId}]\n${message}`;
    const receipt: Receipt = { requestId, mode, status: "submitted", submittedAt: new Date().toISOString() };
    this.receipts.set(requestId, { receipt, fingerprint, text });
    try { this.host.send(text, mode); } catch {
      receipt.status = "failed";
      throw new BridgeError(502, "Host rejected message submission; do not retry with a new ID without inspection");
    }
    return { ...receipt };
  }
}
