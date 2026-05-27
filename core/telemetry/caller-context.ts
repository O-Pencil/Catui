/**
 * [WHO]: Provides ExtCallerContext interface, runWithExtCallerContext(), getExtCallerContext() — AsyncLocalStorage-backed caller-attribution bus
 * [FROM]: Depends on node:async_hooks (AsyncLocalStorage); no other internal deps to stay loadable from anywhere in the runtime
 * [TO]: runWithExtCallerContext is pushed by core/extensions/runner.ts at every command/hook dispatch boundary; getExtCallerContext is read by core/runtime/extension-core-bindings.ts when writing ext_llm_calls rows
 * [HERE]: core/telemetry/caller-context.ts - the only mechanism distinguishing "extension command path (user-initiated)" from "extension hook path (auto-fired)" when an LLM call eventually happens; if this bus is empty, the telemetry layer marks the call as is_user_initiated=false / extension_name="unknown"
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-async-frame metadata identifying which extension triggered the current
 * execution path and whether that path was initiated by a user action (slash
 * command) or by a hook auto-firing. Read by the LLM-call telemetry wrapper
 * so each ext_llm_calls row can answer "who burned these tokens, and was the
 * user aware?".
 */
export interface ExtCallerContext {
	extensionName: string;
	/**
	 * Short scope label, e.g. "command:/recap --smart" or "hook:before_agent_start".
	 * Format is consumer-readable; bounded length (≤128 chars).
	 */
	callerContext: string;
	/**
	 * True when the path was initiated by the user typing a slash command;
	 * false when the path was initiated by an extension hook auto-firing.
	 * This is the field SQL dashboards group on to catch idle-thinking-class
	 * bugs (hooks silently calling LLMs the user never asked for).
	 */
	isUserInitiated: boolean;
	sessionId?: string | null;
	runId?: string | null;
	variant?: string | null;
}

const storage = new AsyncLocalStorage<ExtCallerContext>();

/**
 * Run `fn` with `ctx` accessible to any descendant async frame via
 * getExtCallerContext(). The context is automatically cleared when the
 * returned promise settles.
 */
export function runWithExtCallerContext<T>(ctx: ExtCallerContext, fn: () => Promise<T> | T): Promise<T> {
	return Promise.resolve(storage.run(ctx, fn));
}

export function getExtCallerContext(): ExtCallerContext | undefined {
	return storage.getStore();
}
