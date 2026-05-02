/**
 * [WHO]: TeamRuntime - teammate registry and lifecycle management
 * [FROM]: Depends on ./team-types, ./team-state-store, core/sub-agent/*, core/workspace/*
 * [TO]: Consumed by index.ts
 * [HERE]: extensions/defaults/team/team-runtime.ts
 *
 * Manages persistent teammates with durable state.
 * Each teammate has identity, mode, status, worktree, and message history.
 * Uses SubAgentRuntime for actual agent spawning.
 */

import { SubAgentRuntime } from "../../../core/sub-agent/index.js";
import type { SubAgentEvent, SubAgentHandle, SubAgentSpec } from "../../../core/sub-agent/index.js";
import { WorktreeManager } from "../../../core/workspace/index.js";
import type { WorkspacePath } from "../../../core/workspace/index.js";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
	createBashTool,
	createCodingTools,
	createReadOnlyTools,
	createSandboxHook,
	type Tool,
} from "../../../core/tools/index.js";
import type { Model } from "@pencil-agent/ai";
import { TeamStateStore } from "./team-state-store.js";
import { PermissionStore } from "./team-permissions.js";
import { TeamMailbox } from "./team-mailbox.js";
import { TeamTaskStore } from "./team-task-store.js";
import { TeamTranscriptWriter } from "./team-transcript.js";
import {
	beginHarnessTurn,
	buildHarnessInstructions,
	createInitialHarnessState,
	ensureHarnessFiles,
	inspectHarnessExit,
	prepareContextFiles,
} from "./team-harness.js";
import { buildPsychePrompt, computePsycheWeights, type SoulTraits } from "./team-psyche.js";
import type {
	PersistedTeammate,
	TeamTask,
	TeamTaskStatus,
	TeammateIdentity,
	TeammateMessage,
	TeammateMode,
	TeammateRole,
	TeammateStatus,
	TeamSpawnSpec,
	TeamSendResult,
} from "./team-types.js";

/** Runtime teammate handle - combines persisted state with runtime resources */
export interface RuntimeTeammate {
	state: PersistedTeammate;
	abortController: AbortController;
	currentTurnAbortController?: AbortController;
	handle?: SubAgentHandle;
	worktree?: WorkspacePath;
}

/** Team runtime options */
export interface TeamRuntimeOptions {
	storageDir?: string;
}

export interface TeamSendOptions {
	onEvent?: (event: TeamRuntimeEvent) => void;
}

export type TeamRuntimeEvent =
	| { type: "teammate_live"; teammate: PersistedTeammate; event: SubAgentEvent }
	| { type: "teammate_status"; teammate: PersistedTeammate; event: string }
	| { type: "harness_event"; teammate: PersistedTeammate; event: string };

/**
 * TeamRuntime manages persistent teammates.
 * Teammates survive across main session restarts via TeamStateStore.
 */
export class TeamRuntime {
	private store: TeamStateStore;
	private worktreeManager: WorktreeManager;
	private subAgentRuntime: SubAgentRuntime;
	private permissions: PermissionStore;
	private mailbox: TeamMailbox;
	private tasks: TeamTaskStore;
	private transcripts: TeamTranscriptWriter;
	// TODO(B.next): split into `byId: Map<string, RuntimeTeammate>` + `nameToId: Map<string, string>`.
	// Currently keyed by both id and name for lookup convenience; getAllTeammates dedupes by id.
	private teammates: Map<string, RuntimeTeammate> = new Map();
	private sendQueues: Map<string, Promise<void>> = new Map();
	private loaded = false;
	private nameCounter = 0;
	private soulManager: unknown;

	constructor(options: TeamRuntimeOptions = {}) {
		this.store = new TeamStateStore(options.storageDir);
		this.worktreeManager = new WorktreeManager();
		this.subAgentRuntime = new SubAgentRuntime();
		this.permissions = new PermissionStore();
		this.mailbox = new TeamMailbox(1000, join(this.store.directory, "mailbox.jsonl"));
		this.tasks = new TeamTaskStore(this.store.directory);
		this.transcripts = new TeamTranscriptWriter(this.store.directory);
	}

	/** Permission store — used by index.ts for `/team:approve`. */
	getPermissionStore(): PermissionStore {
		return this.permissions;
	}

