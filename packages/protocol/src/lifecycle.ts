/**
 * [WHO]: Provides ExtensionAPI, ExtensionContext, ExtensionFactory, ExtensionUi,
 *        SessionManagerContract — the extension lifecycle protocol
 * [FROM]: Depends on ./commands, ./hooks, and ./tools for registration contracts
 * [TO]: Consumed by packages/mem-core (extension adapter) and third-party extensions; the host's
 *       richer ExtensionContext/ExtensionAPI satisfy these structurally (extensions load dynamically)
 * [HERE]: packages/protocol/src/lifecycle.ts - the stable extension entry contract
 *
 * Scope note: event payloads are intentionally loose (HookHandler's event is `any`) this round;
 * per-event typed payloads remain host-owned. This file carries only the surface that
 * lets a host-agnostic extension (e.g. mem-core) compile against the SDK instead of the host package.
 */

import type { TSchema } from "@sinclair/typebox";
import type { ExtensionCommand } from "./commands.js";
import type { HookEventName, HookHandler } from "./hooks.js";
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
  on(event: HookEventName, handler: HookHandler<ExtensionContext>): void;
  /** Register a slash command. */
  registerCommand(name: string, command: ExtensionCommand<ExtensionContext>): void;
  /** Register a model-facing tool. Generic so each call infers its own parameter schema. */
  registerTool<TParams extends TSchema = TSchema, TDetails = unknown>(tool: ToolContract<TParams, TDetails>): void;
}

/** An extension's default export: receives the host API and wires up hooks/commands/tools. */
export type ExtensionFactory = (api: ExtensionAPI) => void;
