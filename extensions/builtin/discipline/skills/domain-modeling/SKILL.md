---
name: domain-modeling
description: Use when building or sharpening a project's domain model — challenging terms, stress-testing with edge cases, recording architectural decisions, or applying design principles like depth, seams, and testability. Invoked by other skills (e.g., interview) or directly when domain clarity or design quality is needed.
---

# Domain Modeling

Actively build and sharpen the project's domain model and design quality. Challenge terms, invent edge-case scenarios, write the glossary and decisions down the moment they crystallize, and apply deep-module design principles.

## When to invoke

- During an `interview` session when domain terms or design decisions are being discussed.
- When the user uses a term that conflicts with existing language in `CONTEXT.md`.
- When designing or improving a module's interface, finding deepening opportunities, or deciding where a seam goes.
- When a hard-to-reverse, surprising, trade-off-driven decision is made.

This skill is often invoked by other skills. It can also be used directly when you need to clarify domain vocabulary or improve design quality.

## Part 1: Domain Vocabulary

### File structure

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

## Part 2: Design Principles

Use these terms exactly when discussing module design — don't substitute "component," "service," "API," or "boundary."

### Glossary

**Module** — anything with an interface and an implementation. Deliberately scale-agnostic: a function, class, package, or tier-spanning slice. _Avoid_: unit, component, service.

**Interface** — everything a caller must know to use the module correctly: the type signature, invariants, ordering constraints, error modes, required configuration, and performance characteristics. _Avoid_: API, signature (too narrow).

**Depth** — leverage at the interface: the amount of behaviour a caller can exercise per unit of interface they have to learn. A module is **deep** when large behaviour sits behind a small interface, **shallow** when the interface is nearly as complex as the implementation.

**Seam** — a place where you can alter behaviour without editing in that place; the location at which a module's interface lives. _Avoid_: boundary (overloaded).

**Adapter** — a concrete thing that satisfies an interface at a seam. Describes _role_ (what slot it fills), not substance.

### Deep vs shallow

**Deep module** = small interface + lots of implementation (good):

```
┌─────────────────────┐
│   Small Interface   │ ← Few methods, simple params
├─────────────────────┤
│ Deep Implementation │ ← Complex logic hidden
└─────────────────────┘
```

**Shallow module** = large interface + little implementation (avoid):

```
┌─────────────────────────────────┐
│         Large Interface         │ ← Many methods, complex params
├─────────────────────────────────┤
│       Thin Implementation       │ ← Just passes through
└─────────────────────────────────┘
```

When designing an interface, ask:
- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?

### Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, swappable parts — they just aren't part of the interface.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you want to test _past_ the interface, the module is probably the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a seam unless something actually varies across it.

### Designing for testability

Good interfaces make testing natural:

1. **Accept dependencies, don't create them.**
2. **Return results, don't produce side effects.**
3. **Small surface area.** Fewer methods = fewer tests needed. Fewer params = simpler test setup.