	/** Mailbox — used by index.ts for live observation. */
	getMailbox(): TeamMailbox {
		return this.mailbox;
	}

	/** Shared task list store. */
	getTaskStore(): TeamTaskStore {
		return this.tasks;
	}

	/** Soul manager from the session, used to tune psyche weights when available. */
	setSoulManager(soulManager: unknown | undefined): void {
		this.soulManager = soulManager;
	}

	/**
	 * Load persisted teammates from disk.
	 * Must be called before other operations.
	 */
	async load(): Promise<void> {
		if (this.loaded) return;

		const persisted = await this.store.loadAll();
		await this.mailbox.load();
		await this.tasks.load();
		for (const state of persisted) {
			if (state.status === "terminated") {
				await this.store.remove(state.identity.id);
				continue;
			}

			let worktree: WorkspacePath | undefined;
			if (state.worktreePath) {
				try {
					// Verify worktree still exists by checking if directory exists
					const { stat } = await import("node:fs/promises");
					await stat(state.worktreePath);
					worktree = {
						path: state.worktreePath,
						type: await this.detectWorkspaceType(state.worktreePath),
					};
				} catch {
					state.worktreePath = undefined;
					state.worktreeBranch = undefined;
				}
			}

			if (state.status === "running") {
				state.status = "idle";
			}
			this.bumpNameCounter(state.identity.name, state.identity.role);

			const teammate: RuntimeTeammate = {
				state,
				abortController: new AbortController(),
				worktree,
			};
			this.teammates.set(state.identity.id, teammate);
			this.teammates.set(state.identity.name, teammate);
		}

		this.loaded = true;
	}

	/**
	 * Spawn a new teammate.
	 *
	 * Note: teammates do not pin a model. Each /team:send turn uses whichever
	 * model is currently active in the main session, passed through send().
	 */
	async spawn(spec: TeamSpawnSpec): Promise<PersistedTeammate> {
		await this.ensureLoaded();

		let name = spec.name?.trim();
		if (!name) {
			name = this.generateName(spec.role);
		} else if (this.findByName(name)) {
			name = this.generateName(spec.role);
		}

		let worktree: WorkspacePath | undefined;
		if (spec.role === "implementer") {
			worktree = await this.worktreeManager.createGitWorktree(undefined, spec.baseCwd);
		}

		const identity: TeammateIdentity = {
			id: crypto.randomUUID(),
			name,
			role: spec.role,
			createdAt: Date.now(),
		};

		const mode: TeammateMode =
			spec.mode ?? (spec.harnessEnabled && spec.role === "implementer" ? "execute" : this.getDefaultModeForRole(spec.role));

		const state: PersistedTeammate = {
			identity,
			mode,
			status: "idle",
			cwd: worktree?.path ?? spec.baseCwd,
			worktreePath: worktree?.path,
			// TODO(B.next): plumb branch name through WorkspacePath or query via
			// `git -C <worktree> rev-parse --abbrev-ref HEAD` after creation.
			worktreeBranch: undefined,
			messages: [],
			lastActiveAt: Date.now(),
			psycheOverrides: spec.psycheOverrides,
		};
		if (spec.harnessEnabled) {
			state.harness = createInitialHarnessState();
		}
		if (spec.psycheOverrides || spec.role === "verifier") {
			state.psyche = computePsycheWeights("verify", spec.role, undefined, spec.psycheOverrides);
		}

		const teammate: RuntimeTeammate = {
			state,
			abortController: new AbortController(),
			worktree,
		};

		this.teammates.set(identity.id, teammate);
		this.teammates.set(identity.name, teammate);

		await this.store.save(state);

		return state;
	}

