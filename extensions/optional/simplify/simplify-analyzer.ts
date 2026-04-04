/**
 * [WHO]: Provides simplifyWithLLM(), buildUserPrompt(), SIMPLIFY_SYSTEM_PROMPT
 * [FROM]: Depends on ExtensionContext, simplify parser, and simplify type constants
 * [TO]: Consumed by extensions/optional/simplify/index.ts during file analysis
 * [HERE]: extensions/optional/simplify/simplify-analyzer.ts - LLM integration for simplify extension
 */

import type { ExtensionContext } from "../../../core/extensions-host/types.js";
import { parseSimplifyOutput } from "./simplify-parser.js";
import { SIMPLIFY_OUTPUT_START, SIMPLIFY_OUTPUT_END, type SimplifyOutput } from "./simplify-types.js";

// =============================================================================
// System Prompt
// =============================================================================

/**
 * System prompt for code simplification
 * Uses XML-tagged output format for reliable parsing
 */
const SIMPLIFY_SYSTEM_PROMPT = `You are a code simplification expert. Your task is to refactor code to reduce cognitive load while preserving exact functionality.

CONSTRAINTS:
1. DO NOT change function signatures or external behavior
2. DO NOT add or remove functionality
3. DO NOT change the public API
4. Preserve all side effects exactly

REFACTORING PATTERNS (apply in order of priority):
1. Guard Clauses: Convert nested if-else to early returns
   - Before: if (x) { if (y) { ...long code... } }
   - After: if (!x) return; if (!y) return; ...long code...

2. Expression Folding: Simplify boolean logic
   - Before: if (x === true) -> After: if (x)
   - Before: if (!(a && b)) -> After: if (!a || !b)

3. Redundancy Removal:
   - Remove unnecessary intermediate variables
   - Remove unused private methods
   - Remove outdated comments

4. Loop Simplification:
   - Convert forEach + push to map/filter
   - Use array methods over manual iteration

OUTPUT FORMAT:
Return exactly one XML block with JSON inside:
${SIMPLIFY_OUTPUT_START}
{"simplified": "the simplified code or null if no change needed", "explanation": "brief explanation of changes", "equivalent": true}
${SIMPLIFY_OUTPUT_END}

If no simplification is needed, return:
${SIMPLIFY_OUTPUT_START}
{"simplified": null, "explanation": "Code is already simple and clean", "equivalent": true}
${SIMPLIFY_OUTPUT_END}`;

// =============================================================================
// User Prompt Builder
// =============================================================================

/**
 * Build the user prompt for simplification
 */
export function buildUserPrompt(code: string, rules: string, diff?: string): string {
	let prompt = `Simplify the following code according to the constraints above.\n\n`;

	if (rules) {
		prompt += `PROJECT RULES (must follow):\n${rules}\n\n`;
	}

	if (diff) {
		prompt += `FOCUS AREA (prioritize changes in this diff):\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;
	}

	prompt += `CODE TO SIMPLIFY:\n\`\`\`\n${code}\n\`\`\``;

	return prompt;
}

// =============================================================================
// LLM Integration
// =============================================================================

/**
 * Simplify code using LLM via ctx.completeSimple()
 *
 * This replaces the previous manual model resolution with the simpler
 * ctx.completeSimple() pattern used by the interview extension.
 *
 * @param code - Original code to simplify
 * @param rules - Project rules (from CLAUDE.md, etc.)
 * @param diff - Git diff for the file (optional)
 * @param ctx - Extension context with completeSimple method
 * @returns SimplifyOutput with simplified code or null
 */
export async function simplifyWithLLM(
	code: string,
	rules: string,
	diff: string | undefined,
	ctx: ExtensionContext,
): Promise<SimplifyOutput> {
	const userMessage = buildUserPrompt(code, rules, diff);

	try {
		const raw = await ctx.completeSimple(SIMPLIFY_SYSTEM_PROMPT, userMessage);

		if (!raw) {
			return {
				simplified: null,
				explanation: "No model response (no model configured or API key missing)",
				equivalent: false,
			};
		}

		return parseSimplifyOutput(raw);
	} catch (error) {
		return {
			simplified: null,
			explanation: `LLM error: ${error instanceof Error ? error.message : String(error)}`,
			equivalent: false,
		};
	}
}
