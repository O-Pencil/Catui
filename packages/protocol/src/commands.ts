/**
 * [WHO]: Provides ExtensionCommand, ArgumentCompletionContext, CommandCompletionItem
 * [FROM]: No dependencies — context is generic so lifecycle/host can supply their own context type
 * [TO]: Consumed by extensions registering slash commands and by the host command registry
 * [HERE]: packages/protocol/src/commands.ts - stable command registration contract
 *
 * Host note: the host may pass a richer command context to handlers, but the protocol
 * contract stays minimal so published packages and third-party extensions do not depend
 * on host-only session controls.
 */

/** Structured context supplied while completing command arguments. */
export interface ArgumentCompletionContext {
  commandName: string;
  argumentText: string;
  argumentPrefix: string;
  tokenIndex: number;
  previousTokens: string[];
}

/** A single command-completion candidate. */
export interface CommandCompletionItem {
  value: string;
  label: string;
  description?: string;
}

/** A slash command an extension registers via `api.registerCommand(...)`. */
export interface ExtensionCommand<TContext = unknown> {
  /** Help text shown in command lists. */
  description?: string;
  /** Optional argument-completion provider. */
  getArgumentCompletions?: (
    argumentPrefix: string,
    context?: ArgumentCompletionContext,
  ) => CommandCompletionItem[] | null;
  /** Command body. `args` is the raw argument string (may be empty). */
  handler: (args: string, ctx: TContext) => void | Promise<void>;
}
