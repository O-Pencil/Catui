/**
 * [WHO]: Barrel exports - SubAgentRuntime, SubAgentBackend types, SubAgentSpec, SubAgentResult, SubAgentHandle
 * [FROM]: Depends on ./sub-agent-runtime, ./sub-agent-backend, ./sub-agent-types, ./subprocess-backend
 * [TO]: Consumed by extensions/defaults/subagent/*, extensions/defaults/team/*
 * [HERE]: core/sub-agent/index.ts - SubAgent runtime public API
 */

export { SubAgentRuntime, subAgentRuntime } from "./sub-agent-runtime.js";
export { InProcessSubAgentBackend } from "./sub-agent-backend.js";
export { SubprocessSubAgentBackend } from "./subprocess-backend.js";
export type { SubprocessBackendOptions } from "./subprocess-backend.js";
export type {
  SubAgentSpec,
  SubAgentEvent,
  SubAgentResult,
  SubAgentHandle,
  SubAgentBackend,
} from "./sub-agent-types.js";
