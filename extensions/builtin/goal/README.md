# Goal Extension

Long-running task management for Catui. Set a goal with `/goal <objective>` and the
agent will auto-continue working on it across turns until the objective is achieved,
the token budget runs out, or you pause/clear it.

This extension mirrors the Codex `/goal` command semantics: a per-thread goal, persisted
to disk, with idle-continuation prompts, token accounting, and budget enforcement.

## Usage

```
/goal                  Show current goal summary menu
/goal <objective>      Set or replace the goal
/goal clear            Clear the goal
/goal edit             Open the editor to change the objective
/goal pause            Pause auto-continuation
/goal resume           Resume auto-continuation
/goal help             Show usage help
```

## LLM Tools

The extension registers three LLM-facing tools:

| Tool | Purpose | Who can call |
|------|---------|--------------|
| `GetGoal` | Read the current goal | LLM |
| `CreateGoal` | Create a new goal (only when the user explicitly asks) | LLM |
| `UpdateGoal` | Mark the goal `complete` or `blocked` | LLM |

The LLM is only allowed to set the goal's status to `complete` or `blocked`. Pause /
resume / budget limits are user-driven and happen exclusively through `/goal`.

## Lifecycle

`/goal resume` starts work when the agent becomes idle. Repeating it while work
is queued or running does not enqueue duplicates. Each explicit resume renews
the continuation allowance (10 consecutive automatic runs, 30 total automatic
runs between resumes); assistant/tool cycles within a run do not reset it.
Existing usage totals and token budgets are retained.

Goal and Grub share one session continuation lease. Explicitly starting or
resuming either pauses the other. Pause, clear and completion cancel only the
goal's own queued prompts; user follow-ups and other extensions' work survive.

The extension subscribes to `turn_start`, `turn_end`, `message_end`, `tool_execution_end`,
and `agent_end` to track token usage and time per turn. When a turn ends with an
`active` goal, the extension injects a follow-up user message containing the
continuation prompt so the agent keeps working on the objective.

When a turn causes the goal to cross its token budget, the extension injects a
budget-limit steering prompt and marks the goal `budget_limited`. Once budget-limited,
auto-continuation stops and the goal is terminal.

## Persistence

Goals are stored as JSON files under `<agentDir>/goals/<threadId>.json`. They survive
session restarts and are keyed by the active session ID.

## Status

`Status: active` shows in the footer while a goal is running.

## Architecture

| File | Responsibility |
|------|----------------|
| `goal-types.ts` | `ThreadGoalStatus`, `ThreadGoal`, helper predicates |
| `goal-store.ts` | Atomic JSON-file persistence (replace / insert / update / delete / account_usage) |
| `goal-format.ts` | Time/token formatting, summary lines, status indicator, validators |
| `goal-prompts.ts` | Continuation / budget-limit / objective-updated prompt templates |
| `goal-controller.ts` | Per-thread runtime: mutex, turn accounting, idle continuation |
| `goal-tools.ts` | `GetGoal`, `CreateGoal`, `UpdateGoal` LLM tool definitions |
| `goal-parser.ts` | `/goal` slash-command argument parsing |
| `goal-command.ts` | `/goal` slash-command handler (UI + controller dispatch) |
| `index.ts` | Extension entry: tools, command, lifecycle hooks, status indicator |
