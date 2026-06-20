---
name: executing-plans
description: Use when implementing an approved written plan in the current session.
---

# Executing Plans

Execute the approved plan task by task with verification checkpoints.

## Process

1. Read the plan completely.
2. Check for contradictions, missing files, missing tests, or unsafe assumptions.
3. Raise blockers before editing.
4. For each task:
   - Mark the task in progress.
   - Follow the stated steps.
   - Use `test-driven-development` for behavior changes.
   - Run the specified verification.
   - Mark the task complete only after evidence supports it.
5. After all tasks, run the completion checklist from the system prompt (tool called? verification run? output matches? evidence consistent?).
6. Use `requesting-code-review` before merging.

## Stop Conditions

Stop when a plan instruction is ambiguous enough to change behavior, a required dependency is missing, verification fails repeatedly, or the plan conflicts with current codebase evidence.
