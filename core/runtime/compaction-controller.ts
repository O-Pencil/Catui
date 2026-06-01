/**
 * [WHO]: Provides CompactionController — manual context-window compaction + its abort state
 * [FROM]: Depends on session/compaction (compact, prepareCompaction, CompactionResult),
 *         session-manager (CompactionEntry), extensions-host (SessionBeforeCompactResult),
 *         platform/abort-slot, and ./session-context (CompactionControllerContext)
 * [TO]: Consumed by core/runtime/agent-session.ts (constructs one, delegates compact()/abortCompaction())
 * [HERE]: core/runtime/agent-session.ts split (P4.x-a) — owns the manual-compaction abort slot
 *
 * Extracted from AgentSession (AS04). Owns the manual compaction flow and its cancellation state.
 * Auto-compaction (loop-driven) is a later slice (P4.x-b). Session state is reached through the
 * narrow CompactionControllerContext; behavior is identical to the former AgentSession.compact().
 */

import { type CompactionResult, compact, prepareCompaction } from "../session/compaction/index.js";
import type { SessionBeforeCompactResult } from "../extensions-host/index.js";
import type { CompactionEntry } from "../session/session-manager.js";
import { AbortSlot } from "../platform/abort-slot.js";
import type { CompactionControllerContext } from "./session-context.js";

export class CompactionController {
  /** Cancellation slot for the in-flight manual compaction. */
  private readonly _slot = new AbortSlot();

  constructor(private readonly ctx: CompactionControllerContext) {}

  /** Whether a manual compaction is currently running. */
  get isCompacting(): boolean {
    return this._slot.active;
  }

  /** Cancel an in-progress manual compaction. */
  abort(): void {
    this._slot.abort();
  }

  /**
   * Compact the current branch: summarize older entries and rebuild agent messages.
   * Detaches the agent during the operation and reconnects in finally.
   */
  async compact(customInstructions?: string): Promise<CompactionResult> {
    this.ctx.logInfo("Manual compaction started", { hasCustomInstructions: !!customInstructions });
    this.ctx.disconnectFromAgent();
    await this.ctx.abortAgent();
    const compactionSignal = this._slot.begin();

    try {
      const model = this.ctx.getModel();
      if (!model) {
        throw new Error("No model selected");
      }

      const apiKey = await this.ctx.getApiKey(model);
      if (!apiKey) {
        throw new Error(`No API key for ${model.provider}`);
      }

      const pathEntries = this.ctx.getBranch();
      const settings = this.ctx.getCompactionSettings();

      const preparation = prepareCompaction(pathEntries, settings);
      if (!preparation) {
        // Check why we can't compact
        const lastEntry = pathEntries[pathEntries.length - 1];
        if (lastEntry?.type === "compaction") {
          throw new Error("Already compacted");
        }
        throw new Error("Nothing to compact (session too small)");
      }

      let extensionCompaction: CompactionResult | undefined;
      let fromExtension = false;

      const runner = this.ctx.getExtensionRunner();
      if (runner?.hasHandlers("session_before_compact")) {
        const result = (await runner.emit({
          type: "session_before_compact",
          preparation,
          branchEntries: pathEntries,
          customInstructions,
          signal: compactionSignal,
        })) as SessionBeforeCompactResult | undefined;

        if (result?.cancel) {
          throw new Error("Compaction cancelled");
        }

        if (result?.compaction) {
          extensionCompaction = result.compaction;
          fromExtension = true;
        }
      }

      let summary: string;
      let firstKeptEntryId: string;
      let tokensBefore: number;
      let details: unknown;

      if (extensionCompaction) {
        // Extension provided compaction content
        summary = extensionCompaction.summary;
        firstKeptEntryId = extensionCompaction.firstKeptEntryId;
        tokensBefore = extensionCompaction.tokensBefore;
        details = extensionCompaction.details;
      } else {
        // Generate compaction result
        const result = await compact(preparation, model, apiKey, customInstructions, compactionSignal);
        summary = result.summary;
        firstKeptEntryId = result.firstKeptEntryId;
        tokensBefore = result.tokensBefore;
        details = result.details;
      }

      if (compactionSignal.aborted) {
        throw new Error("Compaction cancelled");
      }

      this.ctx.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension);
      const newEntries = this.ctx.getEntries();
      this.ctx.applyCompactedMessages();

      // Get the saved compaction entry for the extension event
      const savedCompactionEntry = newEntries.find(
        (e) => e.type === "compaction" && e.summary === summary,
      ) as CompactionEntry | undefined;

      if (runner && savedCompactionEntry) {
        await runner.emit({
          type: "session_compact",
          compactionEntry: savedCompactionEntry,
          fromExtension,
        });
      }

      return { summary, firstKeptEntryId, tokensBefore, details };
    } finally {
      this._slot.clear();
      this.ctx.reconnectToAgent();
    }
  }
}