	/**
	 * Send a message to a teammate.
	 */
	async send(name: string, message: string, model?: Model<any>, options: TeamSendOptions = {}): Promise<TeamSendResult> {
		await this.ensureLoaded();

		const teammate = this.findByName(name);
		if (!teammate) {
			return {
				teammateId: "",
				teammateName: name,
				success: false,
				response: "",
				error: `Teammate "${name}" not found`,
				durationMs: 0,
			};
		}

		const previousTurn = this.sendQueues.get(teammate.state.identity.id);
		if (previousTurn) {
			options.onEvent?.({
				type: "teammate_status",
				teammate: teammate.state,
				event: `Queued message for ${teammate.state.identity.name}.`,
			});
			this.mailbox.post({
				teammateId: teammate.state.identity.id,
				teammateName: teammate.state.identity.name,
				type: "task_progress",
				direction: "leader_to_teammate",
				payload: { status: "queued", content: message },
			});
		}

		const run = (previousTurn ?? Promise.resolve()).catch(() => {}).then(async () => {
			const startTime = Date.now();
			const turnAbortController = new AbortController();
			teammate.currentTurnAbortController = turnAbortController;

		const leaderMessage: TeammateMessage = {
			id: crypto.randomUUID(),
			timestamp: startTime,
			direction: "leader",
			content: message,
		};
		teammate.state.messages.push(leaderMessage);

		teammate.state.status = "running";
		teammate.state.lastActiveAt = startTime;
		await this.store.save(teammate.state);
		options.onEvent?.({
			type: "teammate_status",
			teammate: teammate.state,
			event: `Started ${teammate.state.identity.name} (${teammate.state.identity.role}) in ${teammate.state.mode} mode.`,
		});

		this.mailbox.post({
			teammateId: teammate.state.identity.id,
			teammateName: teammate.state.identity.name,
			type: "task_request",
			direction: "leader_to_teammate",
			payload: { content: message },
		});
		await this.transcripts.append(teammate.state.identity.id, {
			timestamp: startTime,
			kind: "leader",
			content: message,
		});

		const prompt = await this.buildPrompt(teammate.state);
		const harnessContext = await this.prepareHarnessTurn(teammate, message);
		const fullPrompt = harnessContext
			? [prompt, harnessContext.psychePrompt, harnessContext.harnessInstructions].join("\n\n")
			: prompt;
		const tools = this.selectTools(teammate.state.mode, teammate.state.cwd);

		try {
			const spec: SubAgentSpec = {
				prompt: fullPrompt,
				tools,
				cwd: teammate.state.cwd,
				signal: turnAbortController.signal,
				model,
				contextFiles: harnessContext?.contextFiles,
				onEvent: (event) => {
					this.applyLiveEvent(teammate, event);
					options.onEvent?.({ type: "teammate_live", teammate: teammate.state, event });
				},
				exitHook: harnessContext
					? async (result) => {
							if (!teammate.state.harness) return;
							const exit = await inspectHarnessExit(teammate.state.harness, teammate.state.cwd, result);
							teammate.state.harness = exit.harness;
							options.onEvent?.({ type: "harness_event", teammate: teammate.state, event: exit.event });
							this.mailbox.post({
								teammateId: teammate.state.identity.id,
								teammateName: teammate.state.identity.name,
								type: "task_result",
								direction: "teammate_to_leader",
								payload: {
									success: exit.violations.length === 0,
									content: exit.event,
									error: exit.violations.length ? exit.violations.join("; ") : undefined,
								},
							});
						}
					: undefined,
			};

			const handle = await this.subAgentRuntime.spawn(spec);
			teammate.handle = handle;

			const result = await handle.result();
			const durationMs = Date.now() - startTime;

			const teammateResponse: TeammateMessage = {
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				direction: "teammate",
				content: result.success ? (result.response ?? "") : (result.error ?? "Error"),
				aborted: !result.success && result.error === "Aborted",
				error: result.success ? undefined : result.error,
			};
			teammate.state.messages.push(teammateResponse);
			teammate.state.status = result.success ? "idle" : teammateResponse.aborted ? "stopped" : "error";
			if (!result.success && result.error && !teammateResponse.aborted) {
				teammate.state.lastError = result.error;
			} else {
				teammate.state.lastError = undefined;
			}
			teammate.state.lastActiveAt = Date.now();
			teammate.state.live = undefined;
			await this.store.save(teammate.state);
			options.onEvent?.({
				type: "teammate_status",
				teammate: teammate.state,
				event: result.success
					? `Finished ${teammate.state.identity.name}.`
					: `Failed ${teammate.state.identity.name}: ${result.error ?? "Unknown error"}`,
			});

			this.mailbox.post({
				teammateId: teammate.state.identity.id,
				teammateName: teammate.state.identity.name,
				type: "task_result",
				direction: "teammate_to_leader",
				payload: {
					success: result.success,
					content: teammateResponse.content,
					error: result.error,
					aborted: teammateResponse.aborted,
				},
			});
			await this.transcripts.append(teammate.state.identity.id, {
				timestamp: Date.now(),
				kind: "teammate",
				content: teammateResponse.content,
				meta: { success: result.success, aborted: teammateResponse.aborted },
			});

			return {
				teammateId: teammate.state.identity.id,
				teammateName: name,
				success: result.success,
				response: teammateResponse.content,
				aborted: teammateResponse.aborted,
				error: result.error,
				durationMs,
			};
		} catch (error: unknown) {
			const durationMs = Date.now() - startTime;
			const errorMsg = error instanceof Error ? error.message : String(error);

			const errorMessage: TeammateMessage = {
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				direction: "teammate",
				content: `Error: ${errorMsg}`,
				error: errorMsg,
			};
			teammate.state.messages.push(errorMessage);
			teammate.state.status = errorMsg === "Aborted" ? "stopped" : "error";
			teammate.state.lastError = errorMsg === "Aborted" ? undefined : errorMsg;
			teammate.state.lastActiveAt = Date.now();
			teammate.state.live = undefined;
			await this.store.save(teammate.state);
			options.onEvent?.({
				type: "teammate_status",
				teammate: teammate.state,
				event: `Failed ${teammate.state.identity.name}: ${errorMsg}`,
			});

			this.mailbox.post({
				teammateId: teammate.state.identity.id,
				teammateName: teammate.state.identity.name,
				type: "task_result",
				direction: "teammate_to_leader",
				payload: {
					success: false,
					content: errorMessage.content,
					error: errorMsg,
					aborted: errorMsg === "Aborted",
				},
			});
			await this.transcripts.append(teammate.state.identity.id, {
				timestamp: Date.now(),
				kind: "teammate",
				content: errorMessage.content,
				meta: { success: false, aborted: errorMsg === "Aborted", error: errorMsg },
			});

			return {
				teammateId: teammate.state.identity.id,
				teammateName: name,
				success: false,
				response: "",
				error: errorMsg,
				durationMs,
			};
		} finally {
			teammate.currentTurnAbortController = undefined;
			teammate.handle = undefined;
		}
		});
		const cleanup = run.then(() => undefined, () => undefined).finally(() => {
			if (this.sendQueues.get(teammate.state.identity.id) === cleanup) {
				this.sendQueues.delete(teammate.state.identity.id);
			}
		});
		this.sendQueues.set(teammate.state.identity.id, cleanup);
		return run;
	}

