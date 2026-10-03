import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyFailureLog, mergeIssueRecords } from "../scripts/dev-loop/failure-parser.js";
import { parsePrChecks } from "../scripts/dev-loop/github-provider.js";
import { assessAutonomyState } from "../scripts/dev-loop/handoff.js";
import { execShellCommand, runVerificationCommands } from "../scripts/dev-loop/run-verification.js";
import { loadVerificationPlan } from "../scripts/dev-loop/verification-plan.js";
import { decideWatchState } from "../scripts/dev-loop/watch-state.js";

test("dev-loop parser fingerprints TypeScript diagnostics by file line column and code", () => {
	const log = [
		"core/runtime/example.ts(12,8): error TS2322: Type 'string' is not assignable to type 'number'.",
		"core/runtime/example.ts(13,8): error TS2322: Type 'boolean' is not assignable to type 'number'.",
	].join("\n");

	const issues = classifyFailureLog({
		source: "local",
		commandId: "tsc",
		command: "npx tsc --noEmit",
		exitCode: 2,
		log,
		logRef: ".catui/dev-loop/run/raw/tsc.log",
	});

	assert.equal(issues.length, 2);
	assert.equal(issues[0]?.kind, "typescript");
	assert.equal(issues[0]?.signature, "typescript:core/runtime/example.ts:12:8:TS2322");
	assert.match(issues[0]?.summary ?? "", /TS2322/);
	assert.equal(issues[0]?.evidence[0]?.logRef, ".catui/dev-loop/run/raw/tsc.log");
});

test("dev-loop parser deduplicates repeated failures and accumulates evidence", () => {
	const first = classifyFailureLog({
		source: "local",
		commandId: "tsc",
		command: "npx tsc --noEmit",
		exitCode: 2,
		log: "src/a.ts(1,2): error TS2304: Cannot find name 'missing'.",
		logRef: "run-1/raw/tsc.log",
	});
	const second = classifyFailureLog({
		source: "local",
		commandId: "tsc",
		command: "npx tsc --noEmit",
		exitCode: 2,
		log: "src/a.ts(1,2): error TS2304: Cannot find name 'missing'.",
		logRef: "run-2/raw/tsc.log",
	});

	const merged = mergeIssueRecords(first, second);

	assert.equal(merged.length, 1);
	assert.equal(merged[0]?.attemptCount, 2);
	assert.deepEqual(
		merged[0]?.evidence.map((item) => item.logRef),
		["run-1/raw/tsc.log", "run-2/raw/tsc.log"],
	);
});

test("dev-loop parser keeps specific TypeScript diagnostics ahead of generic boundary fallback", () => {
	const issues = classifyFailureLog({
		source: "local",
		commandId: "quality",
		command: "npm run verify:quality",
		exitCode: 2,
		log: "scripts/verify-quality.ts(10,4): error TS2345: boundary violation parser input is invalid.",
		logRef: "run/raw/quality.log",
	});

	assert.equal(issues.length, 1);
	assert.equal(issues[0]?.kind, "typescript");
	assert.equal(issues[0]?.signature, "typescript:scripts/verify-quality.ts:10:4:TS2345");
});

test("verification plan rejects unsupported schema versions", async () => {
	await assert.rejects(
		loadVerificationPlan(await writeTempPlan({ schemaVersion: 2, commands: [{ id: "test", command: "npm test", category: "test" }] })),
		/Unsupported verification plan schema/,
	);
});

test("verification plan rejects duplicate command ids", async () => {
	await assert.rejects(
		loadVerificationPlan(
			await writeTempPlan({
				commands: [
					{ id: "test", label: "Test", command: "npm test", required: true, category: "test" },
					{ id: "test", label: "Dev-loop test", command: "npm run test:dev-loop", required: true, category: "test" },
				],
			}),
		),
		/Duplicate verification command id/,
	);
});

