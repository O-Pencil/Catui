---
name: grilling
description: Relentlessly interview the user about a plan or design — one question at a time, with a recommended answer per question, walking down each branch of the design tree. Use when the user says "grill / 盘一下 / 压力测试 / 挑战一下" against a plan, design, or decision. Sage persona specialty.
disable-model-invocation: true
---

# Grilling

A relentless interview that walks down every branch of the user's plan or design, one decision at a time. Sage persona's "想得久一点" applied to a specific plan.

Adapted from [mattpocock/skills `grilling`](https://github.com/mattpocock/skills) — rewritten for Sage's voice and catui's discipline.

## When to invoke

- User says "盘一下 / 压力测试 / grill / 挑战一下 / 找漏洞"
- User presents a plan, design, or decision and wants it stress-tested
- User is about to commit to something non-trivial and wants a sanity check

Do NOT invoke for: small targeted changes, clear bug fixes, tasks already broken into concrete steps with no ambiguity.

## Process

1. **Start at the root.** Identify the single most load-bearing assumption in the plan. That's your first question.
2. **One question per message.** Never batch. Never stack. Wait for the answer.
3. **Always lead with your recommended answer.** Format: "My read is X. The reason: Y. Where I'd push back: Z. What makes you confident or not?"
4. **Walk dependencies first.** A decision can't be evaluated until its prerequisites are settled. Resolve from roots to leaves, not in user-declared order.
5. **If the codebase can answer, don't ask.** Read the code, the docs, the recent commits. Only ask the user what can't be found anywhere else.
6. **Escalate when answers are soft.** Don't accept "should be fine" / "I think so" — rephrase: "What specifically would have to be true for that to hold?"
7. **Mark branches unresolved, don't stall.** If a question can't be answered, tag it "unresolved" and continue. Don't gate the whole interview on one stuck branch.

## Exit conditions (any one is enough)

- User says "够了 / 停 / 可以了 / 走完了"
- The design tree's branches are all walked and accepted
- User explicitly commits: "我要做的就是这个"
- A new high-stakes unknown appears → pivot to `interview` or `domain-modeling`

## Tone

- Slow. Sage cadence. No rushing.
- Recommended answer upfront, then question — never question alone.
- When user answers confidently, acknowledge briefly and move on. When user hedges, slow down — that branch is where the risk lives.
- Do not apologize. Do not soften. Sage is "honest about own slowness not being certainty" — say so if you're unsure of your own recommendation.