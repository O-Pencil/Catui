/**
 * [WHO]: synthesizeSmartRecap(), buildRecapContext(), hasMeaningfulActivity(), SynthesizeResult
 * [FROM]: Depends on ./recap-budget, ./recap-extractor (walkSessionActivity), ./recap-types, core/extensions-host/types for ExtensionCommandContext + CompletionResult
 * [TO]: Consumed by extensions/builtin/recap/index.ts
 * [HERE]: extensions/builtin/recap/recap-synthesizer.ts - Smart Recap synthesis: builds prompt from session, runs completeSimpleWithUsage, enforces per-call budget
 */
import type { CompletionResult, ExtensionCommandContext } from "../../../core/extensions-host/types.js";
import { checkPerCallBudget } from "./recap-budget.js";
import { walkSessionActivity } from "./recap-extractor.js";
import type { RecapSettings, RecapTriggerReason } from "./recap-types.js";

const RECAP_SYSTEM_PROMPT = `You are producing a brief situational recap for the user mid-task.

Output exactly three short clauses in this order:
1. Current goal (what you understand the user wants — one sentence).
2. Key facts established so far (concrete artifacts: files touched, versions, decisions made — comma-separated).
3. Next decision needed from the user. Start with "Next:" in English replies or "下一步：" in Chinese replies. If no decision is pending, say "Next: continue" / "下一步：继续执行".

Constraints:
- Match the language of the user's most recent message (Chinese in → Chinese out).
- Wrap inline identifiers, file paths, and version strings in backticks.
- No greetings, no meta phrases like "Here is a recap", no markdown headers.
- 60 English words / 120 Chinese characters maximum across all three clauses combined.
- Do not contradict facts in the conversation transcript.`;

const ASSISTANT_TURN_CHAR_BUDGET = 500;
const RECENT_TURN_COUNT = 20;
const RECENT_TOOL_COUNT = 8;

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } =>
			typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text",
		)
		.map((part) => part.text)
		.join("\n");
}

interface RecapContext {
	prompt: string;
	userTurns: number;
	assistantTurns: number;
	toolCalls: number;
}

/**
 * Build the user-side payload fed to the synthesis model. Tight by design:
 * we walk the session and take only the most recent N message turns + a tail
 * of tool names. Tool *results* are intentionally excluded because their bulk
 * eats the per-call input budget without adding facts the recap needs. Returns
 * activity counts alongside the prompt so callers can short-circuit before
 * spending tokens on an empty session.
 *
 * Tool counts come from walkSessionActivity() so Free and Smart see the same
 * tool view (assistant content blocks with type === "toolCall").
 */
export function buildRecapContext(ctx: ExtensionCommandContext): RecapContext {
	const entries = ctx.sessionManager.getEntries();
	const activity = walkSessionActivity(entries);
	const turns: string[] = [];
	let userTurns = 0;
	let assistantTurns = 0;

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role === "user") {
			const text = extractText(msg.content);
			if (text.trim()) {
				turns.push(`User: ${text}`);
				userTurns += 1;
			}
		} else if (msg.role === "assistant") {
			const text = extractText(msg.content);
			if (text.trim()) {
				turns.push(`Assistant: ${text.slice(0, ASSISTANT_TURN_CHAR_BUDGET)}`);
				assistantTurns += 1;
			}
		}
	}

	const recentTurns = turns.slice(-RECENT_TURN_COUNT).join("\n\n");
	const recentTools = activity.tools.slice(-RECENT_TOOL_COUNT).join(", ");

	const pieces: string[] = [];
	if (recentTurns) pieces.push(`Recent conversation turns:\n${recentTurns}`);
	if (recentTools) pieces.push(`Recent tool calls (names only): ${recentTools}`);

	return {
		prompt: pieces.join("\n\n"),
		userTurns,
		assistantTurns,
		toolCalls: activity.tools.length,
	};
}

/**
 * Cheap pre-check the command handler can run before showing "Synthesizing
 * recap…" so empty sessions don't see a misleading progress notify.
 */
export function hasMeaningfulActivity(ctx: ExtensionCommandContext): boolean {
	const context = buildRecapContext(ctx);
	return context.userTurns > 0 || context.toolCalls > 0;
}

export type SynthesizeResult =
	| { kind: "ok"; completion: CompletionResult }
	| { kind: "empty_session" }
	| { kind: "budget_blocked"; reason: string; estimatedInputTokens: number }
	| { kind: "no_model" }
	| { kind: "no_response" };

/**
 * Run the Smart recap. M1 enforces the per-call input cap before calling the
 * model and surfaces the real `usage` from the provider on success.
 */
export async function synthesizeSmartRecap(
	ctx: ExtensionCommandContext,
	settings: RecapSettings,
	_trigger: RecapTriggerReason,
): Promise<SynthesizeResult> {
	const context = buildRecapContext(ctx);
	// No-activity guard: a session with zero user messages AND zero tool calls
	// has nothing meaningful to recap. Short-circuit before spending tokens —
	// users testing on a fresh session were burning ~500 tokens per call.
	if (context.userTurns === 0 && context.toolCalls === 0) {
		return { kind: "empty_session" };
	}
	const userMessage = context.prompt;
	const verdict = checkPerCallBudget(RECAP_SYSTEM_PROMPT, userMessage, settings);
	if (!verdict.allowed) {
		return { kind: "budget_blocked", reason: verdict.reason, estimatedInputTokens: verdict.estimatedInputTokens };
	}

	const completion = await ctx.completeSimpleWithUsage(RECAP_SYSTEM_PROMPT, userMessage);
	if (!completion) {
		// completeSimpleWithUsage returns undefined when there is no current model or no API key.
		return ctx.model ? { kind: "no_response" } : { kind: "no_model" };
	}
	if (!completion.text.trim()) {
		return { kind: "no_response" };
	}
	return { kind: "ok", completion };
}
