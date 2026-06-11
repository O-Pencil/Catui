/**
 * [WHO]: TaskCreate tool - creates a new task in the task list
 * [FROM]: Depends on @sinclair/typebox, ../task-store, ../task-types
 * [TO]: Consumed by task extension via registerTool()
 * [HERE]: extensions/builtin/task/task-tools/task-create-tool.ts
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { Container, Text, type Component } from "@pencil-agent/tui";
import type { Theme } from "../../../../core/theme-contract.js";
import { createTask } from "../task-store.js";
import { DEFAULT_TASK_LIST_ID } from "../task-types.js";

const taskCreateSchema = Type.Object({
	subject: Type.String({ description: "A brief title for the task" }),
	description: Type.String({ description: "What needs to be done" }),
	activeForm: Type.Optional(
		Type.String({
			description:
				'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
		}),
	),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Arbitrary metadata to attach to the task",
		}),
	),
});

export type TaskCreateInput = Static<typeof taskCreateSchema>;

export function createTaskCreateTool() {
	return {
		name: "TaskCreate",
		label: "Create Task",
		description: "Create a new task in the task list.",
		parameters: taskCreateSchema,

		renderCall: (args: unknown, theme: Theme): Component => {
			const a = args as TaskCreateInput;
			const container = new Container();
			container.addChild(new Text(theme.fg("toolTitle", theme.bold("TaskCreate")), 0, 0));
			container.addChild(new Text(theme.fg("muted", "  Subject: ") + theme.fg("text", a.subject ?? ""), 0, 0));
			if (a.description) {
				const desc = a.description.length > 200 ? a.description.slice(0, 200) + "..." : a.description;
				container.addChild(new Text(theme.fg("muted", "  ") + theme.fg("toolOutput", desc), 0, 0));
			}
			return container;
		},

		renderResult: (result: AgentToolResult<unknown>, _opts: { expanded: boolean; isPartial: boolean }, theme: Theme): Component => {
			const container = new Container();
			const details = result.details as { task?: { id: string; subject: string }; error?: string } | undefined;
			if (details?.error) {
				container.addChild(new Text(theme.fg("error", "  " + details.error), 0, 0));
			} else if (details?.task) {
				container.addChild(
					new Text(theme.fg("success", `  Task #${details.task.id} created`) + theme.fg("muted", " — ") + theme.fg("text", details.task.subject), 0, 0),
				);
			} else {
				const textOut = result.content?.filter((c) => c.type === "text").map((c) => c.type === "text" ? c.text : "").join("\n");
				if (textOut) container.addChild(new Text(theme.fg("toolOutput", textOut), 0, 0));
			}
			return container;
		},

		guidance: `Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: What needs to be done
- **activeForm** (optional): Present continuous form shown in the spinner when the task is in_progress (e.g., "Fixing authentication bug"). If omitted, the spinner shows the subject instead.

All tasks are created with status \`pending\`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks`,

		async execute(
			_toolCallId: string,
			params: TaskCreateInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const task = await createTask(ctx.agentDir, DEFAULT_TASK_LIST_ID, {
					subject: params.subject,
					description: params.description,
					activeForm: params.activeForm,
					status: "pending",
					owner: undefined,
					blocks: [],
					blockedBy: [],
					metadata: params.metadata,
				});

				return {
					content: [
						{
							type: "text",
							text: `Task #${task.id} created successfully: ${task.subject}`,
						},
					],
					details: { task: { id: task.id, subject: task.subject } },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: Failed to create task: ${message}` }],
					details: { error: message },
				};
			}
		},
	};
}
