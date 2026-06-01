/**
 * [WHO]: Provides BashRunner, BashRunnerDeps — bash execution + pending-message queue for a session
 * [FROM]: Depends on core/platform/exec/bash-executor (execution), core/messages (BashExecutionMessage),
 *         core/tools/bash (BashOperations); host wiring passed in via closures (no agent/session import)
 * [TO]: Consumed by core/runtime/agent-session.ts (composition root delegates executeBash/abortBash/…)
 * [HERE]: core/runtime/agent-session.ts split — owns _bashAbortController + _pendingBashMessages
 *
 * Extracted from AgentSession (P4.1). Behavior-identical: the session's executeBash /
 * recordBashResult / abortBash / isBashRunning / hasPendingBashMessages / flushPending methods
 * now delegate here. Dependencies are injected as closures so this module stays decoupled from
 * Agent / SessionManager / SettingsManager.
 */

import { type BashResult, executeBash as executeBashCommand, executeBashWithOperations } from "../platform/exec/bash-executor.js";
import type { BashExecutionMessage } from "../messages.js";
import type { BashOperations } from "../tools/bash.js";

export interface BashRunnerDeps {
  /** Current working directory (read lazily — may change across session switches). */
  getCwd: () => string;
  /** Optional shell command prefix (e.g. alias expansion) from settings. */
  getShellCommandPrefix: () => string | undefined;
  /** Append a message to live agent state. */
  appendToAgent: (message: BashExecutionMessage) => void;
  /** Persist a message to the session. */
  appendToSession: (message: BashExecutionMessage) => void;
  /** Whether the agent is mid-stream (defer message to preserve tool ordering). */
  isStreaming: () => boolean;
}

export class BashRunner {
  private _abortController: AbortController | undefined = undefined;
  private _pending: BashExecutionMessage[] = [];

  constructor(private readonly deps: BashRunnerDeps) {}

  /** Run a bash command, recording its result in session history. */
  async execute(
    command: string,
    onChunk?: (chunk: string) => void,
    options?: { excludeFromContext?: boolean; operations?: BashOperations },
  ): Promise<BashResult> {
    this._abortController = new AbortController();

    // Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
    const prefix = this.deps.getShellCommandPrefix();
    const resolvedCommand = prefix ? `${prefix}\n${command}` : command;
    const cwd = this.deps.getCwd();

    try {
      const result = options?.operations
        ? await executeBashWithOperations(resolvedCommand, cwd, options.operations, {
            onChunk,
            signal: this._abortController.signal,
          })
        : await executeBashCommand(resolvedCommand, {
            onChunk,
            signal: this._abortController.signal,
            cwd,
          });

      this.recordResult(command, result, options);
      return result;
    } finally {
      this._abortController = undefined;
    }
  }

  /**
   * Record a bash execution result in session history.
   * Used by execute() and by extensions that handle bash execution themselves.
   */
  recordResult(command: string, result: BashResult, options?: { excludeFromContext?: boolean }): void {
    const bashMessage: BashExecutionMessage = {
      role: "bashExecution",
      command,
      output: result.output,
      exitCode: result.exitCode,
      cancelled: result.cancelled,
      truncated: result.truncated,
      fullOutputPath: result.fullOutputPath,
      timestamp: Date.now(),
      excludeFromContext: options?.excludeFromContext,
    };

    // If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
    if (this.deps.isStreaming()) {
      this._pending.push(bashMessage);
    } else {
      this.deps.appendToAgent(bashMessage);
      this.deps.appendToSession(bashMessage);
    }
  }

  /** Cancel running bash command. */
  abort(): void {
    this._abortController?.abort();
  }

  /** Whether a bash command is currently running. */
  get isRunning(): boolean {
    return this._abortController !== undefined;
  }

  /** Whether there are pending bash messages waiting to be flushed. */
  get hasPending(): boolean {
    return this._pending.length > 0;
  }

  /**
   * Flush pending bash messages to agent state and session.
   * Called after agent turn completes to maintain proper message ordering.
   */
  flushPending(): void {
    if (this._pending.length === 0) return;
    for (const bashMessage of this._pending) {
      this.deps.appendToAgent(bashMessage);
      this.deps.appendToSession(bashMessage);
    }
    this._pending = [];
  }
}
