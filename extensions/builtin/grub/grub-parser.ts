/**
 * [WHO]: parseGrubCommand, buildGrubHelp, getGrubArgumentCompletions
 * [FROM]: Depends on ./grub-types
 * [TO]: Consumed by extension entry point (./index.ts)
 * [HERE]: extensions/builtin/grub/grub-parser.ts - /grub command parser with resume/status --json/--max-iter/--max-fail flags
 */

import type { ParsedGrubCommand } from "./grub-types.js";
import { grubText, type GrubLocale } from "./grub-i18n.js";

interface TokenizedArgs {
	positional: string[];
	flags: Record<string, string | boolean>;
}

type GrubArgumentCompletionContext = {
	commandName: string;
	argumentText: string;
	argumentPrefix: string;
	tokenIndex: number;
	previousTokens: string[];
};

type GrubCompletionItem = {
	value: string;
	label: string;
	description: string;
};

const ROOT_COMPLETIONS: readonly GrubCompletionItem[] = [
	{ value: "status", label: "status", description: "Show current progress" },
	{ value: "resume", label: "resume", description: "Continue a saved task" },
	{ value: "stop", label: "stop", description: "Stop the current task" },
	{ value: "help", label: "help", description: "Show usage help" },
];

const START_FLAG_COMPLETIONS: readonly GrubCompletionItem[] = [
	{ value: "--max-iter", label: "--max-iter", description: "Limit total work rounds" },
	{ value: "--max-fail", label: "--max-fail", description: "Stop after repeated failed rounds" },
];

const STATUS_FLAG_COMPLETIONS: readonly GrubCompletionItem[] = [
	{ value: "--json", label: "--json", description: "Show full saved details" },
];

function scanTokens(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaping = false;

	for (const char of input.trim()) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaping = true;
			continue;
		}
		if ((char === "'" || char === '"') && !quote) {
			quote = char;
			continue;
		}
		if (char === quote) {
			quote = undefined;
			continue;
		}
		if (/\s/.test(char) && !quote) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}

	if (escaping) current += "\\";
	if (current) tokens.push(current);
	return tokens;
}

function tokenize(input: string): TokenizedArgs {
	const tokens = scanTokens(input);
	const positional: string[] = [];
	const flags: Record<string, string | boolean> = {};
	const knownValueFlags = new Set(["max-iter", "max-iterations", "max-fail", "max-failures"]);
	for (let i = 0; i < tokens.length; i += 1) {
		const tok = tokens[i];
		if (tok === "--") {
			positional.push(...tokens.slice(i + 1));
			break;
		}
		if (tok.startsWith("--")) {
			const eq = tok.indexOf("=");
			if (eq !== -1) {
				const key = tok.slice(2, eq);
				if (knownValueFlags.has(key) || key === "json") {
					flags[key] = tok.slice(eq + 1);
				} else {
					positional.push(tok);
				}
				continue;
			}
			const key = tok.slice(2);
			const next = tokens[i + 1];
			if (knownValueFlags.has(key) && next !== undefined) {
				flags[key] = next;
				i += 1;
			} else if (key === "json") {
				flags[key] = true;
			} else {
				positional.push(tok);
			}
			continue;
		}
		positional.push(tok);
	}
	return { positional, flags };
}

function filterCompletions(
	items: readonly GrubCompletionItem[],
	argumentPrefix: string,
): GrubCompletionItem[] | null {
	const prefix = argumentPrefix.trim().toLowerCase();
	const matches = items.filter((item) => item.value.startsWith(prefix));
	return matches.length > 0 ? [...matches] : null;
}

export function getGrubArgumentCompletions(
	argumentPrefix: string,
	context?: GrubArgumentCompletionContext,
): GrubCompletionItem[] | null {
	if (argumentPrefix.trim().startsWith("--")) {
		const firstToken = context?.previousTokens[0]?.toLowerCase();
		return filterCompletions(
			firstToken === "status" || firstToken === "list"
				? STATUS_FLAG_COMPLETIONS
				: START_FLAG_COMPLETIONS,
			argumentPrefix,
		);
	}

	if (!context || context.tokenIndex === 0) {
		return filterCompletions(ROOT_COMPLETIONS, argumentPrefix);
	}

	return null;
}

function parsePositiveInt(value: string | boolean | undefined): number | undefined {
	if (typeof value !== "string") return undefined;
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	return n;
}

export function parseGrubCommand(input: string): ParsedGrubCommand {
	const raw = input.trim();
	if (!raw) {
		return { type: "help", reason: "empty" };
	}

	const { positional, flags } = tokenize(raw);
	const first = positional[0]?.toLowerCase() ?? "";

	if (first === "status" || first === "list") {
		const json = flags.json === true || flags.json === "true" || positional.includes("--json");
		return { type: "status", json };
	}
	if (first === "stop" || first === "clear" || first === "cancel") {
		return { type: "stop" };
	}
	if (first === "resume" || first === "continue") {
		return { type: "resume" };
	}
	if (first === "help") {
		return { type: "help" };
	}

	const goal = positional.join(" ").trim();
	if (!goal) {
		return { type: "help", reason: "empty" };
	}

	return {
		type: "start",
		goal,
		maxIterations: parsePositiveInt(flags["max-iter"]) ?? parsePositiveInt(flags["max-iterations"]),
		maxConsecutiveFailures: parsePositiveInt(flags["max-fail"]) ?? parsePositiveInt(flags["max-failures"]),
	};
}

export function buildGrubHelp(reason?: string, locale: GrubLocale = "en"): string {
	const text = grubText(locale);
	const lines: string[] = [];
	if (reason) {
		lines.push(`${text.prefix} ${reason}`);
	}
	lines.push(...text.usage);
	return lines.join("\n");
}
