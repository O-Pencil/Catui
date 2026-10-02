/**
 * [WHO]: BridgeOperations tracks asynchronous supervised command and decision receipts
 * [FROM]: Extension API supervision capability, Node crypto and bridge input contracts
 * [TO]: BridgeController; HTTP calls never wait for an interactive decision
 * [HERE]: extensions/optional/session-bridge/control/operations.ts - bounded operation lifecycle
 */
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "../../../../core/extensions-host/types.js";
import { BridgeError } from "../contracts.js";

type Supervisor = NonNullable<ExtensionAPI["supervision"]>;
type Operation = { requestId: string; status: "running" | "handler_finished" | "failed"; error?: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class BridgeOperations {
  private operations = new Map<string, { fingerprint: string; receipt: Operation }>();
  constructor(private readonly supervisor: Supervisor, private readonly assertCurrent: () => void) {}
  async progress() {
    const state = await this.supervisor.snapshot();
    this.assertCurrent();
    return { ...state, revision: digest(state.states), operations: [...this.operations.values()].map(x => ({ ...x.receipt })),
      completionMeaning: "handler_finished means the command/answer handler returned; inspect feature state and test/artifact evidence before declaring task success" };
  }
  catalog() { return this.supervisor.catalog(); }
  submit(input: Record<string, unknown>): Operation {
    const { requestId } = input;
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(requestId)) throw new BridgeError(400, "Invalid requestId");
    const fingerprint = digest(input);
    const previous = this.operations.get(requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new BridgeError(409, "requestId already used for different operation");
      return { ...previous.receipt };
    }
    if (this.operations.size >= 128) throw new BridgeError(429, "Operation receipt limit reached; explicitly reconnect");
    if ([...this.operations.values()].filter(x => x.receipt.status === "running").length >= 8) throw new BridgeError(429, "Too many running operations");
    if (input.action === "execute") {
      if (typeof input.name !== "string" || typeof input.args !== "string" || input.args.length > 12000 || typeof input.revision !== "string") throw new BridgeError(400, "Expected command name, args and fresh state revision");
    } else if (input.action !== "answer" || typeof input.decisionId !== "string") throw new BridgeError(400, "Invalid decision action");
    const receipt: Operation = { requestId, status: "running" };
    this.operations.set(requestId, { fingerprint, receipt });
    void this.perform(input).then(() => { receipt.status = "handler_finished"; }, error => {
      receipt.status = "failed";
      receipt.error = error instanceof Error ? error.message.slice(0, 1000) : "Operation failed";
    });
    return { ...receipt };
  }
  private async perform(input: Record<string, unknown>): Promise<void> {
    this.assertCurrent();
    if (input.action === "answer") {
      this.supervisor.answer(input.decisionId as string, input.value);
      return;
    }
    const state = await this.supervisor.snapshot();
    this.assertCurrent();
    if (digest(state.states) !== input.revision) throw new Error("Feature state changed; refresh progress before retrying with a new request ID");
    await this.supervisor.execute(input.name as string, input.args as string);
  }
}
