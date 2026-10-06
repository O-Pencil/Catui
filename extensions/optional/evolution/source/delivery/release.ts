/**
 * [WHO]: Verified artifact packaging and receipt-based npm availability/GitHub reconciliation
 * [FROM]: Local verifier, state and subprocess adapters
 * [TO]: Source evolution supervisor after confirmed merge
 * [HERE]: extensions/optional/evolution/source/delivery/release.ts - release authority
 */
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { RunCommand, SourceConfig, SourceJob, SourceState } from "../types.js";
import { checked } from "../runtime/process.js";
import { verifyRepository } from "./repair.js";
import { saveState } from "../runtime/state.js";
import { verificationRunner } from "./sandbox.js";
import { verifyHoldout } from "../assessment/holdout.js";

export async function publishCandidate(run: RunCommand, root: string, config: SourceConfig, state: SourceState, job: SourceJob): Promise<void> {
	if (!config.autoPublish) return;
	if (!job.merge || !job.version) throw new Error("Release requires merged commit and reserved version");
	const cwd = join(root, "releases", job.id);
	await mkdir(join(root, "releases"), { recursive: true });
	if (!existsSync(join(cwd, ".git"))) await checked(run, "git", ["clone", "--no-checkout", `https://github.com/${config.repository}.git`, cwd], { cwd: root, timeoutMs: 300000 });
	await checked(run, "git", ["fetch", "origin", config.branch], { cwd, timeoutMs: 180000 });
	await checked(run, "git", ["merge-base", "--is-ancestor", job.merge, "FETCH_HEAD"], { cwd });
	await checked(run, "git", ["checkout", "--detach", job.merge], { cwd });
	const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
	if (pkg.name !== config.packageName || pkg.version !== job.version) throw new Error("Merged package identity does not match verified candidate");
	const tag = `v${job.version}`;
	const refs = await checked(run, "git", ["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { cwd });
	const tagLines = refs.split("\n").filter(Boolean);
	const tagged = (tagLines.find(line => line.endsWith("^{}")) ?? tagLines[0])?.split(/\s+/)[0];
	if (tagged && tagged !== job.merge) throw new Error("Release tag identity conflict with verified merge");
	if (createHash("sha256").update(await readFile(join(cwd, job.testPath!), "utf8")).digest("hex") !== job.testHash) throw new Error("Merged regression differs from the frozen contract");
	if (!job.artifact) {
		await checked(run, "npm", ["ci", "--ignore-scripts"], { cwd, timeoutMs: 600000 });
		await verifyRepository(run, cwd, root, `${job.id}-merged`);
		await checked(verificationRunner(run), process.execPath, ["--test", "--import", "tsx", job.testPath!], { cwd, timeoutMs: 120000 });
		if (!await verifyHoldout(run, root, job, cwd)) throw new Error("Merged source failed independent held-out acceptance");
		if (await checked(run, "git", ["status", "--porcelain", "--untracked-files=no"], { cwd })) throw new Error("Merged verification changed source before packaging");
		const packed = JSON.parse(await checked(run, "npm", ["pack", "--json", "--ignore-scripts"], { cwd })) as { filename: string; integrity: string }[];
		if (packed.length !== 1 || !/^[\w.-]+\.tgz$/.test(packed[0].filename)) throw new Error("Unexpected package artifact");
		job.artifact = join(cwd, packed[0].filename); job.integrity = packed[0].integrity;
		await saveState(root, state);
	}
	const integrity = "sha512-" + createHash("sha512").update(await readFile(job.artifact)).digest("base64");
	if (integrity !== job.integrity) throw new Error("Release artifact changed after verification");
	const spec = `${config.packageName}@${job.version}`;
	const lookup = await run("npm", ["view", spec, "dist.integrity", "--json"], { cwd });
	if (lookup.code !== 0) {
		if (!/E404/.test(lookup.stderr + lookup.stdout)) throw new Error("Cannot reconcile registry identity; publication deferred");
		if (!job.publication) {
			job.publication = { attemptedAt: new Date().toISOString() };
			await saveState(root, state);
			const upload = await run("npm", ["publish", job.artifact, "--ignore-scripts", "--access", "public"], { cwd, timeoutMs: 300000 });
			if (upload.code !== 0) {
				// Authentication refusals have no upload side effect. Network/timeouts and
				// conflicts are ambiguous: keep the receipt and reconcile, never resubmit.
				if (/\b(?:E401|E403|ENEEDAUTH|EOTP)\b/.test(upload.stderr + upload.stdout)) {
					job.publication = undefined;
					await saveState(root, state);
				}
				throw new Error(`npm publish failed: ${upload.stderr || upload.stdout || upload.code}`);
			}
			job.publication.acceptedAt = new Date().toISOString();
			await saveState(root, state);
		}
	}
	const visible = lookup.code === 0 ? lookup : await run("npm", ["view", spec, "dist.integrity", "--json"], { cwd });
	if (visible.code !== 0) {
		if (!/E404/.test(visible.stderr + visible.stdout)) throw new Error("Cannot reconcile registry identity; publication deferred");
		job.lastResult = job.publication?.acceptedAt
			? "npm accepted the artifact; waiting for public version availability"
			: "Upload outcome is unknown; reconciling public availability without another upload";
		job.retryAfter = new Date(Date.now() + 60000).toISOString();
		await saveState(root, state);
		return;
	}
	const published = JSON.parse(visible.stdout);
	if (published !== job.integrity) throw new Error("Registry version belongs to a different artifact");
	const release = await run("gh", ["release", "view", tag, "--repo", config.repository, "--json", "tagName"], { cwd });
	if (release.code !== 0) {
		await checked(run, "gh", ["release", "create", tag, "--repo", config.repository, "--target", job.merge, "--title", tag, "--notes", `Automated Catui improvement from PR #${job.pr}. Frozen baseline/candidate regression and repository gates passed. Real-world effectiveness is being measured.\n\nSource commit: ${job.merge}\nIntegrity: ${job.integrity}`], { cwd });
	}
	job.stage = "published";
	job.retryAfter = undefined;
	job.lastResult = "Registry artifact integrity verified; GitHub release ready";
}
