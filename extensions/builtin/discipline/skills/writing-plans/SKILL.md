---
name: writing-plans
description: Use when a task needs multiple implementation steps, multiple files, handoff to another agent, or careful verification sequencing.
---

# Writing Plans

Create an implementation plan that can be executed without rediscovering context.

## Required Sections

- Goal: one sentence describing the user-visible outcome.
- Context: what the codebase currently does and why the change is needed.
- Architecture: the recommended approach and why it fits existing boundaries.
- Files: exact files to create or modify and each file's responsibility.
- Tasks: small ordered steps with verification after meaningful changes.
- Test plan: exact commands and expected evidence.
- Documentation impact: P1/P2/P3 or user docs that must change.

## Task Quality

Each task should be independently understandable. Include exact paths, APIs, data shapes, and expected behavior. Avoid placeholders such as "handle edge cases" or "add tests"; state the actual edge cases and tests.

## Handoff

When the plan is approved, execute it directly or use `executing-plans` for inline execution. Use subagents when tasks are independent and reviewable.
