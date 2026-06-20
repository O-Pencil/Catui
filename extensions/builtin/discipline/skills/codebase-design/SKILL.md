---
name: codebase-design
description: Use when designing or improving a module's interface, finding deepening opportunities, deciding where a seam goes, making code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.
---

# Codebase Design

Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean seam, testable through that interface.

## Glossary

Use these terms exactly — don't substitute "component," "service," "API," or "boundary."

**Module** — anything with an interface and an implementation. Deliberately scale-agnostic: a function, class, package, or tier-spanning slice. _Avoid_: unit, component, service.

**Interface** — everything a caller must know to use the module correctly: the type signature, invariants, ordering constraints, error modes, required configuration, and performance characteristics. _Avoid_: API, signature (too narrow).

**Implementation** — what's inside a module, its body of code.

**Depth** — leverage at the interface: the amount of behaviour a caller can exercise per unit of interface they have to learn. A module is **deep** when large behaviour sits behind a small interface, **shallow** when the interface is nearly as complex as the implementation.

**Seam** — a place where you can alter behaviour without editing in that place; the location at which a module's interface lives. _Avoid_: boundary (overloaded).

**Adapter** — a concrete thing that satisfies an interface at a seam. Describes _role_ (what slot it fills), not substance.

**Leverage** — what callers get from depth: more capability per unit of interface they learn.

**Locality** — what maintainers get from depth: change, bugs, knowledge, and verification concentrate in one place.

## Deep vs shallow

**Deep module** = small interface + lots of implementation:

```
┌─────────────────────┐
│   Small Interface   │ ← Few methods, simple params
├─────────────────────┤
│                     │
│ Deep Implementation │ ← Complex logic hidden
│                     │
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

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, swappable parts — they just aren't part of the interface.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you want to test _past_ the interface, the module is probably the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a seam unless something actually varies across it.

## Designing for testability

Good interfaces make testing natural:

1. **Accept dependencies, don't create them.**
2. **Return results, don't produce side effects.**
3. **Small surface area.** Fewer methods = fewer tests needed. Fewer params = simpler test setup.

## Relationships

- A **Module** has exactly one **Interface**.
- **Depth** is a property of a **Module**, measured against its **Interface**.
- A **Seam** is where a **Module**'s **Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies the **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for maintainers.
