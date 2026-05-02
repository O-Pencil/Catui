import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SubAgentHandle, SubAgentResult } from "../core/sub-agent/index.js";
import type { WorkspacePath } from "../core/workspace/index.js";
import { TeamRuntime } from "../extensions/defaults/team/team-runtime.js";
import { runLeaderOrchestration } from "../extensions/defaults/team/team-orchestrator.js";

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
}

function flushAsyncWork(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error("Timed out waiting for async state");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function createPendingHandle(id: string) {
	let status: SubAgentHandle["status"] = "running";
	let resolveResult: ((result: SubAgentResult) => void) | undefined;
	const resultPromise = new Promise<SubAgentResult>((resolve) => {
		resolveResult = resolve;
	});

	const handle: SubAgentHandle = {
		id,
		get status() {
			return status;
		},
		async result(): Promise<SubAgentResult> {
			return resultPromise;
		},
		async abort(): Promise<void> {
			status = "aborted";
			resolveResult?.({ success: false, error: "Aborted" });
		},
		async terminate(): Promise<void> {
			status = "aborted";
			resolveResult?.({ success: false, error: "Aborted" });
		},
	};

	return { handle };
}

test("team-runtime: stop keeps teammate in stopped state and records aborted result", async () => {
	const storageDir = createTempDir("nanopencil-team-stop-");
	const runtime = new TeamRuntime({ storageDir });
	const { handle } = createPendingHandle("stop-handle");
	(runtime as any).subAgentRuntime = {
		spawn: async () => handle,
		terminateAll: async () => {},
	};

	try {
		await runtime.spawn({ role: "researcher", name: "scout", baseCwd: process.cwd() });

		const sendPromise = runtime.send("scout", "ping");
		await waitFor(() => Boolean((runtime as any).teammates.get("scout")?.handle));
		assert.equal(await runtime.stop("scout"), true);

		const result = await sendPromise;
		assert.equal(result.success, false);
		assert.equal(result.aborted, true);
		assert.equal(runtime.getTeammate("scout")?.status, "stopped");

		const mailboxTypes = runtime.getMailbox().list().map((message) => message.type);
		assert.deepEqual(mailboxTypes, ["task_request", "task_result"]);

		const teammateId = runtime.getTeammate("scout")?.identity.id;
		assert.ok(teammateId);
		const transcriptPath = join(storageDir, "transcripts", `${teammateId}.jsonl`);
		const transcriptEntries = readFileSync(transcriptPath, "utf-8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { kind: string; content: string });
		assert.deepEqual(transcriptEntries.map((entry) => entry.kind), ["leader", "teammate"]);
		assert.equal(transcriptEntries[1]?.content, "Aborted");
	} finally {
		await runtime.terminate("scout").catch(() => {});
		await runtime.dispose();
		rmSync(storageDir, { recursive: true, force: true });
	}
});

test("team-runtime: error path posts task_result and writes transcript", async () => {
	const storageDir = createTempDir("nanopencil-team-error-");
	const runtime = new TeamRuntime({ storageDir });
	const handle: SubAgentHandle = {
		id: "error-handle",
		status: "running",
		async result(): Promise<SubAgentResult> {
			throw new Error("boom");
		},
		async abort(): Promise<void> {},
		async terminate(): Promise<void> {},
	};
	(runtime as any).subAgentRuntime = {
		spawn: async () => handle,
		terminateAll: async () => {},
	};

	try {
		await runtime.spawn({ role: "researcher", name: "reviewer-1", baseCwd: process.cwd() });

		const result = await runtime.send("reviewer-1", "explode");
		assert.equal(result.success, false);
		assert.equal(result.error, "boom");
		assert.equal(runtime.getTeammate("reviewer-1")?.status, "error");

		const mailbox = runtime.getMailbox().list();
		assert.equal(mailbox.length, 2);
		assert.equal(mailbox[1]?.type, "task_result");
		assert.equal(mailbox[1]?.payload.error, "boom");

		const teammateId = runtime.getTeammate("reviewer-1")?.identity.id;
		assert.ok(teammateId);
		const transcriptPath = join(storageDir, "transcripts", `${teammateId}.jsonl`);
		const transcriptEntries = readFileSync(transcriptPath, "utf-8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { kind: string; content: string });
		assert.deepEqual(transcriptEntries.map((entry) => entry.kind), ["leader", "teammate"]);
		assert.equal(transcriptEntries[1]?.content, "Error: boom");
	} finally {
		await runtime.terminate("reviewer-1").catch(() => {});
		await runtime.dispose();
		rmSync(storageDir, { recursive: true, force: true });
	}
});

test("team-runtime: queues concurrent sends for the same teammate", async () => {
	const storageDir = createTempDir("nanopencil-team-queue-");
	const runtime = new TeamRuntime({ storageDir });
	let active = 0;
	let maxActive = 0;
	let sequence = 0;
	(runtime as any).subAgentRuntime = {
		spawn: async () => {
			const order = ++sequence;
			return {
				id: `queue-handle-${order}`,
				status: "running",
				async result(): Promise<SubAgentResult> {
					active++;
					maxActive = Math.max(maxActive, active);
					await new Promise((resolve) => setTimeout(resolve, order === 1 ? 40 : 1));
					active--;
					return { success: true, response: `done ${order}` };
				},
				async abort(): Promise<void> {},
				async terminate(): Promise<void> {},
			};
		},
		terminateAll: async () => {},
	};

	try {
		await runtime.spawn({ role: "researcher", name: "scout", baseCwd: process.cwd() });

		const first = runtime.send("scout", "first");
		const second = runtime.send("scout", "second");
		const results = await Promise.all([first, second]);

		assert.deepEqual(results.map((result) => result.response), ["done 1", "done 2"]);
		assert.equal(maxActive, 1);
		assert.equal(runtime.getTeammate("scout")?.messages.filter((message) => message.direction === "leader").length, 2);
		const mailboxTypes = runtime.getMailbox().list().map((message) => message.type);
		assert.equal(mailboxTypes.filter((type) => type === "task_result").length, 2);
		assert.equal(mailboxTypes.includes("task_progress"), true);
	} finally {
		await runtime.terminate("scout").catch(() => {});
		await runtime.dispose();
		rmSync(storageDir, { recursive: true, force: true });
	}
});

test("team-runtime: forwards sub-agent realtime events and clears live state after completion", async () => {
	const storageDir = createTempDir("nanopencil-team-live-");
	const runtime = new TeamRuntime({ storageDir });
	(runtime as any).subAgentRuntime = {
		spawn: async (spec: { onEvent?: (event: any) => void }) => ({
			id: "live-handle",
			status: "running",
			async result(): Promise<SubAgentResult> {
				spec.onEvent?.({ type: "agent_start", subAgentId: "live-handle", timestamp: Date.now() });
				spec.onEvent?.({
					type: "message_update",
					subAgentId: "live-handle",
					timestamp: Date.now(),
					text: "streaming partial answer",
				});
				spec.onEvent?.({
					type: "tool_start",
					subAgentId: "live-handle",
					timestamp: Date.now(),
					toolName: "read",
					args: {},
				});
				return { success: true, response: "done" };
			},
			async abort(): Promise<void> {},
			async terminate(): Promise<void> {},
		}),
		terminateAll: async () => {},
	};

	try {
		await runtime.spawn({ role: "researcher", name: "scout", baseCwd: process.cwd() });
		const events: string[] = [];
		const result = await runtime.send("scout", "observe", undefined, {
			onEvent: (event) => {
				events.push(event.type === "teammate_live" ? event.event.type : event.type);
			},
		});

		assert.equal(result.success, true);
		assert.deepEqual(events, ["teammate_status", "agent_start", "message_update", "tool_start", "teammate_status"]);
		assert.equal(runtime.getTeammate("scout")?.live, undefined);
	} finally {
		await runtime.terminate("scout").catch(() => {});
		await runtime.dispose();
		rmSync(storageDir, { recursive: true, force: true });
	}
});


test("team-runtime: execute approval emits permission response and mode change", async () => {
	const storageDir = createTempDir("nanopencil-team-approve-");
	const runtime = new TeamRuntime({ storageDir });
	const implementerWorkspace = createTempDir("nanopencil-team-worktree-");
	(runtime as any).worktreeManager = {
		createGitWorktree: async (): Promise<WorkspacePath> => ({
			path: implementerWorkspace,
			type: "temp",
		}),
		dispose: async (): Promise<void> => {},
	};

	try {
		await runtime.spawn({ role: "implementer", name: "builder", baseCwd: process.cwd() });
		const modeChange = await runtime.setMode("builder", "execute");
		assert.ok(modeChange.pending);

		assert.equal(runtime.approvePermission(modeChange.pending!.requestId), true);
		await waitFor(() => runtime.getMailbox().list().length === 3);

		assert.equal(runtime.getTeammate("builder")?.mode, "execute");
		assert.deepEqual(
			runtime.getMailbox().list().map((message) => message.type),
			["permission_request", "permission_response", "mode_change"],
		);
	} finally {
		await runtime.terminate("builder").catch(() => {});
		await runtime.dispose();
		rmSync(implementerWorkspace, { recursive: true, force: true });
		rmSync(storageDir, { recursive: true, force: true });
	}
});

test("team-runtime: auto-generated names remain unique after reload", async () => {
	const storageDir = createTempDir("nanopencil-team-names-");
	const firstRuntime = new TeamRuntime({ storageDir });

	try {
		const first = await firstRuntime.spawn({ role: "researcher", baseCwd: process.cwd() });
		assert.equal(first.identity.name, "researcher-1");
		assert.equal(first.identity.label, "A");
		await firstRuntime.dispose();

		const secondRuntime = new TeamRuntime({ storageDir });
		try {
			await secondRuntime.load();
			const second = await secondRuntime.spawn({ role: "researcher", baseCwd: process.cwd() });
			assert.equal(second.identity.name, "researcher-2");
			assert.equal(second.identity.label, "B");
			assert.notEqual(second.identity.name, first.identity.name);

			await secondRuntime.terminate(first.identity.name);
			await secondRuntime.terminate(second.identity.name);
		} finally {
			await secondRuntime.dispose();
		}
	} finally {
		rmSync(storageDir, { recursive: true, force: true });
	}
});

test("team-runtime: persists shared tasks and teammate mailbox across reload", async () => {
	const storageDir = createTempDir("nanopencil-team-shared-");
	const firstRuntime = new TeamRuntime({ storageDir });

	try {
		await firstRuntime.spawn({ role: "researcher", name: "scout", baseCwd: process.cwd() });
		await firstRuntime.spawn({ role: "reviewer", name: "reviewer", baseCwd: process.cwd() });
		const task = await firstRuntime.addTask("Map team implementation");
		const claimed = await firstRuntime.claimTask(task.id, "scout");
		assert.equal(claimed?.ownerName, "scout");
		assert.equal(await firstRuntime.sendTeammateMail("scout", "reviewer", "Please review the task."), true);
		await firstRuntime.dispose();

		const secondRuntime = new TeamRuntime({ storageDir });
		try {
			await secondRuntime.load();
			const tasks = await secondRuntime.listTasks();
			assert.equal(tasks.length, 1);
			assert.equal(tasks[0]?.status, "claimed");
			assert.equal(tasks[0]?.ownerName, "scout");

			const mailbox = secondRuntime.getMailbox().list();
			assert.deepEqual(
				mailbox.map((message) => message.type),
				["task_update", "task_claim", "teammate_message"],
			);
			assert.equal(mailbox[2]?.targetTeammateName, "reviewer");
		} finally {
			await secondRuntime.terminate("scout").catch(() => {});
			await secondRuntime.terminate("reviewer").catch(() => {});
			await secondRuntime.dispose();
		}
	} finally {
		rmSync(storageDir, { recursive: true, force: true });
	}
});

test("team-runtime: injects claimed tasks and mailbox into teammate prompt", async () => {
	const storageDir = createTempDir("nanopencil-team-context-");
	const runtime = new TeamRuntime({ storageDir });
	let capturedPrompt = "";
	(runtime as any).subAgentRuntime = {
		spawn: async (spec: { prompt: string }) => {
			capturedPrompt = spec.prompt;
			return {
				id: "context-handle",
				status: "running",
				async result(): Promise<SubAgentResult> {
					return { success: true, response: "ok" };
				},
				async abort(): Promise<void> {},
				async terminate(): Promise<void> {},
			};
		},
		terminateAll: async () => {},
	};

	try {
		await runtime.spawn({ role: "researcher", name: "scout", baseCwd: process.cwd() });
		await runtime.spawn({ role: "reviewer", name: "reviewer", baseCwd: process.cwd() });
		const task = await runtime.addTask("Map team implementation");
		await runtime.claimTask(task.id, "scout");
		await runtime.sendTeammateMail("reviewer", "scout", "Please include mailbox context.");

		const result = await runtime.send("scout", "continue");
		assert.equal(result.success, true);
		assert.match(capturedPrompt, /Shared team tasks:/);
		assert.match(capturedPrompt, /Claimed by you:/);
		assert.match(capturedPrompt, /T-1 \[claimed\].*Map team implementation/);
		assert.match(capturedPrompt, /Recent team mailbox:/);
		assert.match(capturedPrompt, /reviewer -> scout: Please include mailbox context\./);
	} finally {
		await runtime.terminate("scout").catch(() => {});
		await runtime.terminate("reviewer").catch(() => {});
		await runtime.dispose();
		rmSync(storageDir, { recursive: true, force: true });
	}
});

test("team-orchestrator: prompt smoke runs leader assignment and agent response", async () => {
	const storageDir = createTempDir("nanopencil-team-prompt-smoke-");
	const workDir = createTempDir("nanopencil-team-prompt-work-");
	const runtime = new TeamRuntime({ storageDir });
	const utterances: string[] = [];
	const events: string[] = [];
	(runtime as any).worktreeManager = {
		createGitWorktree: async (): Promise<WorkspacePath> => ({
			path: workDir,
			type: "temp",
		}),
		dispose: async (): Promise<void> => {},
	};
	(runtime as any).subAgentRuntime = {
		spawn: async (spec: { onEvent?: (event: any) => void }) => ({
			id: "prompt-smoke-handle",
			status: "running",
			async result(): Promise<SubAgentResult> {
				spec.onEvent?.({
					type: "message_update",
					subAgentId: "prompt-smoke-handle",
					timestamp: Date.now(),
					text: "I checked the repo shape and can report the architecture summary.",
				});
				return { success: true, response: "Architecture path mapped. No handoff needed." };
			},
			async abort(): Promise<void> {},
			async terminate(): Promise<void> {},
		}),
		terminateAll: async () => {},
	};

	try {
		const result = await runLeaderOrchestration(runtime, {
			taskDescription: "Analyze the project architecture and identify the main modules.",
			baseCwd: process.cwd(),
			onRuntimeEvent: (event) => events.push(event.type === "teammate_live" ? event.event.type : event.type),
			completeSimple: async (systemPrompt) => {
				if (systemPrompt.includes("select the smallest useful AgentTeam preset")) {
					return JSON.stringify({
						presetName: "duo",
						rationale: "Architecture analysis benefits from a dedicated architect.",
						startTargetRole: "architect",
					});
				}
				return JSON.stringify({
					subtasks: [
						{
							owner: "Ada",
							title: "Map architecture",
							task: "Inspect the repository structure and summarize the main modules.",
							dependsOn: [],
						},
					],
				});
			},
			emitUtterance: (utterance) => utterances.push(`${utterance.speakerLabel}: ${utterance.text}`),
		});

		assert.equal(result.plan.completionState, "completed");
		assert.equal(result.plan.subtasks.length, 1);
		assert.match(utterances.join("\n"), /pencil: I split the goal/);
		assert.match(utterances.join("\n"), /pencil: @Ada/);
		assert.match(utterances.join("\n"), /Ada: Architecture path mapped/);
		assert.ok(events.includes("message_update"));
	} finally {
		await runtime.terminate("Ada").catch(() => {});
		await runtime.terminate("Theo").catch(() => {});
		await runtime.dispose();
		cleanupDir(workDir);
		cleanupDir(storageDir);
	}
});

test("team-orchestrator: long website prompt coordinates the named squad", async () => {
	const storageDir = createTempDir("nanopencil-team-website-smoke-");
	const workDir = createTempDir("nanopencil-team-website-work-");
	const runtime = new TeamRuntime({ storageDir });
	const utterances: string[] = [];
	const startedAgents: string[] = [];
	(runtime as any).worktreeManager = {
		createGitWorktree: async (): Promise<WorkspacePath> => ({
			path: workDir,
			type: "temp",
		}),
		dispose: async (): Promise<void> => {},
	};
	(runtime as any).subAgentRuntime = {
		spawn: async (spec: { prompt: string; onEvent?: (event: any) => void }) => {
			const name = (/Name:\s+(.+)/.exec(spec.prompt)?.[1] ?? "agent").trim();
			startedAgents.push(name);
			return {
				id: `website-${name}`,
				status: "running",
				async result(): Promise<SubAgentResult> {
					spec.onEvent?.({
						type: "message_update",
						subAgentId: `website-${name}`,
						timestamp: Date.now(),
						text: `${name} is working on the nanoPencil website delivery.`,
					});
					return {
						success: true,
						response: `${name} completed the assigned website step for the nanoPencil homepage.`,
					};
				},
				async abort(): Promise<void> {},
				async terminate(): Promise<void> {},
			};
		},
		terminateAll: async () => {},
	};

	try {
		const result = await runLeaderOrchestration(runtime, {
			taskDescription:
				"Build a polished nanoPencil official website with product positioning, architecture overview, feature sections, TUI screenshots, installation flow, and release-readiness checks.",
			baseCwd: process.cwd(),
			completeSimple: async (systemPrompt) => {
				if (systemPrompt.includes("select the smallest useful AgentTeam preset")) {
					return JSON.stringify({
						presetName: "squad",
						rationale: "A website needs PM framing, architecture, implementation, design, and evidence review.",
						startTargetRole: "pm",
					});
				}
				return JSON.stringify({
					subtasks: [
						{
							owner: "Mason",
							title: "Frame website scope",
							task: "Define the official website audience, positioning, and success criteria.",
							dependsOn: [],
						},
						{
							owner: "Ada",
							title: "Design implementation architecture",
							task: "Map the page structure, routes, reusable sections, and assets needed for the website.",
							dependsOn: ["Mason"],
						},
						{
							owner: "Theo",
							title: "Implement website",
							task: "Create the homepage implementation with installation, features, and TUI collaboration sections.",
							dependsOn: ["Ada"],
						},
						{
							owner: "Iris",
							title: "Review UX and visual polish",
							task: "Review copy, hierarchy, spacing, and terminal-native visual language.",
							dependsOn: ["Theo"],
						},
						{
							owner: "Quinn",
							title: "Validate evidence and release risks",
							task: "Check claims, test coverage, and release readiness for the website work.",
							dependsOn: ["Theo"],
						},
					],
				});
			},
			emitUtterance: (utterance) => utterances.push(`${utterance.speakerLabel}: ${utterance.text}`),
		});

		assert.equal(result.plan.completionState, "completed");
		assert.deepEqual(result.plan.subtasks.map((subtask) => subtask.ownerName), ["Mason", "Ada", "Theo", "Iris", "Quinn"]);
		assert.deepEqual(startedAgents, ["Mason", "Ada", "Theo", "Iris", "Quinn"]);
		assert.match(utterances.join("\n"), /pencil: @Mason/);
		assert.match(utterances.join("\n"), /Theo: Theo completed the assigned website step/);
		assert.match(utterances.join("\n"), /Iris: Iris completed the assigned website step/);
		assert.match(utterances.join("\n"), /Quinn: Quinn completed the assigned website step/);
	} finally {
		for (const name of ["Mason", "Ada", "Theo", "Iris", "Quinn"]) {
			await runtime.terminate(name).catch(() => {});
		}
		await runtime.dispose();
		cleanupDir(workDir);
		cleanupDir(storageDir);
	}
});

test("team-runtime: execute write tools reject paths outside cwd unless allowlisted", async () => {
	const storageDir = createTempDir("nanopencil-team-guard-state-");
	const workDir = createTempDir("nanopencil-team-guard-work-");
	const outsideDir = createTempDir("nanopencil-team-guard-outside-");
	const runtime = new TeamRuntime({ storageDir });
	(runtime as any).worktreeManager = {
		createGitWorktree: async (): Promise<WorkspacePath> => ({
			path: workDir,
			type: "temp",
		}),
		dispose: async (): Promise<void> => {},
	};

	try {
		await runtime.spawn({ role: "implementer", name: "builder", baseCwd: process.cwd() });
		const modeChange = await runtime.setMode("builder", "execute");
		assert.ok(modeChange.pending);
		assert.equal(runtime.approvePermission(modeChange.pending!.requestId), true);
		await waitFor(() => runtime.getTeammate("builder")?.mode === "execute");

			const tools = (runtime as any).selectTools("execute", workDir) as Array<{
				name: string;
				execute: (id: string, input: { path?: string; content?: string; command?: string }) => Promise<unknown>;
			}>;
			const writeTool = tools.find((tool) => tool.name === "write");
			const bashTool = tools.find((tool) => tool.name === "bash");
			assert.ok(writeTool);
			assert.ok(bashTool);
			const guard = (runtime as any).createWritePathGuard(workDir) as (path: string) => void;

			await writeTool!.execute("ok", { path: "inside.txt", content: "ok" });
			assert.equal(readFileSync(join(workDir, "inside.txt"), "utf-8"), "ok");
			await bashTool!.execute("bash-ok", { command: "echo bash-ok > bash-inside.txt" });
			assert.equal(readFileSync(join(workDir, "bash-inside.txt"), "utf-8").trim(), "bash-ok");

			assert.throws(() => guard(join(outsideDir, "outside.txt")), /Write denied/);
			await assert.rejects(
				() => bashTool!.execute("bash-denied", { command: `echo no > ${join(outsideDir, "bash-outside.txt")}` }),
				/Write operations outside the teammate workspace are not allowed/,
			);

			await runtime.allowPath("builder", outsideDir);
			assert.doesNotThrow(() => guard(join(outsideDir, "outside.txt")));
			await writeTool!.execute("allowed", { path: join(outsideDir, "outside.txt"), content: "yes" });
			assert.equal(readFileSync(join(outsideDir, "outside.txt"), "utf-8"), "yes");
	} finally {
		await runtime.terminate("builder").catch(() => {});
		await runtime.dispose();
		rmSync(workDir, { recursive: true, force: true });
		rmSync(outsideDir, { recursive: true, force: true });
		rmSync(storageDir, { recursive: true, force: true });
	}
});

test("team-runtime: recovered implementer worktree can be terminated after reload", async () => {
	const repoDir = createTempDir("nanopencil-team-recover-repo-");
	const storageDir = createTempDir("nanopencil-team-recover-state-");

	try {
		writeFileSync(join(repoDir, "tracked.txt"), "base\n", "utf-8");
		await mkdir(join(repoDir, "nested"), { recursive: true });
		execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
		execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir, stdio: "ignore" });
		execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, stdio: "ignore" });
		execFileSync("git", ["add", "tracked.txt"], { cwd: repoDir, stdio: "ignore" });
		execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, stdio: "ignore" });

		const firstRuntime = new TeamRuntime({ storageDir });
		const builder = await firstRuntime.spawn({ role: "implementer", name: "builder", baseCwd: repoDir });
		assert.ok(builder.worktreePath);
		assert.equal(existsSync(builder.worktreePath!), true);
		await firstRuntime.dispose();

		const secondRuntime = new TeamRuntime({ storageDir });
		try {
			await secondRuntime.load();
			assert.equal(await secondRuntime.terminate("builder"), true);
		} finally {
			await secondRuntime.dispose();
		}

		assert.equal(existsSync(builder.worktreePath!), false);
		const worktreeList = execFileSync("git", ["worktree", "list", "--porcelain"], {
			cwd: repoDir,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		assert.equal(worktreeList.includes(builder.worktreePath!), false);
	} finally {
		cleanupDir(repoDir);
		cleanupDir(storageDir);
	}
});

