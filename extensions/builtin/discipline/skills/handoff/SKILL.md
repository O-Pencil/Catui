---
name: handoff
description: Use when the current conversation is approaching context limits, needs to continue in a fresh session, or the user explicitly asks to hand off work. Compacts the conversation into a handoff document.
---

# Handoff

Compact the current conversation into a handoff document so another session can continue the work.

## When to invoke

- Context window is approaching limits and work is not finished.
- User explicitly asks to hand off or continue in a fresh session.
- A long-running task needs to be split across multiple sessions.
- Branching into a prototype or exploration that should not pollute the main session.

## Process

1. **Summarize the current state.** What was the goal? What has been accomplished? What remains?

2. **Capture key decisions.** List decisions made during the session, with rationale. Do not duplicate content already captured in other artifacts (commits, ADRs, plans) — reference them by path or identifier instead.

3. **List open questions and blockers.** What is unresolved? What does the next session need to figure out first?

4. **Identify relevant files.** Which files were created, modified, or are important for continuation? Include paths.

5. **Suggest next steps.** Concrete actions the next session should take, in priority order.

6. **Write the handoff document.** Save to the OS temporary directory (resolve from `$TMPDIR`, falling back to `/tmp`). Filename: `handoff-{topic}-{timestamp}.md`.

7. **Tell the user.** Provide the file path and suggest they start a new session referencing it.

## Handoff document format

```md
# Handoff: {Topic}

**Date**: {timestamp}
**Session**: {session ID if available}

## Goal
{One sentence: what we're trying to accomplish}

## Completed
- {what's done}

## In Progress
- {what's partially done, current state}

## Remaining
- {what needs to happen next}

## Key Decisions
- {decision}: {rationale}

## Important Files
- `{path}` — {what it is / why it matters}

## Open Questions
- {unresolved question}

## Suggested Next Steps
1. {first action}
2. {second action}
```

## Rules

- Do not duplicate content already in commits, ADRs, plans, or other durable artifacts. Reference them.
- Redact sensitive information (API keys, passwords, tokens).
- Keep it concise — the goal is continuity, not a full transcript.
- If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
