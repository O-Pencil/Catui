/**
 * [WHO]: resolveCompactionBudget() scales settings to the current model context
 * [FROM]: Depends on compaction settings and ai model contracts
 * [TO]: Consumed by AgentSession and compaction-budget regression tests
 * [HERE]: core/session/compaction/budget.ts - pure per-model budgeting policy
 */
import type { Model } from "@catui/ai/types";
import type { CompactionSettings } from "./compaction.js";

/** Cap small-model reserves without persisting changes or enlarging explicit settings. */
export function resolveCompactionBudget(
  settings: CompactionSettings,
  model: Pick<Model<any>, "contextWindow"> | undefined,
): CompactionSettings {
  const window = model?.contextWindow;
  if (!window || !Number.isSafeInteger(window) || window <= 0 || window >= 131072) return settings;
  const cap = Math.max(1, Math.floor(window / 8));
  return {
    ...settings,
    reserveTokens: Math.min(settings.reserveTokens, cap),
    keepRecentTokens: Math.min(settings.keepRecentTokens, cap),
  };
}
