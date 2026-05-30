/**
 * [WHO]: SubAgentRuntime class - spawn, abort, lifecycle management for SubAgents
 * [FROM]: Depends on ./sub-agent-types, ./sub-agent-backend
 * [TO]: Consumed by ./index.ts, extensions/builtin/subagent/*
 * [HERE]: core/sub-agent/sub-agent-runtime.ts - SubAgent runtime implementation
 */

import { InProcessSubAgentBackend } from "./sub-agent-backend.js";
import type { SubAgentBackend, SubAgentHandle, SubAgentSpec } from "./sub-agent-types.js";

/**
 * Runtime for managing SubAgents.
 * Provides spawn/abort/lifecycle operations.
 */
export class SubAgentRuntime {
  private backend: SubAgentBackend;
  private activeAgents: Map<string, SubAgentHandle> = new Map();

  constructor(backend: SubAgentBackend = new InProcessSubAgentBackend()) {
    this.backend = backend;
  }

  /**
   * Spawn a new SubAgent with the given specification.
   * @param spec The SubAgent specification
   * @returns A handle to the spawned SubAgent
   */
  async spawn(spec: SubAgentSpec): Promise<SubAgentHandle> {
    const handle = await this.backend.spawn(spec);
    this.activeAgents.set(handle.id, handle);

    // Clean up when the agent finishes
    handle.result().finally(() => {
      this.activeAgents.delete(handle.id);
    });

    return handle;
  }

  /**
   * Get all active SubAgent handles.
   */
  getActiveAgents(): SubAgentHandle[] {
    return Array.from(this.activeAgents.values());
  }

  /**
   * Abort all active SubAgents.
   */
  async abortAll(): Promise<void> {
    await Promise.all(Array.from(this.activeAgents.values()).map((agent) => agent.abort()));
  }

  /**
   * Terminate all active SubAgents.
   */
  async terminateAll(): Promise<void> {
    await Promise.all(Array.from(this.activeAgents.values()).map((agent) => agent.terminate()));
  }
}

/**
 * Default global SubAgent runtime instance.
 */
export const subAgentRuntime = new SubAgentRuntime();
