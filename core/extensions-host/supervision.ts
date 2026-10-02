/**
 * [WHO]: SessionSupervision registers owner snapshots and delegated decision requests
 * [FROM]: Node crypto and extension host context/command contracts (type-only)
 * [TO]: Extension loader/runner, feature owners and authorized session transports
 * [HERE]: core/extensions-host/supervision.ts - session-local control primitive
 */
import { createHash, randomUUID } from "node:crypto";
import type { ExtensionCommandContext, ExtensionContext, RegisteredCommand } from "./types.js";

export interface CommandSupervision {
  usage: string;
  effect: string;
  busyUsage?: string;
  /** Reject unsafe argument variants before invoking the original handler. */
  validate?: (args: string) => void;
  allowBusy?: (args: string) => boolean;
}
export interface DecisionRequest {
  id: string;
  kind: "select" | "confirm" | "input";
  title: string;
  detail?: string;
  options?: string[];
}
interface PendingDecision {
  request: DecisionRequest;
  resolve: (value: string | boolean) => void;
  reject: (error: Error) => void;
}
interface Host {
  localCommands?(): Array<{ name: string; description?: string }>;
  context(): ExtensionCommandContext;
  commands(): RegisteredCommand[];
  invoke(name: string, args: string, ctx: ExtensionCommandContext): Promise<void>;
}

/** Generic host mechanism; it has no knowledge of individual feature states. */
export class SessionSupervision {
  private host?: Host;
  private sessionId?: string;
  private providers = new Map<string, (ctx: ExtensionContext) => unknown | Promise<unknown>>();
  private decisions = new Map<string, PendingDecision>();
  private executing = false;
  private notifications: Array<{ message: string; level: string }> = [];
  notify(message: string, level: string): void {
    if (!this.active) return;
    this.notifications.push({ message: message.slice(0, 4000), level });
    this.notifications = this.notifications.slice(-20);
  }
  get active(): boolean { return this.sessionId !== undefined; }
  bind(host: Host): void { this.host = host; }
  registerSnapshot(name: string, read: (ctx: ExtensionContext) => unknown | Promise<unknown>): void {
    if (this.providers.has(name)) throw new Error(`Duplicate supervision snapshot: ${name}`);
    this.providers.set(name, read);
  }
  start(sessionId: string): void {
    if (this.active) throw new Error("A supervisor is already connected");
    this.sessionId = sessionId;
    this.notifications = [];
  }
  stop(): void {
    this.sessionId = undefined;
    this.cancelDecisions("Supervision disconnected; no decision was approved");
  }
  cancelDecisions(reason: string): void {
    for (const decision of this.decisions.values()) decision.reject(new Error(reason));
    this.decisions.clear();
  }
  private context(): ExtensionCommandContext {
    const ctx = this.host?.context();
    if (!ctx || !this.sessionId || ctx.sessionManager.getSessionId() !== this.sessionId) {
      throw new Error("Supervision session is no longer active");
    }
    return ctx;
  }
  catalog() {
    const ctx = this.context();
    const commands = this.host!.commands();
    const names = new Set(commands.map(c => c.name));
    return [...commands.map(command => ({
      name: command.name, description: command.description ?? "", source: "extension",
      remote: !!command.supervision, usage: command.supervision?.usage,
      effect: command.supervision?.effect,
      busyUsage: command.supervision?.busyUsage ?? "No remote invocation while busy",
      availability: command.supervision ? (ctx.isIdle() ? "idle; arguments validated on invocation" : "busy; only declared busy-safe arguments") : "local only; owner has not enabled remote dispatch",
    })), ...(this.host!.localCommands?.() ?? []).filter(c => !names.has(c.name)).map(c => ({
      ...c, source: "builtin", remote: false, availability: "local only; no remote adapter",
    }))];
  }
  async snapshot() {
    const ctx = this.context();
    const states: Record<string, unknown> = {};
    for (const [name, read] of this.providers) {
      try {
        const value = await read(ctx);
        const encoded = JSON.stringify(value);
        states[name] = encoded && encoded.length > 100000
          ? { unavailable: true, revision: createHash("sha256").update(encoded).digest("hex"), reason: "Snapshot exceeds 100000 characters; inspect the artifact locally" }
          : value;
      }
      catch { states[name] = { unavailable: true }; }
    }
    this.context();
    return { states, pendingDecisions: [...this.decisions.values()].map(x => x.request),
      commandRunning: this.executing, notifications: [...this.notifications] };
  }
  async execute(name: string, args: string): Promise<void> {
    const ctx = this.context();
    const command = this.host!.commands().find(c => c.name === name);
    if (!command?.supervision) throw new Error("Command is not enabled for remote execution; inspect capabilities");
    if (this.executing) throw new Error("Another supervised command is still running");
    command.supervision.validate?.(args);
    if (!ctx.isIdle() && !command.supervision.allowBusy?.(args)) throw new Error("Command requires an idle agent");
    this.executing = true;
    try { await this.host!.invoke(name, args, ctx); }
    finally { this.executing = false; }
  }
  request(input: Omit<DecisionRequest, "id">, signal?: AbortSignal): Promise<string | boolean> {
    this.context();
    if (signal?.aborted) return Promise.reject(new Error("Decision cancelled"));
    if (this.decisions.size >= 8) return Promise.reject(new Error("Too many pending decisions"));
    if (JSON.stringify(input).length > 100000) return Promise.reject(new Error("Decision content exceeds supervision limit"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const clean = () => { this.decisions.delete(id); signal?.removeEventListener("abort", abort); };
      const abort = () => { clean(); reject(new Error("Decision cancelled")); };
      this.decisions.set(id, { request: { ...input, id },
        resolve: value => { clean(); resolve(value); }, reject: error => { clean(); reject(error); } });
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  answer(id: string, value: unknown): void {
    this.context();
    const pending = this.decisions.get(id);
    if (!pending) throw new Error("Decision is stale or already answered");
    const request = pending.request;
    if (request.kind === "confirm" ? typeof value !== "boolean" : typeof value !== "string" || value.length > 12000) {
      throw new Error("Invalid decision answer");
    }
    if (request.kind === "select" && !request.options?.includes(value as string)) throw new Error("Choose an offered option");
    pending.resolve(value as string | boolean);
  }
}
