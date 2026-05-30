/**
 * [WHO]: TeamRuntime - teammate registry, lifecycle, persistence, task/mailbox, permission, transcript, and send queue management
 * [FROM]: Depends on ./team-types, stores, permissions, mailbox, transcript, team-runtime-helpers.ts, core/sub-agent/*, core/workspace/*
 * [TO]: Consumed by index.ts
 * [HERE]: extensions/builtin/team/team-runtime.ts
 */

import { SubAgentRuntime } from "../../../core/sub-agent/index.js";
import type { SubAgentEvent, SubAgentHandle, SubAgentSpec } from "../../../core/sub-agent/index.js";
import { WorktreeManager } from "../../../core/workspace/index.js";
import type { WorkspacePath } from "../../../core/workspace/index.js";
import { isAbsolute, join, resolve } from "node:path";
import type { Tool } from "../../../core/tools/index.js";
import type { Model } from "@pencil-agent/ai";
import { TeamStateStore } from "./team-state-store.js";
import { PermissionStore } from "./team-permissions.js";
import { TeamMailbox } from "./team-mailbox.js";
import { TeamTaskStore } from "./team-task-store.js";
import { TeamTranscriptWriter } from "./team-transcript.js";
import { createInitialHarnessState, inspectHarnessExit } from "./team-harness.js";
import { computePsycheWeights } from "./team-psyche.js";
import {
	applyLiveEvent,
	buildTeammatePrompt,
	createWritePathGuard as createTeamWritePathGuard,
	ensureLiveView,
	getDefaultModeForRole,
	indexFromLabel,
	isBuilderRole,
	labelFromIndex,
	normalizePath,
	prepareHarnessTurn,
	selectToolsForMode,
	singleLine,
	summarizeTask,
	tailText,
} from "./team-runtime-helpers.js";
import type {
	PersistedTeammate,
	TeamTask,
	TeamTaskStatus,
	TeammateIdentity,
	TeammateMessage,
	TeammateMode,
	TeammateRole,
	TeamSpawnSpec,
	TeamSendResult,
} from "./team-types.js";

