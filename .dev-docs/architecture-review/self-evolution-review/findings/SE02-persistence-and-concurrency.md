# SE02 — Persistence and Concurrency

**Status:** accepted

## Risk

An interrupted write, concurrent refinement, corrupt pointer, or reload failure could otherwise activate a partial revision or silently replace a newer champion.

## Decision

Candidate proposal/content and finalized revisions are immutable. Evidence is write-once. `current.json` is the only mutable activation pointer and is written by temp-file plus atomic rename. Promotion re-reads the pointer and compares it with the candidate baseline. History is append-only. Reload failure restores the predecessor pointer.

## Mechanical Gate

Tests must prove exclusive immutable writes, stale-baseline rejection, full revision creation before pointer swap, append-only history, recovery behavior, and rollback without editing old revisions.
