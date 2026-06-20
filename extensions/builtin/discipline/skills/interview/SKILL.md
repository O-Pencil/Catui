---
name: interview
description: Use when a user request has unclear intent, unresolved decisions, vague scope, or touches many modules. Clarifies what to build before implementation through exploration or structured questioning.
---

# Interview

Clarify what to build before writing code. Two modes: exploration (problem unclear) and interrogation (decisions unresolved).

## When to invoke

- User request is vague ("optimize", "improve", "add a feature") without concrete scope.
- Intent is unclear — you don't know what problem they're solving.
- Multiple valid approaches exist and trade-offs need user judgment.
- Request spans multiple modules or files with unclear boundaries.
- Architectural or behavioral decisions that are hard to reverse later.

Do NOT invoke for: clear bug fixes, small targeted changes, tasks where the user already specified approach and scope.

## Gate

No implementation until you can state:
- The user-visible goal
- The constrained scope
- The recommended approach and at least one rejected alternative
- The main files or modules likely affected

For small changes, the design can be short. The gate is clarity, not ceremony.

## Mode 1: Exploration (problem unclear)

Use when you don't understand what the user wants to achieve.

1. **Explore context.** Read relevant code, docs, recent changes. Understand the current state.
2. **Ask open questions.** One at a time. "What problem are you trying to solve?" "What would success look like?"
3. **Propose approaches.** Present 2-3 viable options with trade-offs.
4. **Recommend one.** Explain why it fits the existing codebase.
5. **Get approval.** Confirm the user agrees before proceeding.

## Mode 2: Interrogation (decisions unresolved)

Use when the problem is clear but implementation decisions need resolution.

1. **Read code first.** Before asking anything, explore the relevant parts of the codebase. If a question can be answered by reading code, answer it yourself.
2. **Map the decision tree.** Identify every decision. Order by dependency — foundational choices first.
3. **Ask one question at a time using `AskUserQuestion`.** Each call contains exactly one question. Always include a recommended option as the first choice with "(Recommended)" suffix.
4. **Adapt the tree.** After each answer, reassess. Some branches become irrelevant; new ones emerge.
5. **Summarize.** State resolved decisions in 3-5 lines.

## Question quality

- Specific and actionable: "Should we use approach A or B?" not "What do you think?"
- Recommendations grounded in codebase evidence, not generic best practices.
- If you catch yourself asking something already answerable from code, stop and read the code.

## During the session

If domain terms are being discussed or challenged, apply `domain-modeling` principles inline — sharpen vocabulary, update CONTEXT.md if it exists, offer ADRs for hard-to-reverse decisions.

## Handoff

Once decisions are resolved:
- If implementation spans multiple steps → transition to `writing-plans`.
- If it's a single focused change → proceed directly to implementation.
