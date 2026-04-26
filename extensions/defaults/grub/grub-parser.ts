/**
 * [WHO]: parseGrubCommand, buildGrubHelp
 * [FROM]: Depends on ./grub-types
 * [TO]: Consumed by extension entry point (./index.ts)
 * [HERE]: extensions/defaults/grub/grub-parser.ts - /grub command parser with resume/status --json/--max-iter/--max-fail flags
 */

import type { ParsedGrubCommand } from "./grub-types.js";
import { grubText, type GrubLocale } from "./grub-i18n.js";

interface TokenizedArgs {
	positional: string[];
	flags: Record<string, string | boolean>;
	goal: string;
}

function tokenize(input: string): TokenizedArgs {
	const tokens = input.trim().split(/\s+/).filter(Boolean);
	const positional: string[] = [];
	const flags: Record<string, string | boolean> = {};
	const remaining: string[] = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const tok = tokens[i];
		if (tok.startsWith("--")) {
			const eq = tok.indexOf("=");
			if (eq !== -1) {
				flags[tok.slice(2, eq)] = tok.slice(eq + 1);
				remaining.push(tok);
				continue;
			}
			const key = tok.slice(2);
			const next = tokens[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				flags[key] = next;
				remaining.push(tok, next);
				i += 1;
			} else {
				flags[key] = true;
				remaining.push(tok);
			}
			continue;
		}
		positional.push(tok);
		remaining.push(tok);
	}
	// Rebuild goal preserving original whitespace, stripping flag tokens.
	const flagSet = new Set(remaining);
	const raw = input.trim();
	// Fast path: no flags detected, goal = raw input.
	if (Object.keys(flags).length === 0) {
		return { positional, flags, goal: raw };
	}
	// Strip flag tokens by splitting on whitespace again (tolerates simple cases).
	const goal = tokens.filter((t) => !flagSet.has(t) || positional.includes(t)).join(" ");
	return { positional, flags, goal };
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

	// Treat as start; use tokens minus flags as goal.
	const goalTokens: string[] = [];
	const tokens = raw.split(/\s+/);
	for (let i = 0; i < tokens.length; i += 1) {
		const tok = tokens[i];
		if (tok.startsWith("--")) {
			if (tok.includes("=")) continue;
			const next = tokens[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				i += 1;
			}
			continue;
		}
		goalTokens.push(tok);
	}
	const goal = goalTokens.join(" ").trim();
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
