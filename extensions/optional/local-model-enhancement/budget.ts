/**
 * [WHO]: resultBudget and defaultToolInput for constrained local-model requests
 * [FROM]: No runtime dependencies
 * [TO]: Consumed by the local-model-enhancement entry and regression tests
 * [HERE]: extensions/optional/local-model-enhancement/budget.ts - extension-owned policy
 */

export interface ResultBudget {
  perResultChars: number;
  batchBodyChars: number;
}

/** Character ceilings, not a tokenizer or a hard request-context guarantee. */
export function resultBudget(contextWindow?: number): ResultBudget {
  const window = Number.isFinite(contextWindow) && contextWindow! > 0 ? contextWindow! : 16384;
  const perResultChars = Math.max(512, Math.min(6000, Math.floor(window / 4)));
  return { perResultChars, batchBodyChars: perResultChars * 4 };
}

const DEFAULT_LIMITS: Readonly<Record<string, number>> = { read: 120, grep: 30, find: 50, ls: 50 };

/** Explicit limits (including invalid ones) remain subject to ordinary tool validation. */
export function defaultToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> | undefined {
  const limit = DEFAULT_LIMITS[toolName];
  if (limit === undefined || input.limit !== undefined || (toolName === "grep" && input.head_limit !== undefined)) return;
  return { ...input, limit };
}
