/**
 * [WHO]: Isolated source repair with frozen baseline-failing regression and repository gates
 * [FROM]: Local worker, policy, state and argv-only command adapters
 * [TO]: Source evolution supervisor
 * [HERE]: extensions/optional/evolution/source/delivery/repair.ts - executable improvement verifier
 */
import { mkdir, readFile, writeFile, lstat, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SourceConfig, SourceJob, SourceState, RunCommand } from "../types.js";
import { checked } from "../runtime/process.js";
import { saveState, atomicJson } from "../runtime/state.js";
import { digest, sanitize } from "../runtime/observer.js";
import { askWorker } from "./model.js";
import { acceptedReview, parseObject, repairable } from "./policy.js";
import { verificationRunner } from "./sandbox.js";
import lockfile from "proper-lockfile";

export const GATES: readonly [string, string[]][] = [
	["npm", ["run", "verify:dip"]], ["npm", ["run", "verify:quality"]],
	["npm", ["run", "verify:package-boundary"]], ["npm", ["run", "build"]],
	["node", ["node_modules/typescript/bin/tsc", "--noEmit"]], ["npm", ["run", "test:harness-critical"]],
];
export async function verifyRepository(run: RunCommand, checkout: string, root: string, id: string): Promise<void> {
	const verify = verificationRunner(run);
	for (const [i, [command, args]] of GATES.entries()) {
		await checked(verify, command, args, { cwd: checkout, timeoutMs: 1200000, log: join(root, "logs", `${id}-gate-${i}.json`) });
	}
}
export async function changedPaths(run: RunCommand, cwd: string): Promise<string[]> {
	const tracked = await checked(run, "git", ["diff", "--name-only", "HEAD", "-z"], { cwd });
	const untracked = await checked(run, "git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd });
	return [...new Set((tracked + "\0" + untracked).split("\0").filter(Boolean))];
}
async function assertPlainFiles(cwd: string, paths: string[]): Promise<void> {
	for (const path of paths) {
		try { const info = await lstat(join(cwd, path)); if (!info.isFile()) throw new Error(`Unsupported candidate file: ${path}`); }
		catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
	}
}
export async function prepareCandidate(run: RunCommand, root: string, config: SourceConfig, state: SourceState, job: SourceJob): Promise<void> {
	await mkdir(join(root, "jobs"), { recursive: true, mode: 0o700 });
	if (!existsSync(join(job.checkout, ".git"))) {
		await checked(run, "git", ["clone", "--single-branch", "--branch", config.branch, `https://github.com/${config.repository}.git`, job.checkout], { cwd: root, timeoutMs: 300000 });
	}
	if (await lockfile.check(job.checkout, { lockfilePath: `${job.checkout}.evolution-worker.lock`, stale: 30000 })) throw new Error("Previous worker is still completing this checkout");
	if (job.previousHead) {
		await checked(run, "git", ["fetch", "origin", config.branch], { cwd: job.checkout, timeoutMs: 180000 });
		await checked(run, "git", ["reset", "--hard", "FETCH_HEAD"], { cwd: job.checkout });
		await checked(run, "git", ["clean", "-fd"], { cwd: job.checkout });
	}
	job.base = await checked(run, "git", ["rev-parse", "HEAD"], { cwd: job.checkout });
	await checked(run, "git", ["switch", "-C", job.branch], { cwd: job.checkout });
	const tracked = await checked(run, "git", ["ls-files"], { cwd: job.checkout });
	const triage = parseObject(await askWorker(run, root, state, config, "triage", job.checkout,
		`Assess these real usage observations for a reproducible defect in Catui itself. External network/provider failures and user-project bugs are not Catui defects. Inspect relevant source. Return JSON {"actionable":boolean,"title":string,"hypothesis":string}. No Markdown. Evidence:\n${JSON.stringify(job.evidence)}\nTracked paths:\n${tracked.slice(0, 18000)}`));
	if (triage.actionable !== true || typeof triage.title !== "string" || typeof triage.hypothesis !== "string") { job.stage = "rejected"; job.lastResult = "Insufficient evidence of a Catui defect"; return; }
	job.title = sanitize(triage.title).replace(/[\r\n]/g, " ").slice(0, 120);
	job.testPath = `test/source-evolution-${job.id}.test.ts`;
	await checked(run, "npm", ["ci", "--ignore-scripts"], { cwd: job.checkout, timeoutMs: 600000 });
	await checked(run, "npm", ["run", "build:deps"], { cwd: job.checkout, timeoutMs: 600000 });
	await askWorker(run, root, state, config, "reproduce", job.checkout,
		`Create exactly ${job.testPath}, a node:test regression that invokes production Catui code and asserts the correct behavior described below. It must fail on the current defect with an assertion failure, not import/setup errors. No network, subprocesses, environment mutations, test runner detection, version/commit checks or source-text matching. Read repository instructions and relevant code. Only write this file. Return a brief explanation. Hypothesis: ${triage.hypothesis}\nEvidence: ${JSON.stringify(job.evidence)}`, job.testPath);
	const changes = await changedPaths(run, job.checkout);
	if (changes.some(p => p !== job.testPath) || !existsSync(join(job.checkout, job.testPath))) throw new Error("Reproducer changed files outside its frozen test");
	const test = await readFile(join(job.checkout, job.testPath), "utf8");
	job.testHash = digest(test);
	await atomicJson(join(root, "jobs", `${job.id}-contract.json`), { base: job.base, testPath: job.testPath, testHash: job.testHash, test, hypothesis: triage.hypothesis });
	const baseline = await verificationRunner(run)(process.execPath, ["--test", "--import", "tsx", job.testPath], { cwd: job.checkout, timeoutMs: 120000, log: join(root, "logs", `${job.id}-baseline.json`) });
	if (baseline.code !== 1 || !/ERR_ASSERTION|AssertionError/.test(baseline.stdout + baseline.stderr)) throw new Error("Reproduction must fail with an assertion on baseline");
	job.stage = "prepared";
	await saveState(root, state);
}
export async function repairCandidate(run: RunCommand, root: string, config: SourceConfig, state: SourceState, job: SourceJob): Promise<void> {
	if (!job.testPath || !job.testHash || !job.base) throw new Error("Missing frozen baseline contract");
	if (await lockfile.check(job.checkout, { lockfilePath: `${job.checkout}.evolution-worker.lock`, stale: 30000 })) throw new Error("Previous worker is still completing this checkout");
	await checked(run, "git", ["reset", "--mixed", job.base], { cwd: job.checkout });
	await checked(run, "git", ["restore", "--source", job.base, "--staged", "--worktree", "--", "package.json", "package-lock.json"], { cwd: job.checkout });
	const oldChangelog = await run("git", ["show", `${job.base}:CHANGELOG.md`], { cwd: job.checkout });
	if (oldChangelog.code === 0) await writeFile(join(job.checkout, "CHANGELOG.md"), oldChangelog.stdout);
	else await unlink(join(job.checkout, "CHANGELOG.md")).catch(e => { if (e.code !== "ENOENT") throw e; });
	await askWorker(run, root, state, config, "repair", job.checkout,
		`Fix the demonstrated Catui defect: ${job.title}. The external verifier ran ${job.testPath} and confirmed assertion failure on baseline ${job.base}. Read this frozen regression and relevant code. Implement the smallest general fix; do not detect test runners or change tests, package metadata, scripts, workflow rules, or source-evolution control code. Update DIP maps/headers and add a focused .dev-docs/architecture-review/ review before changing load-bearing code. You may read prior verification logs only if supplied. Return a brief explanation. Evidence: ${JSON.stringify(job.evidence)}\nPrevious failure: ${job.error ?? "none"}`, job.testPath);
	if (digest(await readFile(join(job.checkout, job.testPath), "utf8")) !== job.testHash) throw new Error("Frozen regression was modified");
	const changes = await changedPaths(run, job.checkout);
	if (!changes.some(p => p !== job.testPath) || changes.some(p => p !== job.testPath && !repairable(p))) throw new Error("Candidate modified protected paths or contains no source fix");
	await assertPlainFiles(job.checkout, changes);
	await checked(verificationRunner(run), process.execPath, ["--test", "--import", "tsx", job.testPath], { cwd: job.checkout, timeoutMs: 120000, log: join(root, "logs", `${job.id}-candidate.json`) });
	const diff = await checked(run, "git", ["diff", "HEAD", "--", ...changes], { cwd: job.checkout });
	const added = await Promise.all(changes.filter(p => p !== job.testPath).map(async p => {
		const tracked = await run("git", ["ls-files", "--error-unmatch", "--", p], { cwd: job.checkout });
		return tracked.code === 0 ? "" : `${p}\n${await readFile(join(job.checkout, p), "utf8")}`;
	}));
	acceptedReview(await askWorker(run, root, state, config, "review", job.checkout,
		`Independently review this source improvement. Inspect production code as needed. Reject tests that merely inspect source text, manipulate environment, fake failures, or do not exercise the claimed behavior; reject special casing of tests and unrelated changes. Check evidence supports Catui root cause, API/UX compatibility, and safe public disclosure (no private user code or conversation excerpts). Return only JSON {"approved":boolean,"reproducesRealDefect":boolean,"preservesBehavior":boolean,"publishable":boolean,"reason":string}. Baseline failed with assertion; candidate passed the identical frozen test. Test:\n${await readFile(join(job.checkout, job.testPath), "utf8")}\nDiff:\n${diff}\nNew files:\n${added.join("\n")}\nFinding: ${job.title}`, job.testPath));
	const pkgPath = join(job.checkout, "package.json");
	const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
	if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error("Automatic releases require a stable semver baseline");
	const [major, minor, patch] = pkg.version.split(".").map(Number);
	job.version = `${major}.${minor}.${patch + 1}`; pkg.version = job.version;
	await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
	const lockPath = join(job.checkout, "package-lock.json");
	const lock = JSON.parse(await readFile(lockPath, "utf8"));
	if (!lock.packages?.[""]) throw new Error("A workspace-aware npm lockfile is required");
	lock.version = job.version; lock.packages[""].version = job.version;
	await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n");
	const entry = `## [${job.version}] - ${new Date().toISOString().slice(0, 10)}\n\n### Fixed\n\n- ${job.title}\n\n`;
	const changelog = oldChangelog.code === 0 ? oldChangelog.stdout : "# Changelog\n\n";
	await writeFile(join(job.checkout, "CHANGELOG.md"), changelog.replace(/^(#[^\n]*\n)/, `$1\n${entry}`));
	const beforePaths = await changedPaths(run, job.checkout);
	const contentHash = async (p: string) => { try { return digest(await readFile(join(job.checkout, p), "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return "deleted"; throw e; } };
	const beforeHashes = new Map(await Promise.all(beforePaths.map(async p => [p, await contentHash(p)] as const)));
	await verifyRepository(run, job.checkout, root, job.id);
	const finalPaths = await changedPaths(run, job.checkout);
	if (finalPaths.some(p => p !== job.testPath && !["package.json", "package-lock.json", "CHANGELOG.md"].includes(p) && !repairable(p))) throw new Error("Verification mutated protected source files");
	if (finalPaths.length !== beforePaths.length) throw new Error("Verification changed the candidate file set");
	for (const path of finalPaths) if (beforeHashes.get(path) !== await contentHash(path)) throw new Error("Verification changed candidate source after independent review");
	if (digest(await readFile(join(job.checkout, job.testPath), "utf8")) !== job.testHash) throw new Error("Verification changed the frozen test");
	await checked(run, "git", ["add", "--", ...finalPaths], { cwd: job.checkout });
	await checked(run, "git", ["-c", "user.name=Catui Evolution", "-c", "user.email=catui-evolution@users.noreply.github.com", "-c", "core.hooksPath=/dev/null", "commit", "-m", `fix(evolution): ${job.title}`], { cwd: job.checkout });
	job.head = await checked(run, "git", ["rev-parse", "HEAD"], { cwd: job.checkout });
	job.stage = "verified"; job.error = undefined;
	await saveState(root, state);
}