	/**
	 * Stop the current turn of a teammate.
	 */
	async stop(name: string): Promise<boolean> {
		await this.ensureLoaded();

		const teammate = this.findByName(name);
		if (!teammate) return false;

		if (teammate.currentTurnAbortController) {
			teammate.currentTurnAbortController.abort();
		}
		if (teammate.handle) {
			await teammate.handle.abort();
		}

		teammate.state.status = "stopped";
		await this.store.save(teammate.state);
		return true;
	}

	/**
	 * Terminate a teammate completely.
	 */
	async terminate(name: string): Promise<boolean> {
		await this.ensureLoaded();

		const teammate = this.findByName(name);
		if (!teammate) return false;

		// Abort current turn
		if (teammate.currentTurnAbortController) {
			teammate.currentTurnAbortController.abort();
		}
		if (teammate.handle) {
			await teammate.handle.terminate();
		}

		// Dispose worktree
		if (teammate.worktree) {
			await this.worktreeManager.dispose(teammate.worktree);
		}

		// Cancel any pending permission requests for this teammate so the
		// awaiting promises resolve as denied rather than leaking.
		this.permissions.cancelForTeammate(teammate.state.identity.id);
		this.permissions.clearPaths(teammate.state.identity.id);
		this.mailbox.clearTeammate(teammate.state.identity.id);
		await this.transcripts.remove(teammate.state.identity.id);

		// Mark terminated and remove
		teammate.state.status = "terminated";
		await this.store.save(teammate.state);
		await this.store.remove(teammate.state.identity.id);

		this.teammates.delete(teammate.state.identity.id);
		this.teammates.delete(teammate.state.identity.name);

		return true;
	}

