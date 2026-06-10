/**
 * [WHO]: Task type definitions (Task, TaskStatus)
 * [FROM]: Inspired by Claude Code utils/tasks.ts
 * [TO]: Consumed by task-store.ts, all task-tools
 * [HERE]: extensions/builtin/task/task-types.ts - type definitions for task system
 */

import { Type, type Static } from "@sinclair/typebox";

// ============================================================================
// Task Status
// ============================================================================

export const TaskStatusValues = ["pending", "in_progress", "completed"] as const;
export type TaskStatus = (typeof TaskStatusValues)[number];

// Extended status for TaskUpdate (includes 'deleted' as a special action)
export const TaskUpdateStatusValues = [...TaskStatusValues, "deleted"] as const;
export type TaskUpdateStatus = (typeof TaskUpdateStatusValues)[number];

// ============================================================================
// Task Schema (TypeBox)
// ============================================================================

export const TaskSchema = Type.Object({
	id: Type.String(),
	subject: Type.String(),
	description: Type.String(),
	activeForm: Type.Optional(Type.String()),
	owner: Type.Optional(Type.String()),
	status: Type.Union(TaskStatusValues.map(s => Type.Literal(s))),
	blocks: Type.Array(Type.String()),
	blockedBy: Type.Array(Type.String()),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type Task = Static<typeof TaskSchema>;

// ============================================================================
// Task List ID
// ============================================================================

/** Default task list ID for standalone sessions */
export const DEFAULT_TASK_LIST_ID = "tasklist";

/**
 * Sanitize a string for safe use in file paths.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
export function sanitizePathComponent(input: string): string {
	return input.replace(/[^a-zA-Z0-9_-]/g, "-");
}