test("verification plan rejects commands with missing required fields", async () => {
	await assert.rejects(
		loadVerificationPlan(await writeTempPlan({ commands: [{ id: "test", command: "npm test", category: "test" }] })),
		/Invalid verification command/,
	);
});

test("dev-loop runner writes structured artifacts for failed commands", async () => {
	const artifactRoot = await mkdtemp(join(tmpdir(), "catui-dev-loop-"));

	const result = await runVerificationCommands({
		repoRoot: process.cwd(),
		artifactRoot,
		runId: "run-test",
		commands: [
			{
				id: "unit",
				label: "Unit test",
				command: "npm run test:dev-loop",
				required: true,
				category: "test",
			},
		],
		execCommand: async () => ({
			exitCode: 1,
			stdout: "# Subtest: parser\nnot ok 1 - parser\nAssertionError: expected true to be false",
			stderr: "",
		}),
	});

	assert.equal(result.decision, "continue");
	assert.equal(result.commands[0]?.exitCode, 1);
	assert.equal(result.issues.length, 1);
	assert.equal(result.issues[0]?.kind, "node-test");

	const state = JSON.parse(await readFile(join(artifactRoot, "run-test", "state.json"), "utf8"));
	assert.equal(state.decision, "continue");
	assert.equal(state.currentIssueSignature, result.issues[0]?.signature);

	const issues = JSON.parse(await readFile(join(artifactRoot, "run-test", "issues.json"), "utf8"));
	assert.equal(issues[0]?.signature, result.issues[0]?.signature);
});

test("dev-loop runner treats optional command failures as non-blocking evidence", async () => {
	const artifactRoot = await mkdtemp(join(tmpdir(), "catui-dev-loop-"));

	const result = await runVerificationCommands({
		repoRoot: process.cwd(),
		artifactRoot,
		runId: "run-optional-test",
		commands: [
			{
				id: "optional-test",
				label: "Optional test",
				command: "npm run optional",
				required: false,
				category: "test",
			},
		],
		execCommand: async () => ({
			exitCode: 1,
			stdout: "optional.test.ts(1,1): error TS2304: Cannot find name 'x'.",
			stderr: "",
		}),
	});

	assert.equal(result.decision, "complete");
	assert.equal(result.issues.length, 1);
	assert.equal(result.commands[0]?.required, false);
});

test("execShellCommand escalates timeout termination when SIGTERM is ignored", async () => {
	const command = `${process.execPath} -e "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"`;
	const result = await Promise.race([
		execShellCommand(command, { cwd: process.cwd(), timeoutMs: 20, killGraceMs: 20 }),
		new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 500)),
	]);

	assert.notEqual(result, "hung");
	assert.equal(typeof result, "object");
	if (typeof result === "object") {
		assert.notEqual(result.exitCode, 0);
	}
});

