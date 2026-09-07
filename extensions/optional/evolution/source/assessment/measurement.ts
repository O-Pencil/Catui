/**
 * [WHO]: Completed-run cohort matching, fixed measurement windows and evidence-based rollback
 * [FROM]: Local source observations, protected statistics and installation state
 * [TO]: Supervisor enqueue and adopted-job reconciliation
 * [HERE]: extensions/optional/evolution/source/assessment/measurement.ts - observational acceptance owner
 */
import { join } from "node:path";
import type { Observation, RunSample, SourceConfig, SourceJob, SourceState } from "../types.js";
import { atomicJson } from "../runtime/state.js";
import { readInstalled } from "../runtime/install-state.js";
import { failureDeltaInterval, secondaryRatios } from "./statistics.js";

export function collectRuns(observations: Observation[], anchor: Observation, version: string, metric: SourceJob["metric"], after = ""): RunSample[] {
	const groups = new Map<string, Observation[]>();
	for (const event of observations) {
		if (event.version !== version || event.model !== anchor.model || event.workspace !== anchor.workspace) continue;
		const group = groups.get(event.run) ?? []; group.push(event); groups.set(event.run, group);
	}
	return [...groups.values()].flatMap(events => {
		const result = events.find(e => e.kind === "result");
		if (!result || result.time < after || !result.taskCategory || !result.inputBucket) return [];
		if ((result.toolCalls ?? 0) > events.filter(e => e.kind === "tool").length) return [];
		if ((result.turns ?? 0) > events.filter(e => e.kind === "usage" && Number.isFinite(e.tokens)).length) return [];
		const targets = events.filter(e => e.kind === anchor.kind && e.tool === anchor.tool && e.qualityCategory === anchor.qualityCategory);
		if (!targets.length) return [];
		return [{ run: result.run, stratum: JSON.stringify([result.taskCategory, result.inputBucket, result.model, result.workspace]), failed: targets.some(e => metric === "inefficiency" ? e.inefficient === true : e.failed), tokens: events.filter(e => e.kind === "usage").reduce((sum, e) => sum + (Number.isFinite(e.tokens) ? Math.max(0, e.tokens!) : 0), 0), durationMs: Number.isFinite(result.durationMs) ? Math.max(0, result.durationMs!) : 0, usageKnown: events.some(e => e.kind === "usage" && Number.isFinite(e.tokens)) && Number.isFinite(result.durationMs) }];
	});
}
export function matchRuns(baseline: RunSample[], candidate: RunSample[]): { baseline: RunSample[]; candidate: RunSample[] } {
	const matched = { baseline: [] as RunSample[], candidate: [] as RunSample[] };
	const pairs: { baseline: RunSample[]; candidate: RunSample[] }[] = [];
	for (const stratum of [...new Set(baseline.map(r => r.stratum))].sort()) {
		const a = baseline.filter(r => r.stratum === stratum), b = candidate.filter(r => r.stratum === stratum);
		const n = Math.min(a.length, b.length);
		pairs.push({ baseline: a.slice(0, n), candidate: b.slice(0, n) });
	}
	for (let i = 0; pairs.some(pair => i < pair.baseline.length); i++) for (const pair of pairs) {
		if (i < pair.baseline.length) { matched.baseline.push(pair.baseline[i]); matched.candidate.push(pair.candidate[i]); }
	}
	return matched;
}
export async function measureAdoption(root: string, state: SourceState, config: SourceConfig, job: SourceJob): Promise<void> {
	const anchor = job.evidence.find(e => e.failed || e.inefficient);
	if (!job.adoptedAt || !job.version || !anchor) return;
	if (!job.baselineRuns?.length) { job.lastResult = "Inconclusive: no frozen completed-run baseline for this legacy job"; return; }
	const accumulated = new Map((job.observedRuns ?? []).map(r => [r.run, r]));
	for (const sample of collectRuns(state.observations, anchor, job.version, job.metric, job.adoptedAt)) accumulated.set(sample.run, sample);
	const capacity = new Map<string, number>();
	for (const baseline of job.baselineRuns) capacity.set(baseline.stratum, (capacity.get(baseline.stratum) ?? 0) + 1);
	job.observedRuns = [...accumulated.values()].filter(r => {
		const remaining = capacity.get(r.stratum) ?? 0;
		if (!remaining) return false;
		capacity.set(r.stratum, remaining - 1); return true;
	}).slice(0, config.measurementSamples * 8);
	const matched = matchRuns(job.baselineRuns, job.observedRuns);
	job.measuredCount = matched.candidate.length;
	const look = job.measurementLook ?? 0;
	if (look >= 4) { job.lastResult = "Inconclusive: all four prespecified measurement windows exhausted"; return; }
	const needed = config.measurementSamples * 2 ** look;
	if (matched.candidate.length < needed) { job.lastResult = `Inconclusive: ${matched.candidate.length}/${needed} matched completed runs for window ${look + 1}`; return; }
	const a = matched.baseline.slice(0, needed), b = matched.candidate.slice(0, needed);
	job.measurementLook = look + 1;
	job.measurementInterval = failureDeltaInterval(a, b);
	job.baselineRate = a.filter(r => r.failed).length / needed; job.measuredRate = b.filter(r => r.failed).length / needed;
	const ratios = secondaryRatios(a, b); job.measurementTokensRatio = ratios.tokens; job.measurementLatencyRatio = ratios.latency;
	const [lower, upper] = job.measurementInterval;
	const noStratumRegression = [...new Set(a.map(r => r.stratum))].every(stratum => {
		const old = a.filter(r => r.stratum === stratum), current = b.filter(r => r.stratum === stratum);
		return current.filter(r => r.failed).length / current.length <= old.filter(r => r.failed).length / old.length;
	});
	if (lower > config.regressionMargin) {
		const installed = await readInstalled(root);
		if (installed?.job === job.id) await atomicJson(join(root, "current.json"), installed.previous ?? null);
		job.stage = "regressed"; job.lastResult = "Matched completed-run interval indicates regression; current managed version rolled back. Observational evidence, not causal proof.";
	} else if (upper < 0 && noStratumRegression && [...a, ...b].every(r => r.usageKnown) && ratios.tokens <= 1.1 && ratios.latency <= 1.1) {
		job.stage = "effective"; job.lastResult = "Matched-run interval supports improvement without observed token/latency regression; observational evidence, not causal proof";
	} else job.lastResult = "Inconclusive: interval overlaps no improvement or token/latency guardrail regressed; wait for the next fixed window";
}
