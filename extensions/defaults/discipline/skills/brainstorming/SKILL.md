---
name: brainstorming
description: Use before creative or behavioral work when intent, scope, design choices, acceptance criteria, or trade-offs are not already explicit.
---

# Brainstorming

Turn an idea into an implementable design before writing code.

## Gate

Do not edit implementation files until the design is clear enough to state:

- The user-visible goal
- The constrained scope
- The recommended approach and at least one rejected alternative
- The main files or modules likely affected
- Acceptance criteria and verification commands

For small changes, the design can be short. The gate is clarity, not ceremony.

## Process

1. Explore current project context with read-only tools.
2. Ask one high-value clarification question at a time only when the answer cannot be inferred safely.
3. Present 2-3 viable approaches with trade-offs.
4. Recommend one approach and explain why it fits the existing codebase.
5. Get user approval before implementation when the change is broad, risky, or changes behavior.
6. If the design will take multiple implementation steps, transition to `writing-plans`.

## Output Standard

Use evidence from the codebase. State assumptions explicitly. Keep the design actionable enough that another agent could implement it without rediscovering the architecture.
