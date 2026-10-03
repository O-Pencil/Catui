---
name: structured-explanation
description: Use when answering "how does X work", "why does X do Y", "what's the difference between X and Y", or any request that needs more than a one-line answer. Also for design choices, trade-offs, and any topic with multiple layers.
---

# Structured Explanation

Enabled by default: makes complex answers both quick to read and clear to understand.

## When to activate

- User asks "why" / "how does it work" / "what's the difference"
- Involves a design decision / trade-off / multiple options
- Explaining an unfamiliar concept, library, API, protocol, algorithm
- Debugging a non-obvious bug
- Any "elaborate" / "explain clearly" / "in detail"

## When NOT to activate

- A one-line factual answer ("what is X" → answer and stop)
- User explicitly says "keep it short" / "one sentence"
- User is in a hurry / emotionally strained
- This is small talk, wrap-up, transition

## Mode: four-layer structure

Combine as needed, no need to use all four each time:

### 1. TL;DR (one-sentence conclusion)

The first sentence is the conclusion. Don't make the user read the whole paragraph to find out what you're saying.

> ✅ "X is about 30% faster than Y, at the cost of doubled memory."
> ❌ "X is a new approach, internally it makes a series of optimizations..."

### 2. Key points (2-4 items)

One line each. Bold lead.

> **Core mechanism** — X caches Y in Z; on hit, skip N steps of computation
> **Cost** — first call is about 2x slower than Y
> **When it fits** — repeated calls, slowly-changing data

### 3. Example (optional)

A concrete example beats ten paragraphs of theory for complex concepts.

### 4. Boundary / counter-example (optional)

When it doesn't fit, when it breaks.

## Output formats

Pick by scenario:

| Scenario | Format |
|----------|--------|
| Explain a mechanism | TL;DR + key points + example |
| Compare A and B | Table (columns: dimension / A / B) |
| List trade-offs | List (each item: option + upside + cost) |
| Teach a new concept | TL;DR + analogy + key points + counter-example |
| Explain a decision | Conclusion + why + rejected options + when to re-evaluate |

## Rhythm

- Default Chinese paragraph 80-150 characters
- List items fit on one line
- Code blocks only the key parts; 5-15 lines ideal
- Use H2 to split sections when needed
- Don't write "as mentioned above" / "to put it simply" / "obviously" — empty filler

## Counter-examples

❌ A 500-word continuous prose, opening with historical background

❌ 50 lines of code dumped without explanation

❌ 5 minutes of explanation that never gives the conclusion

❌ "This is actually quite complex, it needs to be split into several aspects..." (empty preamble)

✅ "X is a lazy cache, computes once on write, returns directly on subsequent hits. Cost: first call slower, more memory. **Not suitable** for write-heavy scenarios."

✅ "**TL;DR** — A is faster, B is more memory-efficient. **When to pick A** — read-heavy. **When to pick B** — write-dense."

## Combines with

- Together with `decision-framing`: first apply the decision frame, then unfold with structured explanation
- Together with `empathetic-communication`: first acknowledge the situation, then offer the structured path
