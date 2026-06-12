/**
 * [WHO]: Provides HookEventName and HookHandler — public lifecycle hook vocabulary
 * [FROM]: No dependencies — context is generic so lifecycle/host can supply their own context type
 * [TO]: Consumed by protocol ExtensionAPI and host extension event overloads
 * [HERE]: packages/protocol/src/hooks.ts - stable hook-name contract without payload freezing
 *
 * Payload types intentionally stay out of protocol for now. The host keeps rich typed
 * overloads; protocol only publishes the event-name vocabulary that external extensions
 * may subscribe to.
 */

/** Lifecycle hook names an extension may subscribe to via `api.on(...)`. */
export type HookEventName =
  | "resources_discover"
  | "session_start"
  | "session_ready"
  | "session_before_switch"
  | "session_switch"
  | "session_before_fork"
  | "session_fork"
  | "session_before_compact"
  | "session_compact"
  | "session_shutdown"
  | "session_before_tree"
  | "session_tree"
  | "context"
  | "before_agent_start"
  | "agent_start"
  | "agent_result"
  | "agent_abort"
  | "agent_end"
  | "turn_start"
  | "turn_end"
  | "message_start"
  | "message_update"
  | "message_end"
  | "tool_execution_start"
  | "tool_execution_update"
  | "tool_execution_end"
  | "model_select"
  | "tool_call"
  | "tool_result"
  | "user_bash"
  | "input";

/**
 * Hook callback. The event payload is intentionally `any` this round so host-agnostic
 * extensions compile without per-event payload types; typed payloads remain host-owned.
 */
// biome-ignore lint/suspicious/noExplicitAny: payload typing is intentionally host-owned for now.
export type HookHandler<TContext = unknown> = (
  event: any,
  ctx: TContext,
) => void | Promise<void>;
