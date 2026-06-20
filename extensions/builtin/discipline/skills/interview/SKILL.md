---
name: interview
description: Use when a user request has multiple unresolved decisions, touches many modules, or describes intent vaguely. Walks the decision tree one question at a time before implementation.
---

# Interview

Resolve every branch of the decision tree before writing code.

## When to invoke

- User request spans multiple modules or files with unclear boundaries.
- Request is vague ("optimize", "improve", "add a feature") without concrete scope.
- Multiple valid approaches exist and the trade-offs need user judgment.
- Architectural or behavioral decisions that are hard to reverse later.

Do NOT invoke for: clear bug fixes, small targeted changes, tasks where the user already specified approach and scope.

## Gate

No implementation until every decision in the tree is resolved. The gate is a shared understanding of what to build, how, and why — not a signed-off spec.

## Process

1. **Read code first.** Before asking anything, explore the relevant parts of the codebase. If a question can be answered by reading code, answer it yourself. Do not ask the user what you can discover.

2. **Map the decision tree.** Identify every decision that needs resolution. Order them by dependency — foundational choices first, details later.

3. **Ask one question at a time using `AskUserQuestion`.** Each call should contain exactly one question. Always include a recommended option as the first choice with "(Recommended)" suffix. The recommendation should reflect your judgment based on codebase evidence.

4. **Adapt the tree.** After each answer, reassess remaining questions. Some branches may become irrelevant; new ones may emerge. Continue until all critical decisions are resolved.

5. **Summarize and act.** Once the tree is walked, state the resolved decisions in 3-5 lines, then proceed to implementation. If the plan involves multiple steps, transition to `writing-plans`.

## Question quality

- Each question must be specific and actionable. Not "what do you think about X?" but "should we use approach A or B for X?"
- Recommendations must be grounded in codebase evidence, not generic best practices.
- If you catch yourself asking a question whose answer is already in the code, stop and read the code instead.

## Relationship to other skills

- `brainstorming` is open-ended exploration; interview is structured interrogation. Use brainstorming when the problem itself is unclear; use interview when the problem is known but decisions are unresolved.
- After interview resolves decisions, hand off to `writing-plans` if implementation spans multiple steps.
