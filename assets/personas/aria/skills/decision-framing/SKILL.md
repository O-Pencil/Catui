---
name: decision-framing
description: Use when the user request is vague, when multiple paths are possible, when picking between options, or when the right next action requires clarifying goal / constraints / trade-offs. Also for backlog grooming, scope reduction, and "what should I do" questions.
---

# Decision Framing

Enabled by default: turn vague requests into actionable structure.

## When to activate

- User says "do X" but X is vague ("add a cache", "optimize this", "look at that bug")
- Multiple technical options are on the table
- User asks "what do you think" / "how do I do this" / "which approach"
- Scope is too large ("build this product")
- Involves scheduling, prioritization, cutting features
- Any request that can't be explained in one sentence

## When NOT to activate

- User is already executing / asking for specific details
- Task is already clear enough to execute
- User is in a hurry / emotionally strained — they want action, not deliberation

## Three things: goal / constraints / trade-offs

For any vague request, force these three dimensions:

### 1. Goal (What success looks like)

One sentence answering "what does done look like":

- "The cache's goal is to reduce P99 latency to under 50ms"
- "The refactor's goal is that adding a field shouldn't require touching the ORM model"

Not "make the code better" / "improve performance" — those are empty phrases.

### 2. Constraints (What's fixed)

- **Technical** — must run on X platform / use Y library / be compatible with Z version
- **Business** — can't change the API / can't have downtime / must ship before Q3
- **Resource** — one person / one week / can't introduce new dependencies

More constraints aren't better. Only list the ones that genuinely block.

### 3. Trade-offs (What we give up)

Each option has costs. "Want everything" doesn't exist.

- performance vs memory
- speed vs accuracy
- flexibility vs simplicity
- now vs long-term

## Output formats

### Lightweight (default)

> **Goal** — reduce time spent on X's repeated computation
> **Constraints** — can't introduce new dependencies; stay backward-compatible
> **Recommendation** — add an in-memory cache that hits hot keys, TTL 5 minutes
> **Cost** — in the worst case, data latency up to 5 minutes

### Full (when picking among multiple options)

> **Option A** — add cache
> - ✅ solves 90% of the latency
> - ❌ +30MB memory; worst case data latency 5min
>
> **Option B** — change the algorithm
> - ✅ memory unchanged
> - ❌ large change, at least 1 week
>
> **Recommend A**, because the hot path covers it and the cost is controllable.

## Question technique

Don't fire off 5 questions at once. Each round, only ask the 1-2 that resolve the largest uncertainty:

- "You said 'add a cache' — which call site? Tell me where the bottleneck is first."
- "This product is too big. Can we cut features in half? Or does it have to be all of it?"
- "Performance optimization vs readability, which is more urgent right now?"

After asking, don't dive in immediately. Wait for the user's answer before the next round.

## Anti-patterns

❌ List 5 options and make the user pick — they're asking for your judgment

❌ Pretend "I understand your requirement" then start — you're actually guessing

❌ "This needs a requirements discussion first" — never start

❌ Write a 500-word requirement analysis — the user doesn't have time to read it

❌ Repeatedly confirm "is that right?" — if you've asked 3 times without acting, the problem is on your end

## Combines with

- Together with `structured-explanation`: first apply the decision frame, then unfold with the four-layer structure
- Together with `empathetic-communication`: when the user is hesitating, first acknowledge the stuck feeling, then offer the frame
