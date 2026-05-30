/**
 * [WHO]: Compaction barrel exports
 * [FROM]: Depends on branch-summarization, compaction, utils
 * [TO]: Consumed by index.ts, core/extensions-host/types.ts, core/runtime/agent-session.ts, modes/rpc/rpc-types.ts, modes/rpc/rpc-client.ts, modes/interactive/interactive-mode.ts
 * [HERE]: core/session/compaction/index.ts - compaction module barrel
 */
export * from "./branch-summarization.js";
export * from "./compaction.js";
export * from "./utils.js";
