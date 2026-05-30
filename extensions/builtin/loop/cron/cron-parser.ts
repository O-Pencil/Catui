/**
 * [WHO]: parseCronExpression, nextCronRunMs, jitteredNextCronRunMs, oneShotJitteredNextCronRunMs
 * [FROM]: Depends on ./cron-types
 * [TO]: Consumed by cron-tasks.ts, cron-scheduler.ts, cron tools
 * [HERE]: extensions/builtin/loop/cron/cron-parser.ts - standard 5-field cron parsing and next-run calculation
 */

import type { ParsedCron } from "./cron-types.js";

/**
 * Parse a standard 5-field cron expression.
 * Fields: minute hour day-of-month month day-of-week
 *
 * Supports: star (any value), star-slash-N (every N),
 * single value, comma-separated list, and range.
 *
 * Returns null if expression is invalid.
 */
export function parseCronExpression(expr: string): ParsedCron | null {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) return null;

	const minute = parseField(parts[0]!, 0, 59);
	if (!minute) return null;

	const hour = parseField(parts[1]!, 0, 23);
	if (!hour) return null;

	const dayOfMonth = parseField(parts[2]!, 1, 31);
	if (!dayOfMonth) return null;

	const month = parseField(parts[3]!, 1, 12);
	if (!month) return null;

	const dayOfWeek = parseField(parts[4]!, 0, 6);
	if (!dayOfWeek) return null;

	return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function parseField(field: string, min: number, max: number): Set<number> | null {
	const result = new Set<number>();

	for (const part of field.split(",")) {
		const parsed = parsePart(part.trim(), min, max);
		if (!parsed) return null;
		for (const v of parsed) result.add(v);
	}

	return result.size > 0 ? result : null;
}

function parsePart(part: string, min: number, max: number): number[] | null {
	// Wildcard: * (all values)
	if (part === "*") {
		const result: number[] = [];
		for (let i = min; i <= max; i++) result.push(i);
		return result;
	}

	// Step: */N
	const stepMatch = part.match(/^\*\/(\d+)$/);
	if (stepMatch) {
		const step = Number.parseInt(stepMatch[1]!, 10);
		if (step <= 0 || step > max) return null;
		const result: number[] = [];
		for (let i = min; i <= max; i += step) result.push(i);
		return result;
	}

	// Range with step: N-M/S
	const rangeStepMatch = part.match(/^(\d+)-(\d+)\/(\d+)$/);
	if (rangeStepMatch) {
		const start = Number.parseInt(rangeStepMatch[1]!, 10);
		const end = Number.parseInt(rangeStepMatch[2]!, 10);
		const step = Number.parseInt(rangeStepMatch[3]!, 10);
		if (start < min || end > max || step <= 0 || start > end) return null;
		const result: number[] = [];
		for (let i = start; i <= end; i += step) result.push(i);
		return result;
	}

	// Range: N-M
	const rangeMatch = part.match(/^(\d+)-(\d+)$/);
	if (rangeMatch) {
		const start = Number.parseInt(rangeMatch[1]!, 10);
		const end = Number.parseInt(rangeMatch[2]!, 10);
		if (start < min || end > max || start > end) return null;
		const result: number[] = [];
		for (let i = start; i <= end; i++) result.push(i);
		return result;
	}

	// Single value: N
	const num = Number.parseInt(part, 10);
	if (Number.isNaN(num) || num < min || num > max) return null;
	return [num];
}

/**
 * Calculate the next fire time in milliseconds from a given timestamp.
 * Returns null if no next run can be found within 1 year.
 */
