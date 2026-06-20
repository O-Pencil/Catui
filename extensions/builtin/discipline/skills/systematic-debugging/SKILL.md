---
name: systematic-debugging
description: Use for any bug, test failure, build failure, performance issue, flaky behavior, or unexpected runtime result before proposing fixes.
---

# Systematic Debugging

Find the root cause before changing code.

## Gate

No fixes before root-cause investigation. A patch that only explains the symptom is not ready.

## Phase 1 — Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a tight pass/fail signal for the bug — one that goes red on _this_ bug — you will find the cause. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. Be aggressive. Be creative. Refuse to give up.

### Ways to construct one — try in roughly this order

1. **Failing test** at whatever seam reaches the bug — unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** — drives the UI, asserts on DOM/console/network.
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states, automate "boot at state X, check, repeat" so you can `git bisect run` it.
9. **Differential loop.** Run the same input through old-version vs new-version and diff outputs.

### Tighten the loop

Once you have _a_ loop, tighten it:
- Can I make it faster? (Cache setup, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem.)

A 30-second flaky loop is barely better than no loop; a 2-second deterministic one is tight.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100x, parallelise, add stress, narrow timing windows. A 50%-flake bug is debuggable; 1% is not — keep raising the rate.

### Completion criterion

Phase 1 is done when you can name **one command** that you have already run at least once, and that is:
- **Red-capable** — drives the actual bug code path and asserts the user's exact symptom.
- **Deterministic** — same verdict every run (or a pinned high reproduction rate).
- **Fast** — seconds, not minutes.
- **Agent-runnable** — can run unattended.

If you catch yourself reading code to build a theory before this command exists, **stop**. No red-capable command, no Phase 2.

## Phase 2 — Reproduce + minimise

Run the loop. Watch it go red. Confirm it produces the failure mode the **user** described — not a different failure nearby. Wrong bug = wrong fix.

Minimise: shrink the repro to the smallest scenario that still goes red. Cut inputs, callers, config, data, and steps **one at a time**, re-running after each cut. Done when every remaining element is load-bearing.

## Phase 3 — Hypothesise

Generate **3-5 ranked hypotheses** before testing any. Single-hypothesis generation anchors on the first plausible idea.

Each hypothesis must be falsifiable: "If X is the cause, then Y will make the bug disappear."

Show the ranked list to the user before testing when possible.

## Phase 4 — Instrument + fix

Each probe must map to a specific prediction from Phase 3. Change one variable at a time.

Tag every debug log with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep.

Write the regression test **before the fix** when a correct seam exists. If no correct seam exists, that itself is the finding — note it.

## Phase 5 — Cleanup

- Original repro no longer reproduces (re-run the Phase 1 loop).
- Regression test passes (or absence of seam is documented).
- All `[DEBUG-...]` instrumentation removed.
- The hypothesis that turned out correct is stated in the commit message.

## Stop Conditions

Stop and re-analyze when a hypothesis fails. If three fix attempts fail or each fix reveals a new unrelated problem, question the architecture instead of stacking patches.

When you genuinely cannot build a feedback loop, stop and say so explicitly. List what you tried. Ask the user for access to the reproducing environment, a captured artifact (HAR file, log dump, core dump), or permission to add temporary instrumentation. Do not proceed to hypothesise without a loop.