test("dev-loop GitHub provider converts failed PR checks to issue records", () => {
	const checks = parsePrChecks(
		JSON.stringify([
			{
				name: "Test on Node.js 22",
				state: "FAILURE",
				link: "https://github.com/O-Pencil/Catui/actions/runs/123/job/456",
				workflow: "CI",
				bucket: "fail",
				description: "Step failed",
			},
			{
				name: "architecture-boundaries",
				state: "SUCCESS",
				workflow: "quality",
				bucket: "pass",
			},
		]),
		{ prNumber: 42, logByCheckName: new Map([["Test on Node.js 22", "src/a.ts(1,1): error TS2304: Cannot find name 'x'."]]) },
	);

	assert.equal(checks.length, 1);
	assert.equal(checks[0]?.source, "github");
	assert.equal(checks[0]?.commandId, "github:CI:Test on Node.js 22");
	assert.equal(checks[0]?.signature, "typescript:src/a.ts:1:1:TS2304");
	assert.match(checks[0]?.summary ?? "", /PR #42/);
});

test("dev-loop watch state stops green, continues transient failures, and blocks repeated signatures", () => {
	assert.equal(decideWatchState({ localGreen: true, remoteGreen: true, issues: [] }).decision, "complete");

	assert.equal(
		decideWatchState({
			localGreen: false,
			remoteGreen: null,
			issues: [{ signature: "typescript:src/a.ts:1:1:TS2304", attemptCount: 1, status: "open" }],
			maxAttemptsPerIssue: 3,
		}).decision,
		"continue",
	);

	const blocked = decideWatchState({
		localGreen: false,
		remoteGreen: null,
		issues: [{ signature: "typescript:src/a.ts:1:1:TS2304", attemptCount: 3, status: "open" }],
		maxAttemptsPerIssue: 3,
	});
	assert.equal(blocked.decision, "blocked");
	assert.match(blocked.reason ?? "", /attempt budget/);
});

test("dev-loop autonomy state reports handoff-ready repair context", () => {
	const state = assessAutonomyState({
		verificationRun: {
			schemaVersion: 1,
			runId: "run-handoff",
			repoRoot: process.cwd(),
			artifactDir: ".catui/dev-loop/run-handoff",
			startedAt: "2026-06-14T00:00:00.000Z",
			endedAt: "2026-06-14T00:00:10.000Z",
			decision: "continue",
			commands: [
				{
					id: "typecheck",
					label: "TypeScript type check",
					command: "npx tsc --noEmit",
					category: "typecheck",
					required: true,
					startedAt: "2026-06-14T00:00:00.000Z",
					endedAt: "2026-06-14T00:00:10.000Z",
					exitCode: 2,
					rawLogRef: ".catui/dev-loop/run-handoff/raw/typecheck.log",
					compactLogRef: ".catui/dev-loop/run-handoff/compact/typecheck.log",
				},
			],
			issues: [
				{
					id: "abc",
					source: "local",
					commandId: "typecheck",
					command: "npx tsc --noEmit",
					exitCode: 2,
					kind: "typescript",
					signature: "typescript:src/a.ts:1:1:TS2304",
					summary: "TS2304 in src/a.ts:1:1: Cannot find name x",
					evidence: [
						{
							source: "local",
							commandId: "typecheck",
							command: "npx tsc --noEmit",
							exitCode: 2,
							summary: "TS2304 in src/a.ts:1:1: Cannot find name x",
							logRef: ".catui/dev-loop/run-handoff/raw/typecheck.log",
							excerpt: "src/a.ts(1,1): error TS2304: Cannot find name 'x'.",
							observedAt: "2026-06-14T00:00:10.000Z",
						},
					],
					status: "open",
					attemptCount: 1,
					lastFailureLogRef: ".catui/dev-loop/run-handoff/raw/typecheck.log",
				},
			],
			currentIssueSignature: "typescript:src/a.ts:1:1:TS2304",
		},
	});

	assert.equal(state.decision, "continue");
	assert.equal(state.readiness, "repair-ready");
	assert.equal(state.nextIssueSignature, "typescript:src/a.ts:1:1:TS2304");
	assert.match(state.nextAction, /Repair/);
	assert.match(state.handoffMarkdown, /Current Issue/);
	assert.match(state.handoffMarkdown, /npm run dev-loop:verify -- --only typecheck/);
});

async function writeTempPlan(overrides: Record<string, unknown>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "catui-dev-loop-plan-"));
	const path = join(dir, "verification-plan.json");
	const plan = {
		schemaVersion: 1,
		repository: "O-Pencil/Catui",
		description: "Test plan",
		artifactRoot: ".catui/dev-loop",
		commands: [{ id: "test", label: "Test", command: "npm test", required: true, category: "test" }],
		prChecks: { provider: "gh", command: "gh pr checks", watchCommand: "gh pr checks --watch" },
		...overrides,
	};
	await writeFile(path, `${JSON.stringify(plan)}\n`);
	return path;
}