	/**
	 * Change teammate mode.
	 *
	 * Escalating an `implementer` to `execute` mode is a privileged action:
	 * it files a `permission_request` and resolves only after the leader
	 * approves via `/team:approve <id>`. All other transitions apply
	 * immediately. The returned object reports which path was taken so the
	 * UI can tell the user "pending approval" vs "applied".
	 */
	async setMode(
		name: string,
		mode: TeammateMode,
	): Promise<{ ok: boolean; pending?: { requestId: string }; error?: string }> {
		await this.ensureLoaded();

		const teammate = this.findByName(name);
		if (!teammate) return { ok: false, error: "not_found" };

		const needsApproval =
			mode === "execute" && teammate.state.identity.role === "implementer" && teammate.state.mode !== "execute";

		if (!needsApproval) {
			teammate.state.mode = mode;
			await this.store.save(teammate.state);
			this.mailbox.post({
				teammateId: teammate.state.identity.id,
				teammateName: teammate.state.identity.name,
				type: "mode_change",
				direction: "leader_to_teammate",
				payload: { mode },
			});
			return { ok: true };
		}

		const { id: requestId, decision } = this.permissions.request(
			teammate.state.identity.id,
			teammate.state.identity.name,
			"mode_change_to_execute",
			`Allow ${teammate.state.identity.name} to enter execute mode (sandboxed write in ${teammate.state.cwd})`,
		);
		this.mailbox.post({
			teammateId: teammate.state.identity.id,
			teammateName: teammate.state.identity.name,
			type: "permission_request",
			direction: "teammate_to_leader",
			payload: { requestId, action: "mode_change_to_execute" },
		});

		// Resolve mode change asynchronously when leader approves; do not
		// block the caller — they get the request id and can poll status.
		void decision.then(async (approved) => {
			if (approved) {
				teammate.state.mode = mode;
				await this.store.save(teammate.state);
			}
			this.mailbox.post({
				teammateId: teammate.state.identity.id,
				teammateName: teammate.state.identity.name,
				type: "permission_response",
				direction: "leader_to_teammate",
				payload: { requestId, approved },
			});
			if (approved) {
				this.mailbox.post({
					teammateId: teammate.state.identity.id,
					teammateName: teammate.state.identity.name,
					type: "mode_change",
					direction: "leader_to_teammate",
					payload: { mode },
				});
			}
		});

		return { ok: true, pending: { requestId } };
	}

	/**
	 * Approve a pending permission request. Returns true on success.
	 * Thin wrapper so callers don't need to reach into PermissionStore.
	 */
	approvePermission(requestId: string): boolean {
		return this.permissions.approve(requestId);
	}

	/** Deny a pending permission request. */
	denyPermission(requestId: string): boolean {
		return this.permissions.deny(requestId);
	}

	async addTask(title: string): Promise<TeamTask> {
		const task = await this.tasks.create({ title });
		this.mailbox.post({
			teammateId: "team",
			teammateName: "team",
			type: "task_update",
			direction: "leader_to_teammate",
			payload: { action: "add", task },
		});
		return task;
	}

	async claimTask(taskId: string, teammateName: string): Promise<TeamTask | undefined> {
		await this.ensureLoaded();
		const teammate = this.findByName(teammateName);
		if (!teammate) return undefined;
		const task = await this.tasks.claim(taskId, teammate.state.identity.id, teammate.state.identity.name);
		if (task) {
			this.mailbox.post({
				teammateId: teammate.state.identity.id,
				teammateName: teammate.state.identity.name,
				type: "task_claim",
				direction: "leader_to_teammate",
				payload: { task },
			});
		}
		return task;
	}

	async updateTaskStatus(taskId: string, status: TeamTaskStatus): Promise<TeamTask | undefined> {
		const task = await this.tasks.update(taskId, { status });
		if (task) {
			this.mailbox.post({
				teammateId: task.ownerId ?? "team",
				teammateName: task.ownerName ?? "team",
				type: "task_update",
				direction: "leader_to_teammate",
				payload: { action: status, task },
			});
		}
		return task;
	}