test("team-runtime: harness send creates checkpoint and advances phase", async () => {
	const repoDir = createTempDir("nanopencil-team-harness-repo-");
	const storageDir = createTempDir("nanopencil-team-harness-state-");

	try {
		initGitRepo(repoDir);
		const runtime = new TeamRuntime({ storageDir });
		(runtime as any).worktreeManager = {
			createGitWorktree: async (): Promise<WorkspacePath> => ({
				path: repoDir,
				type: "worktree",
			}),
			dispose: async (): Promise<void> => {},
		};
		(runtime as any).subAgentRuntime = {
			spawn: async (spec: { cwd: string; exitHook?: (result: SubAgentResult) => Promise<void> }) => ({
				id: "harness-handle",
				status: "running",
				async result(): Promise<SubAgentResult> {
					writeHarnessFeatureList(spec.cwd, "Original feature", false);
					writeFileSync(join(spec.cwd, "implemented.txt"), "done\n", "utf-8");
					const result = { success: true, response: "initialized" };
					await spec.exitHook?.(result);
					return result;
				},
				async abort(): Promise<void> {},
				async terminate(): Promise<void> {},
			}),
			terminateAll: async () => {},
		};

		const teammate = await runtime.spawn({
			role: "implementer",
			name: "builder",
			baseCwd: repoDir,
			harnessEnabled: true,
		});
		assert.equal(teammate.mode, "execute");

		const result = await runtime.send("builder", "build it");
		assert.equal(result.success, true);
		const updated = runtime.getTeammate("builder");
		assert.equal(updated?.harness?.phase, "coding");
		assert.equal(updated?.harness?.passedFeatures, 0);
		assert.ok(updated?.harness?.lastCheckpointCommit);
		assert.match(
			execFileSync("git", ["log", "--oneline", "-1"], { cwd: repoDir, encoding: "utf-8" }),
			/harness: init checkpoint/,
		);
		await runtime.dispose();
		await flushAsyncWork();
	} finally {
		cleanupDir(repoDir);
		cleanupDir(storageDir);
	}
});

