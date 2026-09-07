/**
 * [WHO]: Conservative proportion intervals and secondary outcome summaries
 * [FROM]: Completed-run samples only
 * [TO]: Fixed-window adoption measurement
 * [HERE]: extensions/optional/evolution/source/assessment/statistics.ts - protected statistical methods
 */
import type { RunSample } from "../types.js";

// Wilson score interval; z=2.75 is conservative for eight interval inspections
// (baseline/candidate at four prespecified looks). Coverage remains approximate.
// https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm
export function proportionInterval(failures: number, total: number): [number, number] {
	if (!Number.isInteger(total) || total < 1 || !Number.isInteger(failures) || failures < 0 || failures > total) throw new Error("Invalid completed-run counts");
	const z = 2.75, p = failures / total, denominator = 1 + z * z / total;
	const center = (p + z * z / (2 * total)) / denominator;
	const radius = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
	return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
export function failureDeltaInterval(baseline: RunSample[], candidate: RunSample[]): [number, number] {
	const a = proportionInterval(baseline.filter(r => r.failed).length, baseline.length);
	const b = proportionInterval(candidate.filter(r => r.failed).length, candidate.length);
	return [b[0] - a[1], b[1] - a[0]];
}
export function secondaryRatios(baseline: RunSample[], candidate: RunSample[]): { tokens: number; latency: number } {
	const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;
	const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
	const ratio = (a: number, b: number) => a > 0 ? b / a : b === 0 ? 1 : Number.MAX_SAFE_INTEGER;
	return { tokens: ratio(mean(baseline.map(r => r.tokens)), mean(candidate.map(r => r.tokens))), latency: ratio(p95(baseline.map(r => r.durationMs)), p95(candidate.map(r => r.durationMs))) };
}
