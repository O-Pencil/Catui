/**
 * [WHO]: Barrel exports - WorktreeManager, WorkspacePath
 * [FROM]: Depends on ./worktree-manager
 * [TO]: Consumed by core/sub-agent/*, extensions/builtin/subagent/*, extensions/builtin/team/*
 * [HERE]: core/workspace/index.ts - workspace management public API
 */

export { WorktreeManager, worktreeManager } from "./worktree-manager.js";
export type { WorkspacePath } from "./worktree-manager.js";
