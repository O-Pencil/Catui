# Goal and Grub Lifecycle Repair

status: implemented; local acceptance complete, remote CI required before merge
owner: extensions/builtin/goal/ and extensions/builtin/grub/

## Scope and placement

Repair all seven reproduced lifecycle defects: global follow-up deletion, Grub
abort restart, idle Goal resume, suppressed budget steering, duplicate/unowned
Grub dispatch, inaccessible stopped tasks, and inconsistent continuation limits.
Both extensions retain their product policy. Shared host changes are limited to
predicate-scoped queue cancellation and an exclusive continuation lease consumed
by both extensions. Contracts stay in extensions-host, not catui-protocol; there
is no cross-publish consumer and no cross-extension import.

## Decisions

- Existing no-argument clearFollowUpQueue remains compatible; a predicate removes
  matching messages only and updates both engine queue and UI mirror.
- User start/resume claims a session-local continuation lease. A new claim revokes
  the previous driver synchronously; revocation pauses its durable work and
  cancels only its own pending prompts. Automatic ticks never steal a lease.
- Busy commands wait for idle instead of placing another autonomous prompt into
  an unrelated run. A dispatched Grub iteration is matched to its actual prompt;
  unrelated results and stale end events do not advance it.
- Abort pauses automatic work. Explicit resume is idempotent and renews a bounded
  execution allowance while retaining total cost, task identity and checklist.
- Goal counts autonomous runs separately from assistant/tool cycles. Budget notices
  are acknowledged when built for delivery, not while detecting the crossing.
- Existing completion evidence policy is retained; this change does not claim an
  independent verifier for arbitrary user objectives.

## Acceptance

Regression tests must cover all seven findings, both extensions sharing one host,
busy start/resume, cancellation with unrelated queued messages, abort, duplicate
resume, multi-cycle goal runs, budget crossing, persisted failed/stopped recovery,
and session boundaries. Run existing goal/Grub tests, critical harness, both loop
tests, five repository gates and dist boundary. Submit through PR and remote CI.
No dependencies or settings are added. Dispatch arbitration reduces accidental
model calls; explicit resume may renew existing bounded work.
