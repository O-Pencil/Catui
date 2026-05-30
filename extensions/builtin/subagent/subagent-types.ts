/**
 * [WHO]: SubAgent types - SubAgentPhase, SubAgentWorkerStatus, SubAgentRunState, SubAgentRunReport
 * [FROM]: Depends on core/sub-agent for SubAgentHandle
 * [TO]: Consumed by ./index.ts, ./subagent-runner.ts, ./subagent-parser.ts
 * [HERE]: extensions/builtin/subagent/subagent-types.ts - type definitions for SubAgent extension
 */

import type { SubAgentHandle } from "../../../core/sub-agent/index.js";

/**
 * SubAgent run phases.
 */
export type SubAgentPhase = "idle" | "planning" | "research" | "implementing" | "reviewing" | "done" | "error";

/**
 * SubAgent worker status.
 */
export type SubAgentWorkerStatus = "pending" | "running" | "done" | "error" | "aborted";

/**
 * SubAgent worker info.
 */
export interface SubAgentWorkerInfo {
  id: string;
  role: string;
  status: SubAgentWorkerStatus;
  handle?: SubAgentHandle;
}

/**
 * SubAgent run state.
 */
export interface SubAgentRunState {
  /** Unique run ID */
  runId: string;
  /** Current phase */
  phase: SubAgentPhase;
  /** Start time */
  startTime: number;
  /** Workers and their statuses */
  workers: SubAgentWorkerInfo[];
  /** Final report if completed */
  report?: SubAgentRunReport;
  /** Error message if failed */
  error?: string;
}

/**
 * SubAgent run report.
 */
export interface SubAgentRunReport {
  runId: string;
  summary: string;
  findings: string[];
  changedFiles: string[];
  duration: number;
  success: boolean;
  reportPath?: string;
  workspacePath?: string;
  patchPath?: string;
  patchPreview?: string;
  appliedAt?: number;
}