test("team-runtime: harness violation is quarantined and reverted", async () => {
	const repoDir = createTempDir("nanopencil-team-harness-revert-repo-");
	const storageDir = createTempDir("nanopencil-team-harness-revert-state-");

	try {
		initGitRepo(repoDir);
		const runtime = new TeamRuntime({ storageDir });
		(runtime as any).worktreeManager = {
			createGitWorktree: async (): Promise<WorkspacePath> => ({
				path: repoDir,
				type: "worktree",
			}),
			dispose: async (): Promise<void> => {},
		};

		let turn = 0;
		(runtime as any).subAgentRuntime = {
			spawn: async (spec: { cwd: string; exitHook?: (result: SubAgentResult) => Promise<void> }) => ({
				id: `harness-handle-${turn}`,
				status: "running",
				async result(): Promise<SubAgentResult> {
					turn++;
					writeHarnessFeatureList(spec.cwd, turn === 1 ? "Original feature" : "Tampered feature", false);
					const result = { success: true, response: `turn ${turn}` };
					await spec.exitHook?.(result);
					return result;
				},
				async abort(): Promise<void> {},
				async terminate(): Promise<void> {},
			}),
			terminateAll: async () => {},
		};

		await runtime.spawn({
			role: "implementer",
			name: "builder",
			baseCwd: repoDir,
			harnessEnabled: true,
		});
		await runtime.send("builder", "init");
		await runtime.send("builder", "tamper");

		const updated = runtime.getTeammate("builder");
		assert.equal(updated?.harness?.phase, "fix");
		assert.ok(updated?.harness?.lastRevertCommit);
		assert.match(readFileSync(join(repoDir, ".nanopencil-harness", "feature_list.json"), "utf-8"), /Original feature/);
		assert.match(
			execFileSync("git", ["log", "--oneline", "-1"], { cwd: repoDir, encoding: "utf-8" }),
			/Revert "harness: quarantine invalid turn"/,
		);
		await runtime.dispose();
		await flushAsyncWork();
	} finally {
		rmSync(repoDir, { recursive: true, force: true });
		rmSync(storageDir, { recursive: true, force: true });
	}
});

function initGitRepo(repoDir: string): void {
	writeFileSync(join(repoDir, "tracked.txt"), "base\n", "utf-8");
	execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
	execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir, stdio: "ignore" });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, stdio: "ignore" });
	execFileSync("git", ["add", "tracked.txt"], { cwd: repoDir, stdio: "ignore" });
	execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, stdio: "ignore" });
}

function writeHarnessFeatureList(cwd: string, description: string, passes: boolean): void {
	const harnessDir = join(cwd, ".nanopencil-harness");
	mkdirSync(harnessDir, { recursive: true });
	writeFileSync(
		join(harnessDir, "feature_list.json"),
		JSON.stringify(
			{
				version: 1,
				generatedAt: "2026-04-26T00:00:00.000Z",
				taskDescription: "test task",
				features: [
					{
						id: "F001",
						category: "functional",
						description,
						steps: ["check output"],
						passes,
						priority: 1,
					},
				],
			},
			null,
			2,
		),
		"utf-8",
	);
	writeFileSync(join(harnessDir, "progress.txt"), `Feature: ${description}\n`, "utf-8");
}
