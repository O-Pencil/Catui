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
import type { SubAgentHandle, SubAgentSpec } from "../../../core/sub-agent/index.js";
import { WorktreeManager } from "../../../core/workspace/index.js";
import type { WorkspacePath } from "../../../core/workspace/index.js";
import { join } from "node:path";
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
	private transcripts: TeamTranscriptWriter;
	// TODO(B.next): split into `byId: Map<string, RuntimeTeammate>` + `nameToId: Map<string, string>`.
	// Currently keyed by both id and name for lookup convenience; getAllTeammates dedupes by id.
	private teammates: Map<string, RuntimeTeammate> = new Map();
	private loaded = false;
	private nameCounter = 0;
	private soulManager: unknown;

	constructor(options: TeamRuntimeOptions = {}) {
		this.store = new TeamStateStore(options.storageDir);
		this.worktreeManager = new WorktreeManager();
		this.subAgentRuntime = new SubAgentRuntime();
		this.permissions = new PermissionStore();
		this.mailbox = new TeamMailbox();
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
	async send(name: string, message: string, model?: Model<any>): Promise<TeamSendResult> {
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

		if (teammate.state.status === "running") {
			// v1 has no mailbox queue. Reject concurrent sends so the conversation
			// stays consistent. A real queue is planned for B.3 (mailbox protocol).
			return {
				teammateId: teammate.state.identity.id,
				teammateName: name,
				success: false,
				response: "",
				error: `Teammate "${name}" is currently processing another message. Use /team:stop to interrupt, or wait.`,
				durationMs: 0,
			};
		}

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

		const harnessContext = await this.prepareHarnessTurn(teammate, message);
		const prompt = harnessContext
			? [this.buildPrompt(teammate.state), harnessContext.psychePrompt, harnessContext.harnessInstructions].join("\n\n")
			: this.buildPrompt(teammate.state);
		const tools = this.selectTools(teammate.state.mode, teammate.state.cwd);

		try {
			const spec: SubAgentSpec = {
				prompt,
				tools,
				cwd: teammate.state.cwd,
				signal: turnAbortController.signal,
				model,
				contextFiles: harnessContext?.contextFiles,
				exitHook: harnessContext
					? async (result) => {
							if (!teammate.state.harness) return;
							const exit = await inspectHarnessExit(teammate.state.harness, teammate.state.cwd, result);
							teammate.state.harness = exit.harness;
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
			await this.store.save(teammate.state);

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
			await this.store.save(teammate.state);

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

	private buildPrompt(state: PersistedTeammate): string {
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
		const baseTools = createCodingTools(cwd);
		const sandboxBash = createBashTool(cwd, {
			spawnHook: createSandboxHook(),
		});
		return [...baseTools.filter((t) => t.name !== "bash"), sandboxBash];
	}
}
