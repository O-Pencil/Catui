/**
 * [WHO]: Provides ExtensionAPI, ExtensionContext, ExtensionFactory, ExtensionUi,
 *        SessionManagerContract, HookEventName, HookHandler — the extension lifecycle protocol
 * [FROM]: Depends on ./commands and ./tools for command/tool registration contracts
 * [TO]: Consumed by packages/mem-core (extension adapter) and third-party extensions; the host's
 *       richer ExtensionContext/ExtensionAPI satisfy these structurally (extensions load dynamically)
 * [HERE]: packages/protocol/src/lifecycle.ts - the stable extension entry contract
 *
 * Scope note: event payloads are intentionally loose (HookHandler's event is `unknown`) this round;
 * per-event typed payloads land in hooks.ts during P3.1. This file carries only the surface that
 * lets a host-agnostic extension (e.g. mem-core) compile against the SDK instead of the host package.
 */

import type { TSchema } from "@sinclair/typebox";
import type { ExtensionCommand } from "./commands.js";
import type { ToolContract } from "./tools.js";

/** Read-only session info an extension may consult via `ctx.sessionManager`. */
export interface SessionManagerContract {
  /** Absolute path to the active session's JSONL file, if any. */
  getSessionFile(): string | undefined;
  /** Count sessions under `cwd` whose file mtime is newer than `sinceMs`. */
  countTouchedSince(
    cwd: string,
    sinceMs: number,
    options?: { sessionDir?: string; excludeBasename?: string; concurrency?: number },
  ): Promise<number>;
}

/** UI affordances available to an extension (no-ops / undefined-safe when `hasUI` is false). */
export interface ExtensionUi {
  /** Surface a transient message to the user. */
  notify(message: string, type?: "info" | "warning" | "error"): void;
  /** Set (or clear with `undefined`) a keyed status line owned by this extension. */
  setStatus(key: string, text: string | undefined): void;
}

/** Runtime context handed to extension hooks, commands, and tools. */
export interface ExtensionContext {
  /** Current working directory. */
  cwd: string;
  /** Whether an interactive UI is attached (false in print/RPC mode). */
  hasUI: boolean;
  /** Read-only session manager. */
  sessionManager: SessionManagerContract;
  /** User-facing UI affordances. */
  ui: ExtensionUi;
}

/** Lifecycle hook names an extension may subscribe to via `api.on(...)`. */
export type HookEventName =
  | "session_start"
  | "session_ready"
  | "session_shutdown"
  | "before_agent_start"
  | "agent_start"
  | "agent_end"
  | "agent_result"
  | "turn_start"
  | "turn_end"
  | "tool_execution_start"
  | "tool_execution_end";

/**
 * Hook callback. The event payload is intentionally `any` this round so host-agnostic
 * extensions compile without per-event payload types; typed payloads land in hooks.ts (P3.1).
 */
// biome-ignore lint/suspicious/noExplicitAny: payload typing deferred to P3.1 hooks.ts
export type HookHandler = (event: any, ctx: ExtensionContext) => void | Promise<void>;

/** A runtime flag an extension declares (parsed from CLI/config by the host). */
export interface ExtensionFlag {
  name: string;
  description?: string;
  type: "boolean" | "string";
  default?: boolean | string;
  /** Absolute path of the declaring extension (filled by the host loader). */
  extensionPath: string;
}

/** The registration surface a host passes to an extension factory. */
export interface ExtensionAPI {
  /** Subscribe to a lifecycle hook. */
  on(event: HookEventName, handler: HookHandler): void;
  /** Register a slash command. */
  registerCommand(name: string, command: ExtensionCommand<ExtensionContext>): void;
  /** Register a model-facing tool. Generic so each call infers its own parameter schema. */
  registerTool<TParams extends TSchema = TSchema, TDetails = unknown>(tool: ToolContract<TParams, TDetails>): void;
}

/** An extension's default export: receives the host API and wires up hooks/commands/tools. */
export type ExtensionFactory = (api: ExtensionAPI) => void;
