---
name: test-driven-development
description: Use when implementing features, bug fixes, refactors, or behavior changes before writing production code.
---

# Test-Driven Development

Use red, green, refactor for behavior changes.

## Gate

No production behavior change without first seeing a test fail for the intended reason, unless the user explicitly accepts an exception.

## Anti-pattern: horizontal slices

**Do NOT write all tests first, then all implementation.** This is "horizontal slicing" — treating RED as "write all tests" and GREEN as "write all code."

This produces bad tests:
- Tests written in bulk test _imagined_ behavior, not _actual_ behavior.
- You end up testing the _shape_ of things (data structures, signatures) rather than user-facing behavior.
- Tests become insensitive to real changes — they pass when behavior breaks, fail when behavior is fine.
- You outrun your headlights, committing to test structure before understanding the implementation.

```
WRONG (horizontal):
 RED: test1, test2, test3, test4, test5
 GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
 RED→GREEN: test1→impl1
 RED→GREEN: test2→impl2
 RED→GREEN: test3→impl3
```

## Cycle

One test → one implementation → repeat. Each test responds to what you learned from the previous cycle.

1. Write the smallest test that describes one desired behavior.
2. Run it and verify it fails for the expected reason.
3. Implement the minimum production code needed to pass.
4. Run the focused test and verify it passes.
5. Run nearby or broader tests appropriate to the blast radius.
6. Refactor only after tests are green, then re-run verification.

## Good Tests

- Test observable behavior through public interfaces, not private implementation details.
- Prefer real code paths over mocks unless isolation requires a mock.
- Use names that describe the behavior being guaranteed.
- Split tests when the name needs "and".
- A good test reads like a specification — "user can checkout with valid cart" tells you exactly what capability exists.
- The warning sign: your test breaks when you refactor, but behavior hasn't changed. Those tests were testing implementation, not behavior.

## Exceptions

Acceptable exceptions include pure documentation, generated artifacts, exploratory prototypes, and configuration-only changes. State the exception before proceeding.
