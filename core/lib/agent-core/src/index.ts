/**
 * [WHO]: agent-core barrel exports
 * [FROM]: Depends on agent.js, agent-loop.js, structured-adaptive-agent-loop.js (thin wrapper shim), structured-adaptive-tool-orchestration.js, structured-adaptive-streaming-tool-executor.js (deprecated; no in-tree consumer), proxy.js, types.js
 * [TO]: Consumed by @catui/agent-core package consumers
 * [HERE]: core/lib/agent-core/src/index.ts - agent-core entry point
 */
// Core Agent
export * from "./agent.js";
// Loop functions
export * from "./agent-loop.js";
// weak-model-compatible loop compatibility shim (thin wrapper around agentLoop)
export * from "./structured-adaptive-agent-loop.js";
export * from "./structured-adaptive-tool-orchestration.js";
// Streaming tool executor (deprecated compatibility export; see file header)
export * from "./structured-adaptive-streaming-tool-executor.js";
// Proxy utilities
export * from "./proxy.js";
// Types
export * from "./types.js";
// Errors
export * from "./errors.js";
export * from "./tool-policy.js";
export * from "./loop-progress.js";
export * from "./run-checkpoint.js";
export * from "./run-trace.js";
export * from "./run-trace-recorder.js";
export * from "./run-replay.js";
export * from "./run-trace-context.js";
