# SB07 — Supervised execution and live command capabilities

Status: approved for implementation by the user, 2026-10-02.

## Placement and decision

Codex is a delegated supervisor; Catui owns local execution. The bridge remains
an extension. Generic supervision registration, bounded decision requests and
command dispatch belong to the extension host because Plan, Goal, Grub and the
bridge consume them. Feature state and command semantics stay with their owners.
No cross-extension imports, state-file edits, new model calls or dependencies.

Expose the live command catalog with explicit remote eligibility, usage, effects
and busy-state requirements. Unknown commands remain discoverable but unavailable
for remote execution until their owner declares support. Invoke the original
handler, not a model prompt. Handler return means dispatch finished, not task
completion; snapshots and execution evidence are the acceptance source.

Owner-provided snapshots describe Plan, Goal and Grub. Decision requests use
unique IDs and are cancelled on disconnection/session change. Only explicitly
delegatable questions are routed remotely. Plan approvals include full content
and reject changes made while awaiting approval; elevated permission choices
remain local. Local operation is unchanged when supervision is inactive.

Bridge operations are bounded, idempotent and asynchronous so a pending question
does not hold an HTTP request open. Reject concurrent commands, stale session/run
targets, reused IDs with different payloads and unsupported commands. Existing
exclusive continuation leases coordinate Goal/Grub; starting another harness
retains their established handoff semantics.

## Acceptance

Cover actual owner snapshots/commands for Grub, Goal and Plan; remote planning
approval/rejection and stale content; AskUserQuestion; busy-state rejection;
uncertain retries; failed commands; pending decision teardown; ordinary message
delivery; live MCP tool discovery and calls. Run all five gates and applicable
runtime/harness regressions. Update PR #22, require CI, then merge as explicitly
authorized. Publishing a new npm release is separate.