	async listTasks(): Promise<TeamTask[]> {
		return this.tasks.list();
	}

	async sendTeammateMail(fromName: string, toName: string, content: string): Promise<boolean> {
		await this.ensureLoaded();
		const from = this.findByName(fromName);
		const to = this.findByName(toName);
		if (!from || !to) return false;
		this.mailbox.post({
			teammateId: from.state.identity.id,
			teammateName: from.state.identity.name,
			targetTeammateId: to.state.identity.id,
			targetTeammateName: to.state.identity.name,
			type: "teammate_message",
			direction: "teammate_to_teammate",
			payload: { content },
		});
		await this.transcripts.append(from.state.identity.id, {
			timestamp: Date.now(),
			kind: "event",
			content: `To ${to.state.identity.name}: ${content}`,
		});
		await this.transcripts.append(to.state.identity.id, {
			timestamp: Date.now(),
			kind: "event",
			content: `From ${from.state.identity.name}: ${content}`,
		});
		return true;
	}

	async allowPath(teammateName: string, path: string): Promise<string | undefined> {
		await this.ensureLoaded();
		const teammate = this.findByName(teammateName);
		if (!teammate) return undefined;
		const absolute = normalizePath(isAbsolute(path) ? path : resolve(teammate.state.cwd, path));
		this.permissions.allowPath(teammate.state.identity.id, absolute);
		this.mailbox.post({
			teammateId: teammate.state.identity.id,
			teammateName: teammate.state.identity.name,
			type: "permission_response",
			direction: "leader_to_teammate",
			payload: { action: "write_path", path: absolute, approved: true },
		});
		return absolute;
	}

	/**
	 * Get all teammates.
	 */
	getAllTeammates(): PersistedTeammate[] {
		const seen = new Set<string>();
		const result: PersistedTeammate[] = [];

		for (const teammate of this.teammates.values()) {
			if (!seen.has(teammate.state.identity.id)) {
				seen.add(teammate.state.identity.id);
				result.push(teammate.state);
			}
		}

		return result.sort((a, b) => a.identity.createdAt - b.identity.createdAt);
	}

	/**
	 * Get a teammate by name.
	 */
	getTeammate(name: string): PersistedTeammate | undefined {
		return this.findByName(name)?.state;
	}

	/**
	 * Dispose all teammates and cleanup.
	 */
	async dispose(): Promise<void> {
		for (const teammate of this.teammates.values()) {
			if (teammate.currentTurnAbortController) {
				teammate.currentTurnAbortController.abort();
			}
			if (teammate.handle) {
				await teammate.handle.terminate().catch(() => {});
			}
		}
		await this.subAgentRuntime.terminateAll();
	}

	private async ensureLoaded(): Promise<void> {
		if (!this.loaded) {
			await this.load();
		}
	}

	private findByName(name: string): RuntimeTeammate | undefined {
		return this.teammates.get(name);
	}

	private generateName(role: TeammateRole): string {
		let candidate: string;
		do {
			this.nameCounter++;
			candidate = `${role}-${this.nameCounter}`;
		} while (this.findByName(candidate));
		return candidate;
	}

	private bumpNameCounter(name: string, role: TeammateRole): void {
		const match = new RegExp(`^${role}-(\\d+)$`).exec(name);
		if (!match) return;

		const nextCounter = Number.parseInt(match[1] ?? "", 10);
		if (Number.isFinite(nextCounter)) {
			this.nameCounter = Math.max(this.nameCounter, nextCounter);
		}
	}

	private async detectWorkspaceType(workspacePath: string): Promise<WorkspacePath["type"]> {
		try {
			const { stat } = await import("node:fs/promises");
			await stat(join(workspacePath, ".git"));
			return "worktree";
		} catch {
			return "temp";
		}
	}

	private getDefaultModeForRole(role: TeammateRole): TeammateMode {
		switch (role) {
			case "researcher":
				return "research";
			case "reviewer":
				return "review";
			case "verifier":
				return "review";
			case "implementer":
				return "plan";
			case "planner":
				return "plan";
			case "generic":
			default:
				return "research";
		}
	}

