/**
 * [WHO]: SubAgent types - SubAgentSpec, SubAgentHandle, SubAgentBackend, SubAgentResult
 * [FROM]: Depends on @pencil-agent/agent-core, @pencil-agent/ai, core/tools
 * [TO]: Consumed by ./sub-agent-runtime, ./sub-agent-backend, ./index.ts, extensions/defaults/subagent/*, extensions/defaults/team/*
 * [HERE]: core/sub-agent/sub-agent-types.ts - SubAgent type definitions
 * [COVENANT]: Change these types → update P1 architecture diagram
 */

import type { AgentMessage } from "@pencil-agent/agent-core";
import type { ImageContent, Model } from "@pencil-agent/ai";
import type { Tool } from "../tools/index.js";

/**
 * Specification for spawning a SubAgent.
 */
export interface SubAgentSpec {
  /** Task prompt for the SubAgent */
  prompt: string;
  /** Tools available to the SubAgent (determined by caller, not guessed by core) */
  tools: Tool[];
  /** Working directory for the SubAgent (can be a worktree) */
  cwd: string;
  /** Abort signal for stopping the SubAgent (required) */
  signal: AbortSignal;
  /** Optional timeout in milliseconds */
  timeoutMs?: number;
  /** Images to include in the prompt */
  images?: ImageContent[];
  /** Model to use (reuses main session's model and auth) */
  model?: Model<any>;
  /** Files to inject into the initial prompt as read-only context */
  contextFiles?: string[];
  /** Optional callback invoked after the run result is available */
  exitHook?: (result: SubAgentResult) => Promise<void> | void;
}

/**
 * Result from a completed SubAgent run.
 */
export interface SubAgentResult {
  /** Whether the run was successful */
  success: boolean;
  /** The response text from the SubAgent */
  response?: string;
  /** Error message if unsuccessful */
  error?: string;
}

/**
 * Handle to a running SubAgent.
 */
export interface SubAgentHandle {
  /** Unique identifier for this SubAgent */
  readonly id: string;
  /** Current status of the SubAgent */
  readonly status: "running" | "done" | "aborted" | "error";
  /**
   * Wait for the SubAgent to complete and get its result.
   * Resolves when the SubAgent finishes (successfully or with error).
   */
  result(): Promise<SubAgentResult>;
  /**
   * Abort the current turn (stops after current LLM response).
   * The SubAgent may still be in "running" state if it can accept more turns.
   */
  abort(): Promise<void>;
  /**
   * Terminate the SubAgent completely.
   * This stops all work and disposes of resources.
   */
  terminate(): Promise<void>;
}

/**
 * Backend for spawning SubAgents.
 * Core provides in-process backend; subprocess backend can be added in phase B.
 */
export interface SubAgentBackend {
  /**
   * Spawn a new SubAgent with the given specification.
   * @param spec The SubAgent specification
   * @returns A handle to the spawned SubAgent
   */
  spawn(spec: SubAgentSpec): Promise<SubAgentHandle>;
}
