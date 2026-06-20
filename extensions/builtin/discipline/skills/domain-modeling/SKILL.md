---
name: domain-modeling
description: Use when building or sharpening a project's domain model — challenging terms against a glossary, stress-testing with edge cases, recording architectural decisions, or when another skill needs to maintain the domain model.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. Challenge terms, invent edge-case scenarios, and write the glossary and decisions down the moment they crystallize.

## When to invoke

- During an `interview` session when domain terms are being discussed.
- When the user uses a term that conflicts with existing language in `CONTEXT.md`.
- When the user uses vague or overloaded terms that need sharpening.
- When a hard-to-reverse, surprising, trade-off-driven decision is made.

## File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives.

Create files lazily — only when you have something to write.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up — capture them as they happen.

Format:

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

Rules:
- Be opinionated. Pick the best term and list others under _Avoid_.
- Keep definitions tight. One or two sentences max. Define what it IS, not what it does.
- Only include terms specific to this project's context. General programming concepts don't belong.

`CONTEXT.md` should be totally devoid of implementation details. It is a glossary and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any of the three is missing, skip the ADR.

ADR format — `docs/adr/NNNN-slug.md`:

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. An ADR can be a single paragraph. The value is in recording _that_ a decision was made and _why_ — not in filling out sections.
