/**
 * [WHO]: Arena mode types - contestant, result, and report definitions
 * [FROM]: Depends on core/sub-agent types
 * [TO]: Consumed by arena-runner and index
 * [HERE]: extensions/builtin/arena/arena-types.ts - Arena mode type definitions
 */

import type { SubAgentHandle, SubAgentResult } from "../../../core/sub-agent/index.js";
import type { WorkspacePath } from "../../../core/workspace/index.js";

export interface ArenaContestant {
	id: string;
	strategy: string;
	status: "running" | "completed" | "failed" | "aborted";
	handle?: SubAgentHandle;
	result?: SubAgentResult;
	worktree?: WorkspacePath;
	startTime: number;
	endTime?: number;
	error?: string;
}

export interface ArenaReport {
	arenaId: string;
	problem: string;
	contestants: ArenaContestant[];
	startTime: number;
	endTime?: number;
	winnerId?: string;
}

export interface ArenaRunOptions {
	problem: string;
	strategies: string[];
	cwd: string;
	timeoutMs?: number;
	model?: unknown;
}
