/**
 * [WHO]: Real Git/Node baseline-to-candidate integration and OS sandbox containment checks
 * [FROM]: Node test/fs, production repair coordinator and command runner
 * [TO]: Source evolution regression suite
 * [HERE]: test/source-evolution-repair.test.ts - executable local evolution proof
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig } from "../extensions/optional/evolution/source/runtime/config.js";
import { loadState } from "../extensions/optional/evolution/source/runtime/state.js";
import { runCommand, checked } from "../extensions/optional/evolution/source/runtime/process.js";
import { prepareCandidate, repairCandidate } from "../extensions/optional/evolution/source/delivery/repair.js";
import { verificationRunner } from "../extensions/optional/evolution/source/delivery/sandbox.js";
import type { SourceJob, RunCommand } from "../extensions/optional/evolution/source/types.js";

// Containment itself is tested by the dedicated macOS CI job, outside an outer
// verifier sandbox. Nested sandbox activation is unsupported on macOS.
const supported = process.env.CATUI_EVOLUTION_VERIFY !== "1" && (process.platform === "darwin" || (process.platform === "linux" && existsSync("/usr/bin/bwrap")));
test("OS verifier rejects writes outside the candidate checkout", { skip: !supported }, async t => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "source-sandbox-test-")));
	t.after(() => rm(root, { recursive: true, force: true }));
	const cwd = join(root, "repo"); await mkdir(join(cwd, ".git"), { recursive: true });
	const run = verificationRunner(runCommand);
	const ok = await run(process.execPath, ["-e", "require('fs').writeFileSync('inside.txt','ok')"], { cwd });
	assert.equal(ok.code, 0, ok.stderr);
	const denied = await run(process.execPath, ["-e", "require('fs').writeFileSync(process.argv[1],'bad')", join(root, "outside.txt")], { cwd });
	assert.notEqual(denied.code, 0); assert.equal(existsSync(join(root, "outside.txt")), false);
	const gitWrite = await run(process.execPath, ["-e", "require('fs').writeFileSync('.git/authority','bad')"], { cwd });
	assert.notEqual(gitWrite.code, 0);
});

test("actual Git checkout evolves from failing assertion to verified committed patch", { skip: !supported, timeout: 120000 }, async t => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "source-repair-test-")));
	t.after(() => rm(root, { recursive: true, force: true }));
	const upstream = join(root, "upstream"); await mkdir(join(upstream, "core"), { recursive: true });
	await mkdir(join(upstream, "test"), { recursive: true });
	const noop = "node -e \"process.exit(0)\"";
	const pkg = { name: "catui-agent", version: "1.0.0", type: "module", scripts: { "build:deps": noop, "verify:dip": noop, "verify:quality": noop, "verify:package-boundary": noop, build: noop, "test:harness-critical": noop } };
	await writeFile(join(upstream, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
	await writeFile(join(upstream, "package-lock.json"), JSON.stringify({ name: "catui-agent", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "catui-agent", version: "1.0.0" } } }));
	await writeFile(join(upstream, "core", "sum.ts"), "export function sum(a: number, b: number): number { return a - b; }\n");
	await writeFile(join(upstream, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true, noEmit: true }, include: ["core/**/*.ts", "test/**/*.ts"] }));
	await writeFile(join(upstream, ".gitignore"), "node_modules\n");
	await checked(runCommand, "git", ["init", "-b", "main"], { cwd: upstream });
	await checked(runCommand, "git", ["add", "core/sum.ts", "package.json", "package-lock.json", "tsconfig.json", ".gitignore"], { cwd: upstream });
	await checked(runCommand, "git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "-c", "core.hooksPath=/dev/null", "commit", "-m", "test: seed real defective implementation"], { cwd: upstream });
	const config = defaultConfig(root, "fixture/model");
	const state = await loadState(root);
	const j: SourceJob = { id: "local-proof", day: "2026-09-08", stage: "queued", createdAt: new Date().toISOString(), evidence: [], fingerprint: "sum-failure", title: "sum defect", branch: "evolution/local-proof", checkout: join(root, "jobs", "local-proof"), attempts: 0 };
	state.jobs.push(j);
	const phases: string[] = [];
	const run: RunCommand = async (command, args, options) => {
		if (command === "git" && args[0] === "clone") return runCommand(command, args.map(a => a.startsWith("https://github.com/") ? upstream : a), options);
		if (command === "npm" && args[0] === "ci") {
			await symlink(join(process.cwd(), "node_modules"), join(options.cwd, "node_modules"), "dir");
			return { code: 0, stdout: "Fixture dependencies staged from installed workspace", stderr: "" };
		}
		if (args.includes("worker")) {
			const phase = args[args.indexOf("--phase") + 1]; phases.push(phase);
			let stdout = "Done";
			if (phase === "triage") stdout = JSON.stringify({ actionable: true, title: "Correct sum arithmetic", hypothesis: "sum subtracts instead of adding" });
			if (phase === "reproduce") {
				await mkdir(join(options.cwd, "test"), { recursive: true });
				await writeFile(join(options.cwd, args[args.indexOf("--test") + 1]), "import test from 'node:test'; import assert from 'node:assert/strict'; import {sum} from '../core/sum.js'; test('sum adds distinct operands', () => assert.equal(sum(2,3),5));\n");
			}
			if (phase === "repair") await writeFile(join(options.cwd, "core", "sum.ts"), "export function sum(a: number, b: number): number { return a + b; }\n");
			if (phase === "review") stdout = JSON.stringify({ approved: true, reproducesRealDefect: true, preservesBehavior: true, publishable: true, reason: "Production function corrected with independent regression" });
			return { code: 0, stdout, stderr: "" };
		}
		return runCommand(command, args, options);
	};
	await prepareCandidate(run, root, config, state, j);
	assert.equal(j.stage, "prepared");
	const baseline = JSON.parse(await readFile(join(root, "logs", `${j.id}-baseline.json`), "utf8"));
	assert.equal(baseline.code, 1); assert.match(baseline.stdout, /ERR_ASSERTION/);
	await repairCandidate(run, root, config, state, j);
	assert.equal(j.stage, "verified"); assert.equal(j.version, "1.0.1"); assert.notEqual(j.base, j.head);
	assert.deepEqual(phases, ["triage", "reproduce", "repair", "review"]);
	assert.equal(await checked(runCommand, "git", ["status", "--porcelain"], { cwd: j.checkout }), "");
	const candidate = JSON.parse(await readFile(join(root, "logs", `${j.id}-candidate.json`), "utf8"));
	assert.equal(candidate.code, 0);
	assert.equal((await loadState(root)).jobs[0].head, j.head);
});
