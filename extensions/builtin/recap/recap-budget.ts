/**
 * [WHO]: estimateInputTokens(), checkPerCallBudget(), BudgetVerdict
 * [FROM]: Depends on ./recap-types for RecapSettings
 * [TO]: Consumed by extensions/builtin/recap/recap-synthesizer.ts
 * [HERE]: extensions/builtin/recap/recap-budget.ts - pre-call budget enforcement (M1: per-call only; session/daily defer to M3)
 */
import type { RecapSettings } from "./recap-types.js";

/**
 * Rough token estimate from string length. 4 chars per token is the
 * conservative end of the typical 3–4 ratio across English + code. M1 uses
 * this only as a pre-flight check; post-call accounting always uses the
 * provider's real `usage.input` count from completeSimpleWithUsage.
 */
export function estimateInputTokens(systemPrompt: string, userMessage: string): number {
	return Math.ceil((systemPrompt.length + userMessage.length) / 4);
}

export type BudgetVerdict =
	| { allowed: true; estimatedInputTokens: number }
	| { allowed: false; reason: string; estimatedInputTokens: number };

/** Reject before calling the model if pre-flight input estimate exceeds the per-call cap. */
export function checkPerCallBudget(
	systemPrompt: string,
	userMessage: string,
	settings: RecapSettings,
): BudgetVerdict {
	const estimatedInputTokens = estimateInputTokens(systemPrompt, userMessage);
	if (estimatedInputTokens > settings.budgets.perCallTokensIn) {
		return {
			allowed: false,
			reason: `Recap input estimate ${estimatedInputTokens} tok exceeds per-call cap ${settings.budgets.perCallTokensIn} tok.`,
			estimatedInputTokens,
		};
	}
	return { allowed: true, estimatedInputTokens };
}
