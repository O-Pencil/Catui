/**
 * [WHO]: Idempotent PR creation and exact-head, base and CI-gated autonomous merge
 * [FROM]: Local argv-only command adapter and durable job contracts
 * [TO]: Source evolution supervisor
 * [HERE]: extensions/optional/evolution/source/delivery/github.ts - GitHub mutation owner
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunCommand, SourceConfig, SourceJob } from "../types.js";
import { checked } from "../runtime/process.js";
import { sanitize } from "../runtime/observer.js";

export interface PullRequest {
	number: number; state: string; headRefOid: string; baseRefOid: string; isDraft: boolean;
	mergeable: string; reviewDecision?: string; mergeCommit?: { oid: string };
	statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string }[];
}
export function mergeReady(pr: PullRequest, job: SourceJob, checks: string[]): boolean {
	if (!job.head || !job.base || pr.state !== "OPEN" || pr.isDraft || pr.headRefOid !== job.head || pr.baseRefOid !== job.base || pr.mergeable !== "MERGEABLE") return false;
	if (pr.reviewDecision === "CHANGES_REQUESTED" || pr.reviewDecision === "REVIEW_REQUIRED") return false;
	return checksPassed(pr, checks);
}
export function checksPassed(pr: PullRequest, checks: string[]): boolean {
	const rollup = pr.statusCheckRollup ?? [];
	const success = (c: PullRequest["statusCheckRollup"][number]) => c.conclusion === "SUCCESS" || c.state === "SUCCESS";
	return checks.every(name => rollup.some(c => (c.name ?? c.context) === name && success(c)))
		&& rollup.every(success);
}
export async function submitPullRequest(run: RunCommand, root: string, config: SourceConfig, job: SourceJob): Promise<void> {
	if (!job.head || !job.version) throw new Error("Cannot publish an unverified candidate");
	await mkdir(join(root, "jobs"), { recursive: true });
	const body = join(root, "jobs", `${job.id}-pr.md`);
	await writeFile(body, `Catui source evolution found a repeated execution issue and produced a focused fix.\n\n${job.title}\n\nValidation:\n- Frozen regression: ${job.testPath}; assertion failure on baseline ${job.base}, success on candidate ${job.head}.\n- Independent read-only model review accepted reproduction, behavior preservation and publication scope.\n- DIP, quality, package boundary, build, type check and critical harness checks passed.\n- Candidate version: ${job.version}.\n\nEvidence reference: ${job.fingerprint} (raw usage records remain local).\n\nThis PR is eligible for policy-driven merge and release after required CI checks. Real-world effectiveness remains unproven until post-adoption measurement.\n`, { mode: 0o600 });
	const list = JSON.parse(await checked(run, "gh", ["pr", "list", "--repo", config.repository, "--head", job.branch, "--state", "all", "--json", "number,headRefOid,state"], { cwd: job.checkout })) as PullRequest[];
	if (list.length) {
		if (list.length !== 1) throw new Error("Remote branch identity conflict");
		if (list[0].headRefOid !== job.head) {
			if (!job.previousHead || list[0].headRefOid !== job.previousHead || list[0].state !== "OPEN") throw new Error("Remote branch identity conflict");
			await checked(run, "git", ["push", `--force-with-lease=refs/heads/${job.branch}:${job.previousHead}`, "origin", `${job.head}:refs/heads/${job.branch}`], { cwd: job.checkout, timeoutMs: 180000 });
		}
		job.pr = list[0].number;
		if (list[0].state === "OPEN") await checked(run, "gh", ["pr", "edit", String(job.pr), "--repo", config.repository, "--title", `fix(evolution): ${job.title}`, "--body-file", body], { cwd: job.checkout });
		job.stage = "submitted"; return;
	}
	await checked(run, "git", ["push", "origin", `${job.head}:refs/heads/${job.branch}`], { cwd: job.checkout, timeoutMs: 180000 });
	await checked(run, "gh", ["pr", "create", "--repo", config.repository, "--base", config.branch, "--head", job.branch, "--title", `fix(evolution): ${job.title}`, "--body-file", body], { cwd: job.checkout, timeoutMs: 180000 });
	const created = JSON.parse(await checked(run, "gh", ["pr", "view", job.branch, "--repo", config.repository, "--json", "number"], { cwd: job.checkout }));
	job.pr = created.number; job.stage = "submitted";
}
export async function reconcilePullRequest(run: RunCommand, config: SourceConfig, job: SourceJob): Promise<void> {
	const fields = "number,state,headRefOid,baseRefOid,isDraft,mergeable,reviewDecision,mergeCommit,statusCheckRollup";
	const view = async () => JSON.parse(await checked(run, "gh", ["pr", "view", String(job.pr), "--repo", config.repository, "--json", fields], { cwd: job.checkout })) as PullRequest;
	let pr = await view();
	if (pr.headRefOid !== job.head) throw new Error("PR head changed after verification; automatic delivery stopped");
	if (pr.state === "CLOSED") { job.stage = "rejected"; job.lastResult = "PR closed without merge"; return; }
	if (pr.state === "OPEN" && pr.baseRefOid !== job.base) {
		job.revisions = (job.revisions ?? 0) + 1;
		if (job.revisions > config.maxAttempts) { job.stage = "failed"; job.lastResult = "Upstream changed repeatedly; automatic revision budget exhausted"; return; }
		job.previousHead = job.head; job.stage = "queued";
		job.lastResult = "Upstream changed; rebuilding reproduction and verification on current base";
		return;
	}
	if (pr.state === "OPEN" && pr.statusCheckRollup.some(c => c.conclusion === "FAILURE" || c.state === "FAILURE")) {
		job.revisions = (job.revisions ?? 0) + 1;
		if (job.revisions > config.maxAttempts) { job.stage = "failed"; job.lastResult = "CI repair revision budget exhausted"; return; }
		const runs = JSON.parse(await checked(run, "gh", ["run", "list", "--repo", config.repository, "--branch", job.branch, "--commit", job.head!, "--json", "databaseId,conclusion", "--limit", "10"], { cwd: job.checkout })) as { databaseId: number; conclusion: string }[];
		const failed = runs.find(r => r.conclusion === "failure");
		job.error = failed ? sanitize(await checked(run, "gh", ["run", "view", String(failed.databaseId), "--repo", config.repository, "--log-failed"], { cwd: job.checkout })) : "Remote CI failed; inspect environment-sensitive behavior";
		job.previousHead = job.head; job.stage = "prepared";
		job.lastResult = "CI failure returned to repair with frozen reproduction preserved";
		return;
	}
	if (pr.state !== "MERGED" && config.autoMerge && mergeReady(pr, job, config.requiredChecks)) {
		await checked(run, "gh", ["pr", "merge", String(job.pr), "--repo", config.repository, "--squash", "--match-head-commit", job.head!], { cwd: job.checkout });
		pr = await view();
	}
	if (pr.state === "MERGED") {
		if (!checksPassed(pr, config.requiredChecks)) { job.lastResult = "Merged upstream; waiting for configured CI acceptance before publication"; return; }
		if (!pr.mergeCommit?.oid) throw new Error("Merged PR has no commit identity");
		job.merge = pr.mergeCommit.oid; job.stage = "merged";
	} else {
		job.lastResult = pr.baseRefOid !== job.base ? "Upstream base changed; candidate must be regenerated and reverified" : "Waiting for required CI/repository review rules";
	}
}
