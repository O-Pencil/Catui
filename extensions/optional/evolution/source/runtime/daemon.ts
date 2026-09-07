/**
 * [WHO]: Single durable supervisor coordinating live ingestion and autonomous delivery
 * [FROM]: Local observation, state and delivery adapters
 * [TO]: evolve daemon/run CLI; never runs in the interactive process
 * [HERE]: extensions/optional/evolution/source/runtime/daemon.ts - recursive lifecycle owner
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { calendar, loadConfig, requireReviewModel } from "./config.js";
import { auditCompletedRuns } from "../learning/audit.js";
import { collectRuns } from "../assessment/measurement.js";
import { atomicJson, loadState, saveState, supervisorLease } from "./state.js";
import { ingest, selectEvidence } from "./observer.js";
import { runCommand } from "./process.js";
import { prepareCandidate, repairCandidate } from "../delivery/repair.js";
import { submitPullRequest, reconcilePullRequest } from "../delivery/github.js";
import { publishCandidate } from "../delivery/release.js";
import { adoptCandidate, measureAdoption } from "../delivery/adoption.js";
import type { RunCommand, SourceConfig, SourceJob, SourceState } from "../types.js";

export async function advanceJob(run: RunCommand, root: string, config: SourceConfig, state: SourceState, job: SourceJob): Promise<void> {
	switch (job.stage) {
		case "queued": await prepareCandidate(run, root, config, state, job); break;
		case "prepared": if (!job.holdout) { job.stage = "queued"; break; } await repairCandidate(run, root, config, state, job); break;
		case "verified": await submitPullRequest(run, root, config, job); break;
		case "submitted": await reconcilePullRequest(run, config, job); break;
		case "merged": await publishCandidate(run, root, config, state, job); break;
		case "published": await adoptCandidate(run, root, config, job); break;
		case "adopted": await measureAdoption(root, state, config, job); break;
	}
}
export function enqueue(state: SourceState, config: SourceConfig, root: string, now = new Date()): SourceJob | undefined {
	const { day, due } = calendar(config, now);
	if (!due || state.paused) return;
	if (state.jobs.some(j => !["effective", "regressed", "rejected", "failed", "adopted"].includes(j.stage))) return;
	const budget = state.budgets[day] ??= { calls: 0, jobs: 0 };
	if (budget.jobs >= config.maxJobsPerDay || budget.calls + 5 > config.maxWorkerRunsPerDay) return;
	const evidence = selectEvidence(state, config);
	if (!evidence) return;
	requireReviewModel(config);
	const failure = evidence.find(e => e.failed || e.inefficient)!;
	const metric = failure.kind === "quality" ? "quality" : failure.failed ? "failure" : "inefficiency";
	const cohort = state.observations.filter(e => e.kind === failure.kind && e.tool === failure.tool && e.model === failure.model && e.workspace === failure.workspace && e.version === failure.version);
	const id = `${day}-${randomUUID().slice(0, 8)}`;
	const job: SourceJob = { id, day, stage: "queued", createdAt: now.toISOString(), evidence, fingerprint: failure.fingerprint, title: "Investigating repeated execution issue", branch: `evolution/${id}`, checkout: join(root, "jobs", id), attempts: 0, metric, baselineRate: cohort.filter(e => metric === "failure" ? e.failed : e.inefficient).length / cohort.length, baselineCount: cohort.length };
	state.jobs.push(job); budget.jobs++;
	job.baselineRuns = collectRuns(state.observations, failure, failure.version, metric).slice(-config.measurementSamples * 8);
	return job;
}
export async function deliveryTick(root: string, state: SourceState, config: SourceConfig, run: RunCommand = runCommand): Promise<void> {
	if (!config.enabled || state.paused) return;
	await auditCompletedRuns(run, root, config, state);
	try { enqueue(state, config, root); state.error = undefined; }
	catch (error) { state.error = error instanceof Error ? error.message : String(error); }
	await saveState(root, state);
	for (const job of state.jobs) {
		if (job.retryAfter && Date.parse(job.retryAfter) > Date.now()) continue;
		if (["effective", "regressed", "rejected", "failed"].includes(job.stage)) continue;
		const before = job.stage;
		try {
			await advanceJob(run, root, config, state, job);
			if (job.stage !== before) { job.attempts = 0; if (job.stage !== "prepared") job.error = undefined; }
			job.retryAfter = undefined;
		} catch (error) {
			job.error = error instanceof Error ? error.message : String(error);
			const budget = job.error.includes("budget exhausted");
			if (!budget) job.attempts++;
			job.retryAfter = new Date(Date.now() + (budget ? 3600000 : 300000)).toISOString();
			if (job.attempts >= config.maxAttempts) {
				if (["queued", "prepared"].includes(job.stage) || /changed after|identity conflict|integrity mismatch|different artifact/.test(job.error)) job.stage = "failed";
				else { job.attempts = 0; job.retryAfter = new Date(Date.now() + 86400000).toISOString(); }
			}
		}
		await saveState(root, state);
	}
}
export async function runSupervisor(root: string, once = false, signal?: AbortSignal): Promise<void> {
	const release = await supervisorLease(root);
	const state = await loadState(root);
	await atomicJson(join(root, "process.json"), { pid: process.pid, startedAt: new Date().toISOString() });
	let ingesting = false;
	const observe = async () => {
		if (ingesting) return;
		ingesting = true;
		try { await ingest(root, state); state.heartbeat = new Date().toISOString(); await saveState(root, state); }
		catch (e) { state.error = e instanceof Error ? e.message : String(e); }
		finally { ingesting = false; }
	};
	const timer = setInterval(() => { void observe(); }, 5000);
	try {
		do {
			await observe();
			const config = loadConfig(root);
			if (!config) throw new Error("Run catui evolve init before starting the supervisor");
			await deliveryTick(root, state, config);
			if (once || signal?.aborted) break;
			await delay(30000, undefined, { signal }).catch(() => {});
		} while (!signal?.aborted);
	} finally { clearInterval(timer); while (ingesting) await delay(10); await saveState(root, state); await release(); }
}