export interface RuntimeTeammate {
	state: PersistedTeammate;
	abortController: AbortController;
	currentTurnAbortController?: AbortController;
	handle?: SubAgentHandle;
	worktree?: WorkspacePath;
}

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
	private labelCounter = 0;
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

	getPermissionStore(): PermissionStore {
		return this.permissions;
	}

	getMailbox(): TeamMailbox {
		return this.mailbox;
	}

	getTaskStore(): TeamTaskStore {
		return this.tasks;
	}

	setSoulManager(soulManager: unknown | undefined): void {
		this.soulManager = soulManager;
	}

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
			if (!state.identity.label) {
				state.identity.label = this.generateLabel();
				await this.store.save(state);
			}
			this.bumpNameCounter(state.identity.name, state.identity.role);
			this.bumpLabelCounter(state.identity.label);
			state.liveView = ensureLiveView(state.liveView, state.identity);

			const teammate: RuntimeTeammate = {
				state,
				abortController: new AbortController(),
				worktree,
			};
			this.teammates.set(state.identity.id, teammate);
			this.teammates.set(state.identity.name, teammate);
			this.teammates.set(state.identity.label, teammate);
		}

		this.loaded = true;
	}

	async spawn(spec: TeamSpawnSpec): Promise<PersistedTeammate> {
		await this.ensureLoaded();

		let name = spec.name?.trim();
		if (!name) {
			name = this.generateName(spec.role);
		} else if (this.findByName(name)) {
			name = this.generateName(spec.role);
		}

		let worktree: WorkspacePath | undefined;
		if (isBuilderRole(spec.role)) {
			worktree = await this.worktreeManager.createGitWorktree(undefined, spec.baseCwd);
		}

		const identity: TeammateIdentity = {
			id: crypto.randomUUID(),
			label: this.generateLabel(),
			name,
			role: spec.role,
			createdAt: Date.now(),
		};

		const mode: TeammateMode =
			spec.mode ?? (spec.harnessEnabled && isBuilderRole(spec.role) ? "execute" : getDefaultModeForRole(spec.role));

		const state: PersistedTeammate = {
			identity,
			mode,
			status: "idle",
			cwd: worktree?.path ?? spec.baseCwd,
			worktreePath: worktree?.path,
			worktreeBranch: undefined,
			messages: [],
			lastActiveAt: Date.now(),
			psycheOverrides: spec.psycheOverrides,
			liveView: ensureLiveView(undefined, identity),
		};
		if (spec.harnessEnabled) {
			state.harness = createInitialHarnessState();
		}
		if (spec.psycheOverrides || spec.role === "verifier" || spec.role === "data-analyst") {
			state.psyche = computePsycheWeights("verify", spec.role, undefined, spec.psycheOverrides);
		}

		const teammate: RuntimeTeammate = {
			state,
			abortController: new AbortController(),
			worktree,
		};

		this.teammates.set(identity.id, teammate);
		this.teammates.set(identity.name, teammate);
		this.teammates.set(identity.label, teammate);

		await this.store.save(state);

		return state;
	}

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
			teammate.state.liveView = {
				...ensureLiveView(teammate.state.liveView, teammate.state.identity),
				currentTask: summarizeTask(message),
				progress: "assigned",
			};

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

			const prompt = buildTeammatePrompt({
				state: teammate.state,
				teammates: this.getAllTeammates(),
				tasks: await this.tasks.list(),
				mailboxMessages: this.mailbox.list(teammate.state.identity.id).slice(-12),
			});
			const harnessContext = await prepareHarnessTurn({
				teammate,
				taskDescription: message,
				soulManager: this.soulManager,
			});
			const fullPrompt = harnessContext
				? [prompt, harnessContext.psychePrompt, harnessContext.harnessInstructions].join("\n\n")
				: prompt;
			const tools = selectToolsForMode({
				mode: teammate.state.mode,
				cwd: teammate.state.cwd,
				getAllTeammates: () => this.getAllTeammates(),
				isPathAllowed: (teammateId, absolutePath) => this.permissions.isPathAllowed(teammateId, absolutePath),
			});

			try {
			const spec: SubAgentSpec = {
				prompt: fullPrompt,
				tools,
				cwd: teammate.state.cwd,
				signal: turnAbortController.signal,
				model,
				contextFiles: harnessContext?.contextFiles,
				onEvent: (event) => {
					applyLiveEvent(teammate, event);
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
			teammate.state.liveView = {
				...ensureLiveView(teammate.state.liveView, teammate.state.identity),
				lastUtterance: tailText(singleLine(teammateResponse.content), 200),
				progress: result.success ? "done" : teammateResponse.aborted ? "stopped" : "error",
			};
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
			teammate.state.liveView = {
				...ensureLiveView(teammate.state.liveView, teammate.state.identity),
				lastUtterance: tailText(singleLine(errorMessage.content), 200),
				progress: errorMsg === "Aborted" ? "stopped" : "error",
			};
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

	async terminate(name: string): Promise<boolean> {
		await this.ensureLoaded();

		const teammate = this.findByName(name);
		if (!teammate) return false;

		if (teammate.currentTurnAbortController) {
			teammate.currentTurnAbortController.abort();
		}
		if (teammate.handle) {
			await teammate.handle.terminate();
		}

		if (teammate.worktree) {
			await this.worktreeManager.dispose(teammate.worktree);
		}

		this.permissions.cancelForTeammate(teammate.state.identity.id);
		this.permissions.clearPaths(teammate.state.identity.id);
		this.mailbox.clearTeammate(teammate.state.identity.id);
		await this.transcripts.remove(teammate.state.identity.id);

		teammate.state.status = "terminated";
		await this.store.save(teammate.state);
		await this.store.remove(teammate.state.identity.id);

		this.teammates.delete(teammate.state.identity.id);
		this.teammates.delete(teammate.state.identity.name);
		this.teammates.delete(teammate.state.identity.label);

		return true;
	}

	async setMode(
		name: string,
		mode: TeammateMode,
	): Promise<{ ok: boolean; pending?: { requestId: string }; error?: string }> {
		await this.ensureLoaded();

		const teammate = this.findByName(name);
		if (!teammate) return { ok: false, error: "not_found" };

		const needsApproval =
			mode === "execute" && isBuilderRole(teammate.state.identity.role) && teammate.state.mode !== "execute";

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

	approvePermission(requestId: string): boolean {
		return this.permissions.approve(requestId);
	}

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

	getTeammate(name: string): PersistedTeammate | undefined {
		return this.findByName(name)?.state;
	}

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

	private generateLabel(): string {
		let candidate = "";
		do {
			this.labelCounter++;
			candidate = labelFromIndex(this.labelCounter);
		} while (this.teammates.has(candidate));
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

	private bumpLabelCounter(label: string): void {
		const index = indexFromLabel(label);
		if (index > 0) {
			this.labelCounter = Math.max(this.labelCounter, index);
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

	private selectTools(mode: TeammateMode, cwd: string): Tool[] {
		return selectToolsForMode({
			mode,
			cwd,
			getAllTeammates: () => this.getAllTeammates(),
			isPathAllowed: (teammateId, absolutePath) => this.permissions.isPathAllowed(teammateId, absolutePath),
		});
	}

	private createWritePathGuard(cwd: string): (absolutePath: string) => void {
		return createTeamWritePathGuard({
			cwd,
			getAllTeammates: () => this.getAllTeammates(),
			isPathAllowed: (teammateId, absolutePath) => this.permissions.isPathAllowed(teammateId, absolutePath),
		});
	}
}
