/**
 * [WHO]: applyTokenSavePlan() combines rewrite planning, filtering, recovery, and token accounting
 * [FROM]: Depends on ./filters, ./rewrite, ./recovery
 * [TO]: Consumed by extensions/builtin/token-save/index.ts and tests
 * [HERE]: extensions/builtin/token-save/runner.ts - TokenSave capture/passthrough result contract
 */
import { estimateTokens, filterTokenSaveOutput } from "./filters.js";
import { writeRawRecovery } from "./recovery.js";
import { planCommand, type RewriteDecision } from "./rewrite.js";

export interface TokenSaveRunResult {
	plan: RewriteDecision;
	rawText: string;
	filteredText: string;
	inputTokens: number;
	outputTokens: number;
	savedTokens: number;
	savingsPct: number;
	shouldReplace: boolean;
	rawRecoveryPath?: string;
}

const MIN_SAVINGS_TOKENS = 32;
const MIN_SAVINGS_PCT = 12;

export async function applyTokenSavePlan(command: string, rawText: string, dataDir: string): Promise<TokenSaveRunResult> {
	const plan = planCommand(command);
	if (plan.mode === "passthrough") {
		return buildResult(plan, rawText, rawText, undefined, false);
	}

	const filtered = filterTokenSaveOutput(command, rawText);
	const rawRecoveryPath = await writeRawRecovery(dataDir, rawText);
	const result = buildResult(plan, rawText, filtered.text, rawRecoveryPath, true);
	return {
		...result,
		shouldReplace:
			result.savedTokens >= MIN_SAVINGS_TOKENS &&
			result.savingsPct >= MIN_SAVINGS_PCT &&
			result.filteredText !== result.rawText,
	};
}

function buildResult(
	plan: RewriteDecision,
	rawText: string,
	filteredText: string,
	rawRecoveryPath: string | undefined,
	trackTokens: boolean,
): TokenSaveRunResult {
	const inputTokens = trackTokens ? estimateTokens(rawText) : 0;
	const outputTokens = trackTokens ? estimateTokens(filteredText) : 0;
	const savedTokens = Math.max(0, inputTokens - outputTokens);
	const savingsPct = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;

	return {
		plan,
		rawText,
		filteredText,
		inputTokens,
		outputTokens,
		savedTokens,
		savingsPct,
		shouldReplace: false,
		rawRecoveryPath,
	};
}
