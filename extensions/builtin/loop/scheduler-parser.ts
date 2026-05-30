/**
 * [WHO]: parseSchedulerCommand, parseDurationSpec, buildSchedulerHelp
 * [FROM]: Depends on ./scheduler-types
 * [TO]: Consumed by ./index.ts
 * [HERE]: extensions/builtin/loop/scheduler-parser.ts - /loop command parser with flags and subcommands
 */

import type { LoopPayloadKind, ParsedSchedulerCommand } from "./scheduler-types.js";

const DURATION_TOKEN = /(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)/gi;
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_LABEL = "10m";

function normalizeDurationLabel(parts: Array<{ value: number; unit: string }>): string {
	return parts
		.map(({ value, unit }) => {
			const shortUnit =
				unit.startsWith("s") ? "s" : unit.startsWith("m") ? "m" : unit.startsWith("h") ? "h" : "d";
			return `${value}${shortUnit}`;
		})
		.join(" ");
}

export function parseDurationSpec(raw: string): { intervalMs: number; intervalLabel: string } | undefined {
	const normalized = raw.trim().toLowerCase();
	if (!normalized) return undefined;

	if (normalized === "hourly") return { intervalMs: 60 * 60 * 1000, intervalLabel: "1h" };
	if (normalized === "daily") return { intervalMs: 24 * 60 * 60 * 1000, intervalLabel: "1d" };

	const matches = [...normalized.matchAll(DURATION_TOKEN)];
	if (matches.length === 0) return undefined;

	let consumed = "";
	let totalMs = 0;
	const parts: Array<{ value: number; unit: string }> = [];
	for (const match of matches) {
		consumed += match[0];
		const value = Number.parseInt(match[1] ?? "", 10);
		const unit = match[2] ?? "";
		if (!Number.isFinite(value) || value <= 0) return undefined;

		if (unit.startsWith("s")) totalMs += value * 1000;
		else if (unit.startsWith("m")) totalMs += value * 60 * 1000;
		else if (unit.startsWith("h")) totalMs += value * 60 * 60 * 1000;
		else totalMs += value * 24 * 60 * 60 * 1000;

		parts.push({ value, unit });
	}

	if (consumed.replace(/\s+/g, "") !== normalized.replace(/\s+/g, "")) return undefined;
	if (totalMs > 0) return { intervalMs: totalMs, intervalLabel: normalizeDurationLabel(parts) };
	return undefined;
}

type ExtractedFlags = {
	rest: string;
	name?: string;
	maxRuns?: number;
	quiet?: boolean;
	durable?: boolean;
	error?: "max" | "ref";
};

/**
 * Strip --name <slug>, --max <n>, --quiet from the input. Flags may appear
 * anywhere in the string. Returns the remaining text plus parsed flag values.
 */
function extractFlags(input: string): ExtractedFlags {
	const tokens = input.split(/\s+/).filter(Boolean);
	const rest: string[] = [];
	const out: ExtractedFlags = { rest: "" };

	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i]!;
		if (token === "--quiet" || token === "-q") {
			out.quiet = true;
			continue;
		}
		if (token === "--durable" || token === "-d") {
			out.durable = true;
			continue;
		}
		if (token === "--name") {
			const next = tokens[i + 1];
			if (!next) {
				out.error = "ref";
				continue;
			}
			out.name = next;
			i += 1;
			continue;
		}
		const nameEq = token.match(/^--name=(.+)$/);
		if (nameEq) {
			out.name = nameEq[1];
			continue;
		}
		if (token === "--max") {
			const next = tokens[i + 1];
			const n = next ? Number.parseInt(next, 10) : NaN;
			if (!Number.isFinite(n) || n <= 0) {
				out.error = "max";
				continue;
			}
			out.maxRuns = n;
			i += 1;
			continue;
		}
		const maxEq = token.match(/^--max=(.+)$/);
		if (maxEq) {
			const n = Number.parseInt(maxEq[1] ?? "", 10);
			if (!Number.isFinite(n) || n <= 0) {
				out.error = "max";
				continue;
			}
			out.maxRuns = n;
			continue;
		}
		rest.push(token);
	}

	out.rest = rest.join(" ");
	return out;
}

function classifyPayload(input: string): LoopPayloadKind {
	return input.trim().startsWith("/") ? "command" : "prompt";
}

function withDefaults(
	input: string,
	intervalMs: number,
	intervalLabel: string,
	flags: ExtractedFlags,
): ParsedSchedulerCommand {
	if (!input.trim()) return { type: "help", reason: "input" };
	if (flags.error === "max") return { type: "help", reason: "max" };
	return {
		type: "start",
		input: input.trim(),
		kind: classifyPayload(input),
		intervalMs,
		intervalLabel,
		name: flags.name,
		maxRuns: flags.maxRuns,
		quiet: flags.quiet,
		durable: flags.durable,
	};
}

