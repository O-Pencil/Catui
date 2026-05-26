---
name: test-driven-development
description: Use when implementing features, bug fixes, refactors, or behavior changes before writing production code.
---

# Test-Driven Development

Use red, green, refactor for behavior changes.

## Gate

No production behavior change without first seeing a test fail for the intended reason, unless the user explicitly accepts an exception.

## Cycle

1. Write the smallest test that describes one desired behavior.
2. Run it and verify it fails for the expected reason.
3. Implement the minimum production code needed to pass.
4. Run the focused test and verify it passes.
5. Run nearby or broader tests appropriate to the blast radius.
6. Refactor only after tests are green, then re-run verification.

## Good Tests

- Test observable behavior, not private implementation details.
- Prefer real code paths over mocks unless isolation requires a mock.
- Use names that describe the behavior being guaranteed.
- Split tests when the name needs "and".

## Exceptions

Acceptable exceptions include pure documentation, generated artifacts, exploratory prototypes, and configuration-only changes. State the exception before proceeding.
