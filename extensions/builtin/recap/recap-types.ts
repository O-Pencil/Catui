/**
 * [WHO]: RECAP_MESSAGE_TYPE, RecapEntry, RecapSettings, RecapTriggerReason types
 * [FROM]: Depends on @pencil-agent/ai for Usage
 * [TO]: Consumed by extensions/builtin/recap/index.ts, recap-renderer.ts, recap-synthesizer.ts, recap-budget.ts
 * [HERE]: extensions/builtin/recap/recap-types.ts - shared type surface for the recap extension
 */
import type { Usage } from "@pencil-agent/ai";

/** Custom message type registered by the recap extension. Must match the string in the exclusion set in core/messages.ts. */
export const RECAP_MESSAGE_TYPE = "recap";

/** Why the recap was emitted. M1 only supports "manual"; "auto-turn" / "auto-compact" land in M4. */
export type RecapTriggerReason = "manual" | "auto-turn" | "auto-compact";

/** Whether the recap text came from the model or a deterministic extractor. M1 only ships "smart". */
export type RecapSource = "smart" | "free";

/**
 * One emitted recap. Body text lives in CustomMessage.content; this struct
 * lives in CustomMessage.details and drives the renderer's header line.
 */
export interface RecapEntry {
	source: RecapSource;
	trigger: RecapTriggerReason;
	triggeredAt: number;
	/** Provider-reported token usage. Undefined when source === "free". */
	usage?: Usage;
}

/** Per-extension settings, surfaced via getSettings() — not used in M1 but defined here so M3/M4 don't churn the type. */
export interface RecapSettings {
	autoEnabled: boolean;
	turnsBetween: number;
	contextPctDelta: number;
	budgets: {
		perCallTokensIn: number;
		perCallTokensOut: number;
		sessionCalls: number;
		sessionTokens: number;
		dailyCalls: number;
		dailyTokens: number;
	};
}

/** Defaults that ship with M1. Conservative — see docs/Recap扩展.md for rationale. */
export const RECAP_DEFAULTS: RecapSettings = {
	autoEnabled: false,
	turnsBetween: 6,
	contextPctDelta: 0.2,
	budgets: {
		perCallTokensIn: 1200,
		perCallTokensOut: 250,
		sessionCalls: 10,
		sessionTokens: 15000,
		dailyCalls: 30,
		dailyTokens: 50000,
	},
};