	private async buildPrompt(state: PersistedTeammate): Promise<string> {
		const lines: string[] = [
			"You are a persistent teammate in an AgentTeam.",
			"",
			"Identity:",
			`  Name: ${state.identity.name}`,
			`  Role: ${state.identity.role}`,
			`  Mode: ${state.mode}`,
			`  Working directory: ${state.cwd}`,
			"",
			"Mode rules:",
			`  - research: read-only exploration and reporting`,
			`  - plan: read-only; produce a plan and wait for leader approval before executing`,
			`  - execute: sandboxed write inside your working directory`,
			`  - review: read-only review and feedback`,
			"",
			"Conversation history with the leader:",
		];

		if (state.messages.length === 0) {
			lines.push("  (none yet)");
		} else {
			for (const msg of state.messages) {
				const prefix = msg.direction === "leader" ? "Leader" : "You";
				lines.push(`${prefix}: ${msg.content}`);
			}
		}

		const tasks = await this.tasks.list();
		const ownedTasks = tasks.filter((task) => task.ownerId === state.identity.id);
		const blockedTasks = tasks.filter((task) => task.status === "blocked");
		const openTasks = tasks.filter((task) => task.status === "open").slice(0, 8);
		lines.push("", "Shared team tasks:");
		if (ownedTasks.length === 0 && blockedTasks.length === 0 && openTasks.length === 0) {
			lines.push("  (none)");
		} else {
			if (ownedTasks.length > 0) {
				lines.push("  Claimed by you:");
				for (const task of ownedTasks) {
					lines.push(`    ${formatTaskForPrompt(task)}`);
				}
			}
			if (blockedTasks.length > 0) {
				lines.push("  Blocked:");
				for (const task of blockedTasks.slice(0, 6)) {
					lines.push(`    ${formatTaskForPrompt(task)}`);
				}
			}
			if (openTasks.length > 0) {
				lines.push("  Open:");
				for (const task of openTasks) {
					lines.push(`    ${formatTaskForPrompt(task)}`);
				}
			}
		}

		const mailboxMessages = this.mailbox.list(state.identity.id).slice(-12);
		lines.push("", "Recent team mailbox:");
		if (mailboxMessages.length === 0) {
			lines.push("  (none)");
		} else {
			for (const message of mailboxMessages) {
				const from = message.teammateName;
				const to = message.targetTeammateName ? ` -> ${message.targetTeammateName}` : "";
				const content =
					typeof message.payload.content === "string"
						? message.payload.content
						: typeof message.payload.action === "string"
							? `${message.payload.action}`
							: JSON.stringify(message.payload);
				lines.push(`  [${message.type}] ${from}${to}: ${content}`);
			}
		}

		lines.push("", "Respond to the leader's last message in your current mode.");
		return lines.join("\n");
	}

	private async prepareHarnessTurn(
		teammate: RuntimeTeammate,
		taskDescription: string,
	): Promise<
		| {
				psychePrompt: string;
				harnessInstructions: string;
				contextFiles: string[];
		  }
		| undefined
	> {
		const harness = teammate.state.harness;
		if (!harness?.enabled) return undefined;

		await ensureHarnessFiles(harness, teammate.state.cwd, taskDescription);
		teammate.state.harness = await beginHarnessTurn(harness, teammate.state.cwd);
		const soulTraits = await this.getSoulTraits();
		const weights = computePsycheWeights(
			teammate.state.harness.phase,
			teammate.state.identity.role,
			soulTraits,
			teammate.state.psycheOverrides,
		);
		teammate.state.psyche = weights;
		const psychePrompt = buildPsychePrompt(weights, teammate.state.harness.phase, teammate.state);
		const harnessInstructions = await buildHarnessInstructions(teammate.state.harness, teammate.state.cwd, taskDescription);
		return {
			psychePrompt,
			harnessInstructions,
			contextFiles: prepareContextFiles(teammate.state.harness),
		};
	}

	private async getSoulTraits(): Promise<SoulTraits | undefined> {
		const manager = this.soulManager as
			| {
					getProfile?: () => unknown | Promise<unknown>;
			  }
			| undefined;
		if (!manager?.getProfile) return undefined;

		try {
			const profile = (await manager.getProfile()) as { personality?: SoulTraits } | undefined;
			return profile?.personality;
		} catch {
			return undefined;
		}
	}