export function nextCronRunMs(cron: string, fromMs: number): number | null {
	const parsed = parseCronExpression(cron);
	if (!parsed) return null;

	const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000;
	const start = new Date(fromMs);

	// Search minute-by-minute for the next match (brute force but reliable)
	// For performance, we jump to next candidate minutes
	let current = new Date(start);
	current.setSeconds(0, 0);
	current.setMinutes(current.getMinutes() + 1); // Start from next minute

	const maxDate = new Date(fromMs + ONE_YEAR_MS);

	while (current <= maxDate) {
		if (matchesCron(parsed, current)) {
			return current.getTime();
		}
		current.setMinutes(current.getMinutes() + 1);
	}

	return null;
}

/**
 * Calculate next fire time for recurring tasks with jitter.
 * Uses baseTime (lastFiredAt or createdAt) as reference.
 */
export function jitteredNextCronRunMs(
	cron: string,
	baseTimeMs: number,
	taskId: string,
	jitterMs = 60_000,
): number | null {
	const next = nextCronRunMs(cron, baseTimeMs);
	if (next === null) return null;

	// Add deterministic jitter based on task ID
	const jitter = deterministicJitter(taskId, jitterMs);
	return next + jitter;
}

/**
 * Calculate next fire time for one-shot tasks with jitter.
 */
export function oneShotJitteredNextCronRunMs(
	cron: string,
	createdAtMs: number,
	taskId: string,
	jitterMs = 60_000,
): number | null {
	const next = nextCronRunMs(cron, createdAtMs);
	if (next === null) return null;

	const jitter = deterministicJitter(taskId, jitterMs);
	return next + jitter;
}

/**
 * Deterministic jitter from task ID.
 * Same task ID always produces the same jitter offset.
 */
function deterministicJitter(taskId: string, maxJitterMs: number): number {
	// Use first 8 chars of task ID as seed
	const seedHex = taskId.slice(0, 8);
	if (seedHex.length < 8) return 0;

	const seed = parseInt(seedHex, 16);
	if (isNaN(seed)) return 0;

	// Normalize to [0, 1)
	const normalized = (seed >>> 0) / 0x1_0000_0000;
	return Math.floor(normalized * maxJitterMs);
}

/**
 * Check if a date matches a parsed cron expression.
 */
function matchesCron(parsed: ParsedCron, date: Date): boolean {
	if (!parsed.minute.has(date.getMinutes())) return false;
	if (!parsed.hour.has(date.getHours())) return false;
	if (!parsed.dayOfMonth.has(date.getDate())) return false;
	if (!parsed.month.has(date.getMonth() + 1)) return false;
	if (!parsed.dayOfWeek.has(date.getDay())) return false;
	return true;
}

/**
 * Convert interval string (e.g., "5m", "1h", "30s") to cron expression.
 * Supports s, m, h, d units.
 *
 * Mapping examples:
 * 5m -> minute-every-5
 * 30m -> minute-every-30
 * 1h -> hour-every-1
 * 1d -> daily-at-midnight
 * 30s -> rounds up to 1m minimum
 */
export function intervalToCron(interval: string): string | null {
	const match = interval.match(/^(\d+)(s|m|h|d)$/i);
	if (!match) return null;

	const value = Number.parseInt(match[1]!, 10);
	const unit = match[2]!.toLowerCase();

	if (!Number.isFinite(value) || value <= 0) return null;

	switch (unit) {
		case "s": {
			// Seconds: round up to at least 1 minute
			const minutes = Math.max(1, Math.ceil(value / 60));
			return `*/${minutes} * * * *`;
		}
		case "m": {
			if (value >= 60) {
				const hours = Math.floor(value / 60);
				const remaining = value % 60;
				if (remaining === 0) {
					return `0 */${hours} * * *`;
				}
				// For non-hour-aligned minutes, use minute field
				return `*/${value} * * * *`;
			}
			return `*/${value} * * * *`;
		}
		case "h": {
			if (value >= 24) {
				const days = Math.floor(value / 24);
				return `0 0 */${days} * *`;
			}
			return `0 */${value} * * *`;
		}
		case "d": {
			return `0 0 */${value} * *`;
		}
		default:
			return null;
	}
}
