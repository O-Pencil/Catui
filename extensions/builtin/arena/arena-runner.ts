/**
 * [WHO]: ArenaRunner - spawns parallel subagents racing the same problem
 * [FROM]: Depends on core/sub-agent, core/workspace, core/tools
 * [TO]: Consumed by arena extension index.ts
 * [HERE]: extensions/builtin/arena/arena-runner.ts - Arena orchestration logic
 */

import type { Model } from "@catui/ai/types";
import { SubAgentRuntime, InProcessSubAgentBackend } from "../../../core/sub-agent/index.js";
import { createAgentSession } from "../../../core/runtime/sdk.js";
import type { WorkspacePath } from "../../../core/workspace/index.js";
import { WorktreeManager } from "../../../core/workspace/index.js";
import { createCodingTools, type Tool } from "../../../core/tools/index.js";
import type { ArenaContestant, ArenaReport, ArenaRunOptions } from "./arena-types.js";

const MAX_CONTESTANTS = 4;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class ArenaRunner {
	private runtime: SubAgentRuntime;
	private worktreeManager: WorktreeManager;
	private currentReport: ArenaReport | null = null;
	private abortController: AbortController | null = null;

	constructor() {
		this.runtime = new SubAgentRuntime(new InProcessSubAgentBackend(createAgentSession));
		this.worktreeManager = new WorktreeManager();
	}

	isRunning(): boolean {
		return this.currentReport !== null && this.currentReport.endTime === undefined;
	}

	getReport(): ArenaReport | null {
		return this.currentReport;
	}

	async abort(): Promise<void> {
		if (this.abortController) {
			this.abortController.abort();
		}
		if (this.currentReport) {
			for (const contestant of this.currentReport.contestants) {
				if (contestant.status === "running" && contestant.handle) {
					await contestant.handle.abort().catch(() => {});
					contestant.status = "aborted";
				}
			}
			this.currentReport.endTime = Date.now();
		}
	}

	async run(options: ArenaRunOptions): Promise<ArenaReport> {
		if (this.isRunning()) {
			throw new Error("An Arena run is already in progress. Stop it before starting a new one.");
		}

		const strategies = options.strategies.slice(0, MAX_CONTESTANTS);
		if (strategies.length === 0) {
			throw new Error("Arena requires at least one strategy.");
		}

		const arenaId = crypto.randomUUID().slice(0, 8);
		this.abortController = new AbortController();

		const contestants: ArenaContestant[] = strategies.map((strategy, index) => ({
			id: `contestant-${index + 1}`,
			strategy,
			status: "running",
			startTime: Date.now(),
		}));

		this.currentReport = {
			arenaId,
			problem: options.problem,
			contestants,
			startTime: Date.now(),
		};

		try {
			const worktrees = await Promise.all(
				strategies.map(() => this.worktreeManager.createGitWorktree(undefined, options.cwd)),
			);

			const tools = strategies.map((_, index) => createCodingTools(worktrees[index]!.path));

			const spawnPromises = contestants.map(async (contestant, index) => {
				contestant.worktree = worktrees[index]!;
				const prompt = this.buildContestantPrompt(options.problem, contestant.strategy, index + 1, strategies.length);

				try {
					const handle = await this.runtime.spawn({
						prompt,
						tools: tools[index]!,
						cwd: worktrees[index]!.path,
						signal: this.abortController!.signal,
						model: options.model as Model<any> | undefined,
						timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
					});
					contestant.handle = handle;

					const result = await handle.result();
					contestant.result = result;
					contestant.status = result.success ? "completed" : "failed";
					contestant.endTime = Date.now();
					if (!result.success) {
						contestant.error = result.error;
					}
				} catch (error) {
					contestant.status = "failed";
					contestant.error = error instanceof Error ? error.message : String(error);
					contestant.endTime = Date.now();
				}
			});

			await Promise.allSettled(spawnPromises);
		} finally {
			this.currentReport.endTime = Date.now();
			this.selectWinner();
		}

		return this.currentReport;
	}

	private buildContestantPrompt(problem: string, strategy: string, index: number, total: number): string {
		return `You are contestant ${index} of ${total} in an Arena challenge.

## Problem to solve:
${problem}

## Your assigned strategy/approach:
${strategy}

## Instructions:
- Solve the problem using ONLY the strategy described above
- Work in your isolated workspace (you have your own git worktree)
- Be thorough but efficient
- When done, summarize what you accomplished and any trade-offs

Begin working on the problem now.`;
	}

	private selectWinner(): void {
		if (!this.currentReport) return;

		const completed = this.currentReport.contestants.filter((c) => c.status === "completed");
		if (completed.length === 0) return;

		completed.sort((a, b) => {
			const aDuration = (a.endTime ?? Date.now()) - a.startTime;
			const bDuration = (b.endTime ?? Date.now()) - b.startTime;
			return aDuration - bDuration;
		});

		this.currentReport.winnerId = completed[0]?.id;
	}

	async cleanupWorktrees(): Promise<void> {
		if (!this.currentReport) return;

		for (const contestant of this.currentReport.contestants) {
			if (contestant.worktree) {
				try {
					await this.worktreeManager.dispose(contestant.worktree);
				} catch {
					// Ignore cleanup errors
				}
			}
		}
	}
}
