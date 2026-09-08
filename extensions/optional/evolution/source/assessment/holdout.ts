/**
 * [WHO]: Private reviewer-generated generalization/compatibility tests and source overlay verification
 * [FROM]: Protected process, model, policy, sandbox and persistence adapters
 * [TO]: Source repair and merged-release acceptance
 * [HERE]: extensions/optional/evolution/source/assessment/holdout.ts - independent executable evidence
 */
import { mkdir, readFile, copyFile, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { RunCommand, SourceConfig, SourceJob, SourceState } from "../types.js";
import { checked } from "../runtime/process.js";
import { requireReviewModel } from "../runtime/config.js";
import { digest } from "../runtime/observer.js";
import { saveState } from "../runtime/state.js";
import { askWorker } from "../delivery/model.js";
import { verificationRunner } from "../delivery/sandbox.js";
import lockfile from "proper-lockfile";

export async function prepareHoldout(run: RunCommand, root: string, config: SourceConfig, state: SourceState, job: SourceJob, hypothesis: string): Promise<void> {
	const model = requireReviewModel(config);
	const cwd = join(root, "holdouts", job.id); await mkdir(dirname(cwd), { recursive: true, mode: 0o700 });
	if (!existsSync(join(cwd, ".git"))) await checked(run, "git", ["clone", "--no-hardlinks", "--no-checkout", job.checkout, cwd], { cwd: root });
	if (await lockfile.check(cwd, { lockfilePath: `${cwd}.evolution-worker.lock`, stale: 30000 })) throw new Error("Held-out worker is still active");
	await checked(run, "git", ["fetch", "origin"], { cwd });
	await checked(run, "git", ["checkout", "--detach", job.base!], { cwd });
	await checked(run, "git", ["reset", "--hard", job.base!], { cwd });
	await checked(run, "git", ["clean", "-fd"], { cwd });
	await checked(run, "npm", ["ci", "--ignore-scripts"], { cwd, timeoutMs: 600000 });
	await checked(run, "npm", ["run", "build:deps"], { cwd, timeoutMs: 600000 });
	const regression = `test/source-evolution-${job.id}-holdout.test.ts`;
	const compatibility = regression.replace(/\.test\.ts$/, ".compat.test.ts");
	await askWorker(run, root, state, config, "holdout", cwd,
		`You own independent hidden tests. This is an untouched baseline checkout; no candidate patch or visible reproduction is provided. Read source to assess: ${hypothesis}. Write exactly two node:test files. ${regression}: test distinct boundary/generalization cases of this defect; must fail on baseline with an assertion and should pass for a general fix. ${compatibility}: exercise adjacent already-correct behavior and stable API contracts; must pass on baseline and remain passing after a fix. Both must invoke production code, not source-text matching, version detection, environment mutation, subprocesses or manufactured failures. The repair worker cannot see these files. Include meaningful assertions and P3 headers. Return a short explanation.`, regression);
	const changes = ((await checked(run, "git", ["diff", "--name-only", "-z"], { cwd })) + "\0" + (await checked(run, "git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd }))).split("\0").filter(Boolean);
	if (changes.length !== 2 || changes.some(p => ![regression, compatibility].includes(p))) throw new Error("Held-out writer changed files outside its two tests");
	for (const path of [regression, compatibility]) if (!(await lstat(join(cwd, path))).isFile()) throw new Error("Held-out tests must be regular files");
	job.holdout = { checkout: cwd, regression, compatibility, regressionHash: digest(await readFile(join(cwd, regression), "utf8")), compatibilityHash: digest(await readFile(join(cwd, compatibility), "utf8")), model };
	const verify = verificationRunner(run, [regression, compatibility]);
	const negative = await verify(process.execPath, ["--test", "--import", "tsx", regression], { cwd, timeoutMs: 120000, log: join(root, "logs", `${job.id}-holdout-baseline.json`) });
	if (negative.code !== 1 || !/ERR_ASSERTION|AssertionError/.test(negative.stdout + negative.stderr)) throw new Error("Independent generalization test must reproduce baseline assertion failure");
	await checked(verify, process.execPath, ["--test", "--import", "tsx", compatibility], { cwd, timeoutMs: 120000, log: join(root, "logs", `${job.id}-compatibility-baseline.json`) });
	await assertFrozen(job);
	await saveState(root, state);
}
async function assertFrozen(job: SourceJob): Promise<void> {
	const h = job.holdout;
	if (!h || digest(await readFile(join(h.checkout, h.regression), "utf8")) !== h.regressionHash || digest(await readFile(join(h.checkout, h.compatibility), "utf8")) !== h.compatibilityHash) throw new Error("Independent held-out contract changed after freezing");
}
export async function verifyHoldout(run: RunCommand, root: string, job: SourceJob, candidate = job.checkout): Promise<boolean> {
	await assertFrozen(job);
	const h = job.holdout!;
	const cwd = h.checkout;
	await checked(run, "git", ["reset", "--hard", job.base!], { cwd });
	await checked(run, "git", ["clean", "-fd", "-e", h.regression, "-e", h.compatibility], { cwd });
	const patch = await checked(run, "git", ["diff", "--binary", job.base!], { cwd: candidate });
	if (patch) await checked(run, "git", ["apply", "--binary", "--whitespace=nowarn"], { cwd, input: `${patch}\n` });
	const untracked = (await checked(run, "git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: candidate })).split("\0").filter(Boolean);
	for (const path of untracked) {
		if (path === h.regression || path === h.compatibility || path.startsWith("/") || path.includes("..")) throw new Error("Candidate collides with held-out evaluation authority");
		await mkdir(dirname(join(cwd, path)), { recursive: true }); await copyFile(join(candidate, path), join(cwd, path));
	}
	const verify = verificationRunner(run, [h.regression, h.compatibility]);
	await checked(verify, "npm", ["run", "build:deps"], { cwd, timeoutMs: 600000 });
	const outcome = await verify(process.execPath, ["--test", "--import", "tsx", h.regression, h.compatibility], { cwd, timeoutMs: 120000, log: join(root, "logs", `${job.id}-holdout-candidate.json`) });
	await assertFrozen(job);
	h.passed = outcome.code === 0;
	return h.passed;
}
