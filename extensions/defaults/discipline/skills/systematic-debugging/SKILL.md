---
name: systematic-debugging
description: Use for any bug, test failure, build failure, performance issue, flaky behavior, or unexpected runtime result before proposing fixes.
---

# Systematic Debugging

Find the root cause before changing code.

## Gate

No fixes before root-cause investigation. A patch that only explains the symptom is not ready.

## Process

1. Read the exact error, stack trace, failing assertion, or observed behavior.
2. Reproduce the issue or document why reproduction is not currently possible.
3. Check recent changes and nearby working examples.
4. Trace the bad value, state, or control flow backward to its source.
5. Form one explicit hypothesis: "X causes Y because Z."
6. Test the hypothesis with the smallest evidence-gathering action.
7. Add a failing regression test or minimal reproduction before the fix when the codebase can support it.
8. Implement one root-cause fix.
9. Run focused verification, then broader regression checks as risk requires.

## Stop Conditions

Stop and re-analyze when a hypothesis fails. If three fix attempts fail or each fix reveals a new unrelated problem, question the architecture instead of stacking patches.
