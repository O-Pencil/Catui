/**
 * [WHO]: TokenSave rewrite registry and command planning helpers
 * [FROM]: Depends on ./lexer for quote-aware command segmentation
 * [TO]: Consumed by TokenSave extension, runner, and tests
 * [HERE]: extensions/builtin/token-save/rewrite.ts - TokenSave command classification registry
 */
import { splitShellSegments } from "./lexer.js";
import type { TokenSaveCategory } from "./filters.js";
import { isNoOutputBuiltin } from "./no-output-builtins.js";

export interface RewriteRule {
	id: string;
	category: TokenSaveCategory;
	pattern: RegExp;
	target: string;
	estimatedSavingsPct: number;
}

export interface RewriteDecision {
	original: string;
	target: string;
	category: TokenSaveCategory;
	mode: "capture" | "passthrough";
	estimatedSavingsPct: number;
	reason?: string;
}

export const rewriteRules: RewriteRule[] = [
	{ id: "git-status", category: "git-status", pattern: /\bgit\s+status\b/, target: "tokensave git status", estimatedSavingsPct: 65 },
	{ id: "git-diff", category: "git-diff", pattern: /\bgit\s+(?:diff|show)\b/, target: "tokensave git diff", estimatedSavingsPct: 70 },
	{ id: "git-log", category: "git-log", pattern: /\bgit\s+(?:log|show)\b/, target: "tokensave git log", estimatedSavingsPct: 45 },
	{ id: "read-file", category: "read-file", pattern: /^(?:cat|head|tail|less|sed\s+-n)\b/, target: "tokensave read", estimatedSavingsPct: 55 },
	{ id: "search", category: "search", pattern: /^(?:rg|grep|find|fd|ls|tree)\b/, target: "tokensave search", estimatedSavingsPct: 40 },
	{ id: "typescript", category: "typescript", pattern: /\b(?:tsc|vue-tsc)\b/, target: "tokensave tsc", estimatedSavingsPct: 75 },
	{ id: "lint", category: "lint", pattern: /\b(?:eslint|biome)\b/, target: "tokensave lint", estimatedSavingsPct: 70 },
	{ id: "pytest", category: "pytest", pattern: /\bpytest\b/, target: "tokensave pytest", estimatedSavingsPct: 75 },
	{ id: "test", category: "test", pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+(?:test|build|lint|typecheck)|exec\s+(?:tsc|vue-tsc|vitest|jest|playwright|eslint|biome))\b|\b(?:vitest|jest|playwright|mocha)\b/, target: "tokensave test", estimatedSavingsPct: 70 },
	{ id: "package-manager", category: "package-manager", pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update)\b/, target: "tokensave packages", estimatedSavingsPct: 45 },
	{ id: "json", category: "json", pattern: /\b(?:jq|curl)\b/, target: "tokensave json", estimatedSavingsPct: 65 },
];

function stripEnvPrefix(segment: string): string {
	return segment.replace(/^\s*(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/, "").trim();
}

function hasHeredoc(segment: string): boolean {
	return /<<-?\s*\w+/.test(segment);
}

function hasWriteRedirection(segment: string): boolean {
	return /(^|\s)(?:>>?|2>|&>)/.test(segment) || /\bcat\s*>/.test(segment);
}

function disabled(segment: string): boolean {
	return /\b(?:TOKEN_SAVE_DISABLED|TOKENSAVE_DISABLED)=1\b/.test(segment);
}

export function planCommand(command: string): RewriteDecision {
	const segments = splitShellSegments(command);
	const first = segments[0]?.text ?? command;
	const normalized = stripEnvPrefix(first);

	if (!normalized) return passthrough(command, "empty command");
	if (disabled(first)) return passthrough(command, "disabled by env");
	if (hasHeredoc(first)) return passthrough(command, "heredoc");
	if (hasWriteRedirection(first)) return passthrough(command, "write redirection");
	// Shell builtins that produce no capture-worthy output. Sending these
	// through capture mode runs the filter for nothing — the filter gets a
	// near-empty input, generates zero savings, and writes a 'filtered
	// savedTokens=0' history record that pollutes the /tokensave summary.
	if (isNoOutputBuiltin(normalized)) return passthrough(command, "no-output shell builtin");

	for (const rule of rewriteRules) {
		if (rule.pattern.test(normalized)) {
			return {
				original: command,
				target: rule.target,
				category: rule.category,
				mode: "capture",
				estimatedSavingsPct: rule.estimatedSavingsPct,
			};
		}
	}

	return {
		original: command,
		target: "tokensave generic",
		category: "generic",
		mode: "capture",
		estimatedSavingsPct: 25,
	};
}

function passthrough(command: string, reason: string): RewriteDecision {
	return {
		original: command,
		target: command,
		category: "generic",
		mode: "passthrough",
		estimatedSavingsPct: 0,
		reason,
	};
}
