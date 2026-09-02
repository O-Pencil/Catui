#!/usr/bin/env node
/**
 * [WHO]: Provides local verification command runner and dev-loop:verify CLI
 * [FROM]: Depends on node child_process/fs/path/process plus dev-loop parser, plan, and types
 * [TO]: Consumed by agents and tests to generate VerificationRun artifacts for local repair loops
 * [HERE]: scripts/dev-loop/run-verification.ts within repo-level development loop infrastructure
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { classifyFailureLog, compactLog, mergeIssueRecords } from "./failure-parser.js";
import type { DevLoopDecision, ExecCommand, ExecResult, IssueRecord, VerificationCommand, VerificationRun } from "./types.js";
import { loadVerificationPlan, selectVerificationCommands } from "./verification-plan.js";

export interface RunVerificationOptions {
	repoRoot: string;
	artifactRoot: string;
	runId?: string;
	commands: VerificationCommand[];
	execCommand?: ExecCommand;
}

export async function runVerificationCommands(options: RunVerificationOptions): Promise<VerificationRun> {
	const startedAt = new Date().toISOString();
	const runId = options.runId ?? createRunId();
	const artifactDir = resolve(options.repoRoot, options.artifactRoot, runId);
	const rawDir = resolve(artifactDir, "raw");
	const compactDir = resolve(artifactDir, "compact");
	await mkdir(rawDir, { recursive: true });
	await mkdir(compactDir, { recursive: true });

	const commandResults: VerificationRun["commands"] = [];
	let issues: IssueRecord[] = [];

	for (const command of options.commands) {
		const commandStartedAt = new Date().toISOString();
		const result = await (options.execCommand ?? execShellCommand)(command.command, {
			cwd: options.repoRoot,
			timeoutMs: command.timeoutMs,
		});
		const commandEndedAt = new Date().toISOString();
		const combinedLog = [result.stdout, result.stderr].filter(Boolean).join("\n");
		const rawLogRef = `${options.artifactRoot}/${runId}/raw/${command.id}.log`;
		const compactLogRef = `${options.artifactRoot}/${runId}/compact/${command.id}.log`;
		await writeFile(resolve(rawDir, `${command.id}.log`), combinedLog);
		await writeFile(resolve(compactDir, `${command.id}.log`), compactLog(combinedLog));

		commandResults.push({
			id: command.id,
			label: command.label,
			command: command.command,
			category: command.category,
			required: command.required,
			startedAt: commandStartedAt,
			endedAt: commandEndedAt,
			exitCode: result.exitCode,
			rawLogRef,
			compactLogRef,
		});

		if (result.exitCode !== 0) {
			const parsed = classifyFailureLog({
				source: "local",
				commandId: command.id,
				command: command.command,
				exitCode: result.exitCode,
				log: combinedLog,
				logRef: rawLogRef,
				observedAt: commandEndedAt,
			});
			issues = mergeIssueRecords(issues, parsed);
		}
	}

	const requiredFailed = commandResults.some((command) => command.required && command.exitCode !== 0);
	const decision: DevLoopDecision = requiredFailed ? "continue" : "complete";
	const run: VerificationRun = {
		schemaVersion: 1,
		runId,
		repoRoot: options.repoRoot,
		artifactDir: `${options.artifactRoot}/${runId}`,
		startedAt,
		endedAt: new Date().toISOString(),
		decision,
		commands: commandResults,
		issues,
		currentIssueSignature: issues[0]?.signature,
	};

	await writeFile(resolve(artifactDir, "state.json"), `${JSON.stringify(toState(run), null, 2)}\n`);
	await writeFile(resolve(artifactDir, "issues.json"), `${JSON.stringify(issues, null, 2)}\n`);
	await writeFile(resolve(artifactDir, "verification-run.json"), `${JSON.stringify(run, null, 2)}\n`);
	await writeFile(resolve(artifactDir, "attempts.jsonl"), `${JSON.stringify({ type: "verification-run", ...toState(run) })}\n`);
	await writeFile(resolve(artifactDir, "progress-log.md"), renderProgressLog(run));

	return run;
}

export async function execShellCommand(command: string, options: { cwd: string; timeoutMs?: number; killGraceMs?: number }): Promise<ExecResult> {
	return await new Promise((resolvePromise) => {
		const child = spawn(command, {
			cwd: options.cwd,
			detached: true,
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdoutText = "";
		let stderrText = "";
		let timedOut = false;
		const killGraceMs = options.killGraceMs ?? 1_000;
		let killTimer: NodeJS.Timeout | undefined;
		const timer = options.timeoutMs
			? setTimeout(() => {
					timedOut = true;
					killChildProcess(child.pid, "SIGTERM", child.kill.bind(child));
					killTimer = setTimeout(() => {
						killChildProcess(child.pid, "SIGKILL", child.kill.bind(child));
					}, killGraceMs);
				}, options.timeoutMs)
			: undefined;
		child.stdout?.on("data", (chunk: Buffer) => {
			stdoutText += chunk.toString("utf8");
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderrText += chunk.toString("utf8");
		});
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			const timeoutMessage = timedOut ? `Command timed out after ${options.timeoutMs}ms` : "";
			resolvePromise({ exitCode: code ?? 1, stdout: stdoutText, stderr: appendLine(stderrText, timeoutMessage) });
		});
		child.on("error", (error) => {
			if (timer) clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			resolvePromise({ exitCode: 1, stdout: stdoutText, stderr: `${stderrText}\n${error.message}` });
		});
	});
}

function killChildProcess(pid: number | undefined, signal: NodeJS.Signals, fallbackKill: (signal: NodeJS.Signals) => boolean): void {
	if (!pid) return;
	if (process.platform === "win32") {
		// Windows has no POSIX process-group SIGTERM semantics. Killing only the
		// shell can orphan its child and keep captured pipes open indefinitely,
		// so terminate the entire tree at the timeout boundary.
		const args = ["/PID", String(pid), "/T", "/F"];
		const result = spawnSync("taskkill", args, { windowsHide: true, stdio: "ignore" });
		if (result.status !== 0) fallbackKill(signal);
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch {
		fallbackKill(signal);
	}
}

function appendLine(text: string, line: string): string {
	if (!line) return text;
	return text ? `${text}\n${line}` : line;
}

function toState(run: VerificationRun): Record<string, unknown> {
	return {
		schemaVersion: run.schemaVersion,
		runId: run.runId,
		decision: run.decision,
		startedAt: run.startedAt,
		endedAt: run.endedAt,
		currentIssueSignature: run.currentIssueSignature,
		commandCount: run.commands.length,
		failedCommandCount: run.commands.filter((command) => command.exitCode !== 0).length,
		issueCount: run.issues.length,
		blockedReason: run.blockedReason,
	};
}

function renderProgressLog(run: VerificationRun): string {
	const lines = [
		`# Dev Loop Run ${run.runId}`,
		"",
		`Decision: ${run.decision}`,
		`Started: ${run.startedAt}`,
		`Ended: ${run.endedAt}`,
		"",
		"## Commands",
		"",
		...run.commands.map((command) => `- ${command.id}: exit ${command.exitCode} (${command.command})`),
		"",
		"## Issues",
		"",
		...(run.issues.length > 0 ? run.issues.map((issue) => `- ${issue.signature}: ${issue.summary}`) : ["- none"]),
		"",
	];
	return `${lines.join("\n")}\n`;
}

function createRunId(): string {
	return `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

async function main(): Promise<void> {
	const args = argv.slice(2);
	const plan = await loadVerificationPlan(readFlag(args, "--plan"));
	const ids = readListFlag(args, "--only");
	const artifactRoot = readFlag(args, "--artifact-root") ?? plan.artifactRoot;
	const run = await runVerificationCommands({
		repoRoot: cwd(),
		artifactRoot,
		runId: readFlag(args, "--run-id"),
		commands: selectVerificationCommands(plan, ids),
	});
	stdout.write(`${JSON.stringify(run, null, 2)}\n`);
	if (run.decision !== "complete") exit(1);
}

function readFlag(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}

function readListFlag(args: string[], flag: string): string[] {
	const value = readFlag(args, flag);
	return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
		exit(1);
	});
}
