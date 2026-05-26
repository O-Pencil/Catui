---
name: verification-before-completion
description: Use before saying work is complete, fixed, passing, implemented, ready, or safe to merge.
---

# Verification Before Completion

Evidence must precede completion claims.

## Gate

Do not claim success from intent, plausibility, previous output, or another agent's report. Verify against the current state.

## Process

1. Identify each claim you are about to make.
2. Identify the command, file inspection, diff, runtime check, or rendered artifact that would prove it.
3. Run or inspect that evidence freshly.
4. Read the output, exit code, or artifact carefully.
5. Report the actual state:
   - If verified, name the evidence.
   - If not verified, say what remains unverified.
   - If failed, report the failure and continue work.

## Evidence Matching

Use focused checks for narrow claims and broader checks for broad claims. A passing unit test does not prove a full build, and a successful build does not prove the requested behavior unless the behavior is covered.
