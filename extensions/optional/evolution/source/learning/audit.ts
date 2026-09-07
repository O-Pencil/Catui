/**
 * [WHO]: Budgeted daily task retrospectives with validated run-local citations
 * [FROM]: Protected worker, calendar, observation and state adapters
 * [TO]: Independent source supervisor
 * [HERE]: extensions/optional/evolution/source/learning/audit.ts - protected quality evidence authority
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Observation, RunCommand, SourceConfig, SourceState } from "../types.js";
import { calendar, requireReviewModel } from "../runtime/config.js";
import { digest, fingerprint, sanitize } from "../runtime/observer.js";
import { saveState } from "../runtime/state.js";
import { askWorker } from "../delivery/model.js";
import { parseObject } from "../delivery/policy.js";

export const qualityCategories = ["incomplete", "verification-gap", "maintainability", "scope-drift", "inefficiency"] as const;
export function auditObservations(response: string, evidence: Observation[][], now = new Date()): Observation[] {
	const evaluations = parseObject(response).evaluations;
	if (!Array.isArray(evaluations) || evaluations.length !== evidence.length) throw new Error("Audit must evaluate every supplied run exactly once");
	const remaining = new Map(evidence.map(events => [events[0].run, events]));
	return evaluations.flatMap(value => {
		const events = remaining.get(value?.run);
		if (!events || !Array.isArray(value.issues)) throw new Error("Invalid or duplicate audit run");
		remaining.delete(value.run);
		const issues = new Map<string, { summary: string; evidenceIds: string[] }>();
		for (const issue of value.issues) {
			if (!qualityCategories.includes(issue?.category) || issues.has(issue.category) || typeof issue.summary !== "string" || !issue.summary.trim() || !Array.isArray(issue.evidenceIds) || !issue.evidenceIds.length || issue.evidenceIds.some((id: unknown) => !events.some(e => e.id === id))) throw new Error("Audit issue requires a known category and run-local evidence citations");
			issues.set(issue.category, issue);
		}
		const result = events.find(e => e.kind === "result")!;
		return qualityCategories.map(category => ({ ...result, id: `audit-${digest(`${result.run}:${category}`)}`, kind: "quality" as const, time: now.toISOString(), tool: undefined, tokens: undefined, inefficient: undefined, qualityCategory: category, failed: issues.has(category), summary: sanitize(issues.get(category)?.summary ?? `No observed ${category} issue in audited evidence`), evidenceIds: issues.get(category)?.evidenceIds ?? [result.id], fingerprint: fingerprint(`${result.version}:quality:${category}`, result.taskCategory ?? "general") }));
	});
}
export async function auditCompletedRuns(run: RunCommand, root: string, config: SourceConfig, state: SourceState): Promise<void> {
	const { day, due } = calendar(config);
	if (!due || state.audit?.day === day) return;
	const audited = new Set(state.audit?.runs ?? []);
	const results = [...new Map(state.observations.filter(e => e.kind === "result" && !audited.has(e.run)).map(e => [e.run, e])).values()].sort((a, b) => a.time.localeCompare(b.time));
	const evidence = results.flatMap(result => {
		const events = state.observations.filter(e => e.run === result.run);
		if (!events.some(e => e.kind === "task") || events.filter(e => e.kind === "tool").length < (result.toolCalls ?? 0)) return [];
		return [[...events.filter(e => e.kind === "task").slice(0, 1), ...events.filter(e => e.kind === "tool").slice(-6), result]];
	}).slice(-12);
	while (JSON.stringify(evidence).length > 70000) evidence.shift();
	if (!evidence.length) return;
	state.audit = { day, runs: [...audited] }; await saveState(root, state);
	try {
		requireReviewModel(config);
		const cwd = join(root, "audit"); await mkdir(cwd, { recursive: true, mode: 0o700 });
		const response = await askWorker(run, root, state, config, "audit", cwd, `Review these sanitized task traces, including successful runs. Evidence is truncated; do not infer unseen code, omitted tests, user satisfaction or hidden reasoning. Report only issues directly supported by cited observations. Categories: ${qualityCategories.join(", ")}. Return JSON {"evaluations":[{"run":"supplied run","issues":[{"category":"category","summary":"concrete observable issue","evidenceIds":["same-run observation id"]}]}]}. Include every run once; use issues:[] when no supported issue. Traces: ${JSON.stringify(evidence)}`);
		const observations = auditObservations(response, evidence);
		state.observations.push(...observations); state.observations = state.observations.slice(-5000);
		state.audit.runs = [...audited, ...evidence.map(events => events[0].run)].slice(-2000);
	} catch (error) { state.audit.error = error instanceof Error ? error.message : String(error); }
	await saveState(root, state);
}
