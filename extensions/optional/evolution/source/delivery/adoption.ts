/**
 * [WHO]: Verified managed installs, version pointer switching and evidence-based rollback
 * [FROM]: Node filesystem and local source state/process contracts
 * [TO]: Supervisor and CLI managed launcher
 * [HERE]: extensions/optional/evolution/source/delivery/adoption.ts - installation ownership
 */
import { join, resolve, relative } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import type { InstalledVersion, RunCommand, SourceConfig, SourceJob, SourceState } from "../types.js";
import { atomicJson, readJson } from "../runtime/state.js";
import { checked } from "../runtime/process.js";

export async function readInstalled(root: string): Promise<InstalledVersion | undefined> {
	const active = await readJson<InstalledVersion>(join(root, "current.json"));
	if (!active) return undefined;
	const rel = relative(resolve(root, "versions"), resolve(active.cli));
	if (!/^\d+\.\d+\.\d+$/.test(active.version) || !rel || rel.startsWith("..") || !active.cli.endsWith("/dist/cli.js")) throw new Error("Invalid managed installation pointer");
	return active;
}
export async function adoptCandidate(run: RunCommand, root: string, config: SourceConfig, job: SourceJob): Promise<void> {
	if (!config.autoUpdate) return;
	if (!job.version || !job.integrity || !job.merge) throw new Error("Adoption requires verified publication provenance");
	const current = await readInstalled(root);
	if (current?.job === job.id) { job.stage = "adopted"; job.adoptedAt ??= new Date().toISOString(); return; }
	const target = join(root, "versions", job.version);
	await mkdir(target, { recursive: true, mode: 0o700 });
	const remote = JSON.parse(await checked(run, "npm", ["view", `${config.packageName}@${job.version}`, "dist.integrity", "--json"], { cwd: target }));
	if (remote !== job.integrity) throw new Error("Registry artifact changed before adoption");
	await checked(run, "npm", ["install", "--prefix", target, "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", `${config.packageName}@${job.version}`], { cwd: target, timeoutMs: 600000 });
	const lock = JSON.parse(await readFile(join(target, "package-lock.json"), "utf8"));
	if (lock.packages?.[`node_modules/${config.packageName}`]?.integrity !== job.integrity) throw new Error("Installed artifact integrity mismatch");
	const cli = join(target, "node_modules", config.packageName, "dist", "cli.js");
	const env = { ...process.env, CATUI_EVOLUTION_WORKER: "1" };
	if (await checked(run, process.execPath, [cli, "--version"], { cwd: target, env }) !== job.version) throw new Error("Installed version smoke failed");
	await checked(run, process.execPath, ["--input-type=module", "-e", "await import(process.argv[1]);", join(target, "node_modules", config.packageName, "dist", "index.js")], { cwd: target, env });
	job.previousVersion = current?.version;
	await atomicJson(join(root, "current.json"), { version: job.version, cli, job: job.id, merge: job.merge, ...(current ? { previous: { ...current, previous: undefined } } : {}) } satisfies InstalledVersion);
	job.stage = "adopted"; job.adoptedAt = new Date().toISOString();
}
export async function measureAdoption(root: string, state: SourceState, config: SourceConfig, job: SourceJob): Promise<void> {
	if (!job.adoptedAt || job.baselineRate === undefined) return;
	const sample = job.evidence.find(e => e.failed || e.inefficient);
	if (!sample) return;
	const observations = state.observations.filter(e => e.kind === sample.kind && e.tool === sample.tool && e.model === sample.model && e.workspace === sample.workspace && e.version === job.version && e.time >= job.adoptedAt!);
	job.measuredCount = observations.length;
	if (observations.length < config.measurementSamples) { job.lastResult = "Insufficient comparable post-adoption observations"; return; }
	const rate = observations.filter(e => job.metric === "inefficiency" ? e.inefficient : e.failed).length / observations.length;
	job.measuredRate = rate;
	if (rate > job.baselineRate + config.regressionMargin) {
		const installed = await readInstalled(root);
		if (installed?.job === job.id) {
			await atomicJson(join(root, "current.json"), installed.previous ?? null);
		}
		job.stage = "regressed";
		job.lastResult = "Comparable failure rate regressed; managed version rolled back. New-version failure evidence enters the next daily repair cycle.";
	} else if (rate < job.baselineRate) {
		job.stage = "effective"; job.lastResult = "Observed failure rate improved in matching usage cohort; observational evidence, not causal proof";
	} else job.lastResult = "No measured improvement yet";
}