export function parseSchedulerCommand(input: string): ParsedSchedulerCommand {
	const raw = input.trim();
	if (!raw) return { type: "help", reason: "empty" };

	const lower = raw.toLowerCase();
	if (lower === "help") return { type: "help" };
	if (lower === "list" || lower === "ls") return { type: "list" };
	if (lower === "clear" || lower === "stop all" || lower === "cancel all" || lower === "remove all") {
		return { type: "clear" };
	}

	// Subcommands taking a ref
	const subcommandRefs: Array<{ verbs: RegExp; type: ParsedSchedulerCommand["type"] }> = [
		{ verbs: /^(?:cancel|remove|delete|stop)\s+(.+)$/i, type: "cancel" },
		{ verbs: /^pause\s+(.+)$/i, type: "pause" },
		{ verbs: /^(?:resume|unpause)\s+(.+)$/i, type: "resume" },
		{ verbs: /^(?:run|now|trigger)\s+(.+)$/i, type: "run" },
		{ verbs: /^status\s+(.+)$/i, type: "status" },
	];
	for (const { verbs, type } of subcommandRefs) {
		const match = raw.match(verbs);
		if (match) {
			const ref = match[1]?.trim();
			if (!ref) return { type: "help", reason: "ref" };
			return { type, ref } as ParsedSchedulerCommand;
		}
	}

	// `status` with no ref → list (kept for muscle memory)
	if (lower === "status") return { type: "list" };

	// Otherwise it's a /loop start. Strip flags first.
	const flags = extractFlags(raw);
	const body = flags.rest;

	// every <duration> <input>
	const everyPrefix = body.match(/^every\s+(.+?)\s+(.+)$/i);
	if (everyPrefix) {
		const duration = parseDurationSpec(everyPrefix[1] ?? "");
		const scheduledInput = (everyPrefix[2] ?? "").trim();
		if (!duration) return { type: "help", reason: "interval" };
		return withDefaults(scheduledInput, duration.intervalMs, duration.intervalLabel, flags);
	}

	// <input> every <duration>
	const everySuffix = body.match(/^(.+?)\s+every\s+(.+)$/i);
	if (everySuffix) {
		const scheduledInput = (everySuffix[1] ?? "").trim();
		const duration = parseDurationSpec(everySuffix[2] ?? "");
		if (!duration) return { type: "help", reason: "interval" };
		return withDefaults(scheduledInput, duration.intervalMs, duration.intervalLabel, flags);
	}

	// <duration> <input>
	const firstToken = body.match(/^(\S+)\s+(.+)$/);
	if (firstToken) {
		const duration = parseDurationSpec(firstToken[1] ?? "");
		const scheduledInput = (firstToken[2] ?? "").trim();
		if (duration) {
			return withDefaults(scheduledInput, duration.intervalMs, duration.intervalLabel, flags);
		}
	}

	// fall through: default interval
	return withDefaults(body || raw, DEFAULT_INTERVAL_MS, DEFAULT_INTERVAL_LABEL, flags);
}

export function buildSchedulerHelp(reason?: "empty" | "interval" | "input" | "cancel" | "ref" | "max"): string {
	const lines: string[] = [];

	if (reason === "empty") lines.push("[Loop] Missing loop arguments.");
	if (reason === "interval") lines.push("[Loop] Invalid interval. Use seconds (10s), minutes (10m), hours (1h), or days (1d).");
	if (reason === "input") lines.push("[Loop] Missing scheduled prompt or slash command.");
	if (reason === "cancel") lines.push("[Loop] Missing task id or name to cancel.");
	if (reason === "ref") lines.push("[Loop] Missing task id or name.");
	if (reason === "max") lines.push("[Loop] --max requires a positive integer.");

	lines.push(
		"[Loop] Usage:",
		"  /loop check the build                       — schedule a prompt every 10m (default)",
		"  /loop 5m /grub status                       — slash command every 5 minutes",
		"  /loop every 10m Review test failures",
		"  /loop Drink water every 30m --name hydrate --max 8 --quiet",
		"  /loop Check build every 5m --durable        — persists across sessions",
		"",
		"[Loop] Manage:",
		"  /loop list                                  — show all scheduled loops",
		"  /loop status <ref>                          — detail one loop (ref = name or id)",
		"  /loop pause <ref> | resume <ref>",
		"  /loop run <ref>                             — fire immediately",
		"  /loop cancel <ref> | clear",
		"",
		"[Loop] Flags:",
		"  --name <slug>  — give the loop a friendly name",
		"  --max <n>      — auto-cancel after N runs",
		"  --quiet, -q    — suppress per-tick UI messages",
		"  --durable, -d  — persist loop across sessions",
		"",
		"[Loop] Notes:",
		"  - If no interval is provided, /loop defaults to every 10 minutes.",
		"  - By default, loops are session-scoped and run only while this session stays open.",
		"  - Use --durable to persist loops across sessions (saved to .nanopencil/loop-tasks.json).",
		"  - Due tasks wait until the agent is idle; missed intervals collapse to one pending run.",
		"  - --quiet suppresses tick messages but still records them via appendEntry.",
		"  - --max <n> auto-cancels the loop after N runs.",
	);

	return lines.join("\n");
}
