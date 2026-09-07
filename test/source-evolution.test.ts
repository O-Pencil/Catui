/**
 * [WHO]: Source evolution persistence, budget, scheduling, process and merge-boundary regressions
 * [FROM]: Node test/assert/fs and source evolution implementation
 * [TO]: Required harness test command and CI
 * [HERE]: test/source-evolution.test.ts - autonomous delivery invariants
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { defaultConfig, validateConfig, calendar, loadConfig } from "../extensions/optional/evolution/source/runtime/config.js";
import { atomicJson, loadState, saveState, reserveCall, supervisorLease } from "../extensions/optional/evolution/source/runtime/state.js";
import { spool, ingest, fingerprint, sanitize, selectEvidence } from "../extensions/optional/evolution/source/runtime/observer.js";
import { enqueue, advanceJob, deliveryTick } from "../extensions/optional/evolution/source/runtime/daemon.js";
import { runCommand, catuiCommand } from "../extensions/optional/evolution/source/runtime/process.js";
import { mergeReady, reconcilePullRequest, submitPullRequest, type PullRequest } from "../extensions/optional/evolution/source/delivery/github.js";
import { measureAdoption, readInstalled, adoptCandidate } from "../extensions/optional/evolution/source/delivery/adoption.js";
import { acceptedReview, repairable } from "../extensions/optional/evolution/source/delivery/policy.js";
import { sandboxCommand, verificationEnvironment } from "../extensions/optional/evolution/source/delivery/sandbox.js";
import { publishCandidate } from "../extensions/optional/evolution/source/delivery/release.js";
import type { Observation, SourceJob, RunCommand } from "../extensions/optional/evolution/source/types.js";
import { registerSourceEvolution } from "../extensions/optional/evolution/source/runtime/bridge.js";
import { sourceRoot } from "../extensions/optional/evolution/source/runtime/config.js";
import type { ExtensionAPI } from "../core/extensions-host/types.js";

async function fixture(t: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), "catui-source-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	return { root, config: defaultConfig(root, "test/model"), state: await loadState(root) };
}
function event(overrides: Partial<Observation> = {}): Observation {
	return { id: randomUUID(), run: randomUUID(), session: "s", workspace: "workspace-hash", time: new Date().toISOString(), version: "1.0.0", model: "m", kind: "tool", tool: "edit", failed: true, summary: "Invalid replacement", fingerprint: "failure-a", ...overrides };
}
function job(root: string): SourceJob {
	return { id: "job-1", day: "2026-09-08", stage: "submitted", createdAt: new Date().toISOString(), evidence: [event()], fingerprint: "failure-a", title: "Fix replacement", base: "base", head: "head", branch: "evolution/job-1", checkout: root, pr: 12, attempts: 0, version: "1.0.1" };
}
function pr(): PullRequest { return { number: 12, state: "OPEN", headRefOid: "head", baseRefOid: "base", isDraft: false, mergeable: "MERGEABLE", statusCheckRollup: [{ name: "check", status: "COMPLETED", conclusion: "SUCCESS" }] }; }

test("configuration is explicit, validated and absent by default", async t => {
	const { root, config } = await fixture(t);
	assert.equal(loadConfig(root), undefined);
	assert.equal(validateConfig(config).autoMerge, true);
	for (const change of [{ model: "" }, { repository: "../repo" }, { hour: 24 }, { maxWorkerRunsPerDay: 0 }, { requiredChecks: [] }, { timeZone: "not/a-zone" }]) assert.throws(() => validateConfig({ ...config, ...change }));
});
test("live extension events reach durable sidecar state and unconfigured sessions stop observation", async t => {
	const { root, config } = await fixture(t);
	const observedRoot = sourceRoot(root);
	await atomicJson(join(observedRoot, "config.json"), config);
	const release = await supervisorLease(observedRoot); t.after(async () => { await release(); });
	const handlers = new Map<string, Function>();
	const worker = process.env.CATUI_EVOLUTION_WORKER;
	try {
		delete process.env.CATUI_EVOLUTION_WORKER;
		registerSourceEvolution({ on: (name: string, fn: Function) => handlers.set(name, fn), sendMessage: () => {} } as unknown as ExtensionAPI);
	} finally { if (worker !== undefined) process.env.CATUI_EVOLUTION_WORKER = worker; }
	const context = { agentDir: root, cwd: root, model: { id: "model" }, sessionManager: { getSessionId: () => "session" } };
	handlers.get("session_start")!({}, context);
	handlers.get("before_agent_start")!({ prompt: "Fix incorrect tool behavior" }, context);
	handlers.get("tool_execution_start")!({ toolCallId: "call", toolName: "edit", args: { path: "file" } }, context);
	handlers.get("tool_execution_end")!({ toolCallId: "call", toolName: "edit", isError: true, result: { content: [{ type: "text", text: "Invalid replacement" }] } }, context);
	handlers.get("agent_result")!({ errorMessage: "Task failed", stopReason: "error", durationMs: 5 }, context);
	const state = await loadState(observedRoot);
	for (let i = 0; i < 100 && state.observations.length < 3; i++) { await new Promise(r => setTimeout(r, 10)); await ingest(observedRoot, state); }
	assert.equal(state.observations.length, 3);
	assert.equal(state.observations.find(e => e.kind === "tool")?.failed, true);
	assert.equal(state.observations.find(e => e.kind === "result")?.summary, "Task failed");
	assert.equal(new Set(state.observations.map(e => e.run)).size, 1);
	handlers.get("session_start")!({}, { ...context, agentDir: join(root, "unconfigured") });
	handlers.get("before_agent_start")!({ prompt: "Do not observe this" }, context);
	await new Promise(r => setTimeout(r, 30)); await ingest(observedRoot, state);
	assert.equal(state.observations.length, 3);
});
test("daily schedule uses configured local date, including UTC day boundary", async t => {
	const { config } = await fixture(t);
	assert.deepEqual(calendar(config, new Date("2026-09-07T18:59:00Z")), { day: "2026-09-08", due: false });
	assert.deepEqual(calendar(config, new Date("2026-09-07T19:00:00Z")), { day: "2026-09-08", due: true });
});
test("spool ingestion is durable and idempotent across restart and redelivery", async t => {
	const { root, state } = await fixture(t); const e = event();
	await spool(root, e); await ingest(root, state);
	assert.equal(state.observations.length, 1);
	const resumed = await loadState(root);
	await spool(root, e); await ingest(root, resumed);
	assert.equal(resumed.observations.length, 1);
	assert.equal((await loadState(root)).seen[0], e.id);
});
test("supervisor lease prevents two publishers and releases cleanly", async t => {
	const { root } = await fixture(t); const release = await supervisorLease(root);
	try { await assert.rejects(supervisorLease(root)); } finally { await release(); }
	const second = await supervisorLease(root); await second();
});
test("model budget is reserved before work and remains consumed after restart", async t => {
	const { root, config, state } = await fixture(t); config.maxWorkerRunsPerDay = 1;
	await reserveCall(root, state, config);
	await assert.rejects(reserveCall(root, await loadState(root), config), /budget exhausted/);
});
test("overlapping observation and delivery saves preserve newest state", async t => {
	const { root, state } = await fixture(t);
	const a = saveState(root, state); state.observations.push(event()); const b = saveState(root, state);
	await Promise.all([a, b]); assert.equal((await loadState(root)).observations.length, 1);
});
test("one failing run cannot manufacture repeated evidence", async t => {
	const { state, config } = await fixture(t);
	state.observations.push(event({ run: "one" }), event({ run: "one" }));
	assert.equal(selectEvidence(state, config), undefined);
	state.observations.push(event({ run: "two" })); assert.ok(selectEvidence(state, config));
});
test("daily enqueue persists cohort denominators and prevents duplicate jobs", async t => {
	const { root, state, config } = await fixture(t);
	state.observations.push(event(), event(), event({ failed: false }));
	const created = enqueue(state, config, root, new Date("2026-09-08T04:00:00Z"));
	assert.equal(created?.baselineRate, 2 / 3); assert.equal(created?.baselineCount, 3);
	assert.equal(enqueue(state, config, root, new Date("2026-09-08T05:00:00Z")), undefined);
	created!.stage = "rejected";
	assert.equal(enqueue(state, config, root, new Date("2026-09-09T05:00:00Z")), undefined);
});
test("sanitization hides common credentials and local paths", () => {
	const text = sanitize("token=abc123\nBearer xyz\n/Users/alice/private.txt\nhttps://private.example/api\nnpm_abcdefghijklmnop");
	for (const value of ["abc123", "xyz", "alice", "private.example", "abcdefghijklmnop"]) assert.ok(!text.includes(value));
	assert.equal(fingerprint("edit", "failed at line 123"), fingerprint("edit", "failed at line 456"));
});
test("merge requires exact tested head/base and explicit successful CI", () => {
	const j = job("/tmp"); assert.equal(mergeReady(pr(), j, ["check"]), true);
	for (const change of [{ headRefOid: "other" }, { baseRefOid: "other" }, { isDraft: true }, { reviewDecision: "CHANGES_REQUESTED" }, { reviewDecision: "REVIEW_REQUIRED" }, { mergeable: "UNKNOWN" }, { statusCheckRollup: [] }, { statusCheckRollup: [{ name: "check", conclusion: "SKIPPED" }] }]) assert.equal(mergeReady({ ...pr(), ...change }, j, ["check"]), false);
	assert.equal(mergeReady(pr(), j, ["missing"]), false);
});
test("autonomous merge is followed by authoritative merged-state reconciliation", async t => {
	const { root, config } = await fixture(t); config.requiredChecks = ["check"];
	const j = job(root); const calls: string[][] = []; let merged = false;
	const run: RunCommand = async (_cmd, args) => { calls.push(args); if (args[1] === "merge") merged = true; return { code: 0, stderr: "", stdout: JSON.stringify(merged ? { ...pr(), state: "MERGED", mergeCommit: { oid: "merged-commit" } } : pr()) }; };
	await reconcilePullRequest(run, config, j);
	assert.equal(j.stage, "merged"); assert.equal(j.merge, "merged-commit");
	const merge = calls.find(c => c[1] === "merge")!; assert.ok(merge.includes("--match-head-commit")); assert.ok(!merge.includes("--admin"));
});
test("unexpected remote head blocks all delivery", async t => {
	const { root, config } = await fixture(t);
	await assert.rejects(reconcilePullRequest(async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ ...pr(), headRefOid: "tampered" }) }), config, job(root)), /head changed/);
});
test("upstream changes requeue full verification within a bounded revision budget", async t => {
	const { root, config } = await fixture(t); const j = job(root);
	const run: RunCommand = async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ ...pr(), baseRefOid: "new-base" }) });
	await reconcilePullRequest(run, config, j); assert.equal(j.stage, "queued"); assert.equal(j.previousHead, "head");
	j.revisions = config.maxAttempts; await reconcilePullRequest(run, config, j); assert.equal(j.stage, "failed");
});
test("a PR created before a crash is recovered without a second push or PR", async t => {
	const { root, config } = await fixture(t); const j = job(root); j.pr = undefined;
	const calls: string[][] = [];
	await submitPullRequest(async (_cmd, args) => { calls.push(args); return { code: 0, stderr: "", stdout: JSON.stringify([{ number: 12, headRefOid: "head", state: "OPEN" }]) }; }, root, config, j);
	assert.equal(j.pr, 12); assert.equal(calls.length, 2);
	assert.ok(calls.every(c => !c.includes("create") && !c.includes("push")));
	assert.deepEqual(calls[1].slice(0, 4), ["api", "--method", "PATCH", "repos/O-Pencil/Catui/pulls/12"]);
	assert.ok(calls[1].includes(`body=@${join(root, "jobs", `${j.id}-pr.md`)}`));
});
test("repair cannot rewrite verifier authority or existing tests", () => {
	for (const p of ["scripts/verify-quality.ts", ".github/workflows/ci.yml", "test/existing.test.ts", "package.json", "packages/protocol/src/index.ts", "../outside.ts", "extensions/optional/evolution/source/delivery/policy.ts"]) assert.equal(repairable(p), false, p);
	assert.equal(repairable("core/runtime/session-recovery.ts"), true);
	assert.throws(() => acceptedReview('{"approved":true}'));
});
test("adoption refuses a different registry artifact before installation", async t => {
	const { root, config } = await fixture(t); const j = job(root); j.merge = "commit"; j.integrity = "expected";
	let calls = 0;
	await assert.rejects(adoptCandidate(async () => { calls++; return { code: 0, stderr: "", stdout: '"different"' }; }, root, config, j), /artifact changed/);
	assert.equal(calls, 1);
});
test("post-adoption regression rolls back and feeds subsequent daily evidence", async t => {
	const { root, state, config } = await fixture(t); config.measurementSamples = 3;
	const j = job(root); j.stage = "adopted"; j.adoptedAt = "2026-01-01T00:00:00Z"; j.baselineRate = 0.1;
	await atomicJson(join(root, "current.json"), { job: j.id, version: "1.0.1", merge: "m", cli: join(root, "versions/1.0.1/node_modules/catui-agent/dist/cli.js"), previous: { job: "old", version: "1.0.0", merge: "b", cli: join(root, "versions/1.0.0/node_modules/catui-agent/dist/cli.js") } });
	state.observations = [event({ version: "1.0.1" }), event({ version: "1.0.1" }), event({ version: "1.0.1" })];
	await measureAdoption(root, state, config, j);
	assert.equal(j.stage, "regressed"); assert.equal((await readInstalled(root))?.version, "1.0.0"); assert.notEqual(state.paused, true);
});
test("different models or workspaces cannot establish post-adoption effectiveness", async t => {
	const { root, state, config } = await fixture(t); config.measurementSamples = 2;
	const j = job(root); j.stage = "adopted"; j.adoptedAt = "2026-01-01T00:00:00Z"; j.baselineRate = 1;
	state.observations = [event({ version: "1.0.1", failed: false, model: "different" }), event({ version: "1.0.1", failed: false, workspace: "different" })];
	await measureAdoption(root, state, config, j); assert.equal(j.stage, "adopted"); assert.equal(j.measuredCount, 0);
});
test("disabled automation invokes no delivery commands", async t => {
	const { root, state, config } = await fixture(t); config.enabled = false; state.jobs.push(job(root));
	await deliveryTick(root, state, config, async () => { throw new Error("must not execute"); });
	assert.equal(state.jobs[0].stage, "submitted");
});
test("transient delivery failure is persisted and backs off without losing the job", async t => {
	const { root, state, config } = await fixture(t); config.maxAttempts = 1; state.jobs.push(job(root));
	await deliveryTick(root, state, config, async () => { throw new Error("offline"); });
	assert.equal((await loadState(root)).jobs[0].stage, "submitted");
	assert.ok(Date.parse((await loadState(root)).jobs[0].retryAfter!) > Date.now() + 3600000);
});
test("process runner uses literal argv and kills timed-out processes", async t => {
	const { root } = await fixture(t);
	const value = '$(touch SHOULD_NOT_EXIST); `echo nope`';
	const echoed = await runCommand(process.execPath, ["-e", "process.stdout.write(process.argv[1])", value], { cwd: root });
	assert.equal(echoed.stdout, value);
	const timeout = await runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: root, timeoutMs: 100 }); assert.equal(timeout.code, 124);
	assert.ok(catuiCommand().some(p => /cli\.(?:js|ts)$/.test(p)));
});
test("verification environment excludes ambient credentials and requires OS isolation", () => {
	const env = verificationEnvironment("/tmp/verify"); assert.equal(env.GH_TOKEN, undefined); assert.equal(env.OPENAI_API_KEY, undefined);
	assert.equal(sandboxCommand("node", ["test"], "/tmp/repo", "/tmp/temp", "darwin").command, "/usr/bin/sandbox-exec");
	assert.ok(sandboxCommand("node", ["test"], "/tmp/repo", "/tmp/temp", "linux").args.includes("--unshare-net"));
	assert.throws(() => sandboxCommand("node", [], "/tmp/repo", "/tmp/temp", "win32"));
});

test("publication resumes after registry success without republishing the version", async t => {
	const { root, state, config } = await fixture(t); const j = job(root); j.stage = "merged"; j.merge = "merge-commit"; j.testPath = "test/frozen.ts";
	const cwd = join(root, "releases", j.id); await mkdir(join(cwd, ".git"), { recursive: true }); await mkdir(join(cwd, "test"));
	await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "catui-agent", version: j.version }));
	await writeFile(join(cwd, j.testPath), "frozen"); j.testHash = createHash("sha256").update("frozen").digest("hex");
	j.artifact = join(cwd, "verified.tgz"); await writeFile(j.artifact, "verified artifact");
	j.integrity = "sha512-" + createHash("sha512").update("verified artifact").digest("base64");
	let published = false, publishCalls = 0, releaseAttempts = 0;
	const run: RunCommand = async (command, args) => {
		if (command === "npm" && args[0] === "view") return published ? { code: 0, stdout: JSON.stringify(j.integrity), stderr: "" } : { code: 1, stdout: "", stderr: "E404" };
		if (command === "npm" && args[0] === "publish") { publishCalls++; published = true; }
		if (command === "gh" && args[1] === "view") return { code: 1, stdout: "", stderr: "release missing" };
		if (command === "gh" && args[1] === "create" && ++releaseAttempts === 1) return { code: 1, stdout: "", stderr: "temporary GitHub outage" };
		return { code: 0, stdout: "", stderr: "" };
	};
	const conflictingTag: RunCommand = async (command, args, options) => {
		if (command === "git" && args[0] === "ls-remote") return { code: 0, stdout: `other-commit\trefs/tags/v${j.version}\n`, stderr: "" };
		return run(command, args, options);
	};
	await assert.rejects(publishCandidate(conflictingTag, root, config, state, j), /tag identity conflict/);
	assert.equal(publishCalls, 0);
	assert.equal(releaseAttempts, 0);
	await assert.rejects(publishCandidate(run, root, config, state, j), /gh failed/);
	assert.equal(j.stage, "merged"); assert.equal(published, true);
	await publishCandidate(run, root, config, state, j);
	assert.equal(j.stage, "published"); assert.equal(publishCalls, 1); assert.equal(releaseAttempts, 2);
});
test("adoption executes actual version and SDK smoke before switching the pointer", async t => {
	const { root, config } = await fixture(t); const j = job(root); j.stage = "published"; j.merge = "merge"; j.integrity = "verified-integrity";
	const run: RunCommand = async (command, args, options) => {
		if (command === "npm" && args[0] === "view") return { code: 0, stdout: JSON.stringify(j.integrity), stderr: "" };
		if (command === "npm" && args[0] === "install") {
			const target = args[args.indexOf("--prefix") + 1]; const pkg = join(target, "node_modules", "catui-agent"); await mkdir(join(pkg, "dist"), { recursive: true });
			await writeFile(join(target, "package-lock.json"), JSON.stringify({ packages: { "node_modules/catui-agent": { integrity: j.integrity } } }));
			await writeFile(join(pkg, "package.json"), '{"type":"module"}');
			await writeFile(join(pkg, "dist", "cli.js"), `process.stdout.write(${JSON.stringify(j.version + "\n")});`);
			await writeFile(join(pkg, "dist", "index.js"), "export const ready = true;");
			return { code: 0, stdout: "", stderr: "" };
		}
		return runCommand(command, args, options);
	};
	await adoptCandidate(run, root, config, j);
	assert.equal(j.stage, "adopted"); assert.equal((await readInstalled(root))?.version, "1.0.1");
});