	private applyLiveEvent(teammate: RuntimeTeammate, event: SubAgentEvent): void {
		const previous = teammate.state.live;
		switch (event.type) {
			case "agent_start":
				teammate.state.live = {
					phase: "starting",
					preview: "Sub-agent starting...",
					toolName: null,
					updatedAt: event.timestamp,
				};
				break;
			case "message_update":
				teammate.state.live = {
					phase: event.text ? "thinking" : (previous?.phase ?? "thinking"),
					preview: tailText(event.text || previous?.preview || "", 1200),
					toolName: previous?.toolName ?? null,
					updatedAt: event.timestamp,
				};
				break;
			case "message_end":
				teammate.state.live = {
					phase: "finishing",
					preview: tailText(event.text || previous?.preview || "", 1200),
					toolName: previous?.toolName ?? null,
					updatedAt: event.timestamp,
				};
				break;
			case "tool_start":
			case "tool_update":
			case "tool_end":
				teammate.state.live = {
					phase: "tool",
					preview:
						event.type === "tool_update"
							? tailText(String(event.partialResult ?? previous?.preview ?? ""), 1200)
							: previous?.preview ?? "",
					toolName: event.toolName,
					updatedAt: event.timestamp,
				};
				break;
			case "agent_end":
				teammate.state.live = {
					phase: event.success ? "done" : "error",
					preview: event.error ?? previous?.preview ?? "",
					toolName: null,
					updatedAt: event.timestamp,
				};
				break;
		}
	}

	private selectTools(mode: TeammateMode, cwd: string): Tool[] {
		switch (mode) {
			case "research":
			case "review":
			case "plan":
				return this.createReadOnlyTools(cwd);
			case "execute":
				return this.createSandboxedTools(cwd);
			default:
				return this.createReadOnlyTools(cwd);
		}
	}

	private createReadOnlyTools(cwd: string): Tool[] {
		const baseTools = createReadOnlyTools(cwd);
		const sandboxBash = createBashTool(cwd, {
			spawnHook: createSandboxHook(),
		});
		return [...baseTools.filter((t) => t.name !== "bash"), sandboxBash];
	}

	private createSandboxedTools(cwd: string): Tool[] {
		const guard = this.createWritePathGuard(cwd);
		const baseTools = createCodingTools(cwd, {
			edit: { beforeWrite: guard },
			write: { beforeWrite: guard },
		});
		const sandboxBash = createBashTool(cwd, {
			spawnHook: createSandboxHook({
				allowWritePath: (path) => {
					try {
						guard(path);
						return true;
					} catch {
						return false;
					}
				},
				blockedMessage: `Write operations outside the teammate workspace are not allowed. Use /team:allow-path to grant a path prefix.`,
			}),
		});
		return [...baseTools.filter((t) => t.name !== "bash"), sandboxBash];
	}

	private createWritePathGuard(cwd: string): (absolutePath: string) => void {
		const workspaceRoot = normalizePath(cwd);
		return (absolutePath: string) => {
			const target = normalizePath(absolutePath);
			const teammate = this.getAllTeammates().find((candidate) => normalizePath(candidate.cwd) === workspaceRoot);
			if (isWithinPath(target, workspaceRoot)) return;
			if (teammate && this.permissions.isPathAllowed(teammate.identity.id, target)) return;
			throw new Error(
				`Write denied for ${target}. Team execute mode may only write inside ${workspaceRoot} unless the leader grants a path allowlist.`,
			);
		};
	}
}

function normalizePath(path: string): string {
	return resolve(isAbsolute(path) ? path : path);
}

function isWithinPath(target: string, root: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function formatTaskForPrompt(task: TeamTask): string {
	const owner = task.ownerName ? ` owner:${task.ownerName}` : "";
	const deps = task.dependsOn.length ? ` deps:${task.dependsOn.join(",")}` : "";
	const artifacts = task.artifactPaths.length ? ` artifacts:${task.artifactPaths.join(",")}` : "";
	const detail = task.description ? ` - ${task.description}` : "";
	return `${task.id} [${task.status}]${owner}${deps}${artifacts} ${task.title}${detail}`;
}

function tailText(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return value.slice(value.length - maxLength);
}
