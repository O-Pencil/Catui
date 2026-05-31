/**
 * [WHO]: Provides ToolRuntime, ToolPermissions, ToolRuntimeDescriptor (S1 seam) + ToolResult, ToolContract
 * [FROM]: Depends on @sinclair/typebox (schema) and ./lifecycle (ExtensionContext, type-only)
 * [TO]: Consumed by the host ToolDefinition (adopts the S1 fields) and by extensions registering tools
 * [HERE]: packages/extension-sdk/src/tools.ts - tool runtime seam (S1) + the stable tool contract
 *
 * S1 seam (refactor-plan §接缝预留): a tool may optionally declare its execution runtime and
 * permission needs. Omitting both keeps today's behavior (local, host-policy). The host
 * ToolOrchestrator stays the single dispatch point; browser/remote/mcp runtimes are NOT
 * implemented this round — only the contract shape is reserved so adding them is additive.
 */

import type { Static, TSchema } from "@sinclair/typebox";
import type { ExtensionContext } from "./lifecycle.js";

/** Where a tool's execute() runs. Omitted ⇒ "local" (in the host process). */
export type ToolRuntime = "local" | "mcp" | "remote" | "browser";

/** Declarative permission requirements a tool may request; the host decides enforcement. */
export interface ToolPermissions {
  /** Filesystem paths the tool intends to read / write, if constrained. */
  filesystem?: { read?: string[]; write?: string[] };
  /** Whether the tool may spawn shell/processes. */
  process?: boolean;
  /** Network hosts the tool may reach, if constrained. */
  network?: string[];
}

/** S1 seam: optional runtime/permission descriptors a tool definition may carry. */
export interface ToolRuntimeDescriptor {
  /** Execution runtime. Omitted ⇒ "local". */
  runtime?: ToolRuntime;
  /** Declared permissions. Omitted ⇒ unconstrained (host policy applies). */
  permissions?: ToolPermissions;
}

/** A single content block a tool returns. */
export type ToolResultContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType?: string };

/** The result of executing a tool. */
export interface ToolResult<TDetails = unknown> {
  /** Model-facing content blocks. */
  content: ToolResultContent[];
  /** Structured details for custom rendering / downstream use. */
  details?: TDetails;
  /** Whether this result represents an error. */
  isError?: boolean;
}

/** Callback a tool may invoke to stream partial progress. */
export type ToolUpdateCallback<TDetails = unknown> = (details: TDetails) => void;

/**
 * The stable tool contract an extension registers. The host's richer ToolDefinition is a
 * superset (adds renderCall/renderResult and tighter agent-core result types); a contract
 * authored against this interface remains valid there because extensions load dynamically.
 */
export interface ToolContract<TParams extends TSchema = TSchema, TDetails = unknown> extends ToolRuntimeDescriptor {
  /** Tool name used in LLM tool calls. */
  name: string;
  /** Human-readable label for UI. */
  label?: string;
  /** Description for the model. */
  description: string;
  /** Parameter schema (TypeBox). */
  parameters: TParams;
  /** Alternative model-facing names accepted for compatibility. */
  aliases?: string[];
  /** Whether the tool can safely run alongside other concurrency-safe tools. */
  isConcurrencySafe?: boolean;
  /** Optional usage guidance injected into the system prompt. */
  guidance?: string;
  /** Execute the tool. Trailing parameters are optional for simple tools. */
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback<TDetails>,
    ctx?: ExtensionContext,
  ): Promise<ToolResult<TDetails>>;
}
