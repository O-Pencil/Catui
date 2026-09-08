# Acceptance

status: implemented

All seven reproduced defects are repaired. Goal cancels only its own follow-ups,
resumes automatically and idempotently, delivers the budget notice once, counts
runs rather than tool cycles, and renews continuation limits on explicit resume.
Grub identifies each dispatched run, stops on abort, resumes unfinished persisted
tasks with renewed allowance, and retains usage from its own interrupted run.
Stopping a task waiting for idle does not abort an unrelated user run.
Goal shutdown and terminal-report guards are host-local so closing one SDK
session cannot cancel another session's queued continuation.

Host changes are generic: a session-local continuation lease and optional pure
text predicates for follow-up cancellation. Existing no-argument cancellation
remains compatible. No public protocol package, dependency or configuration
changes are needed. Product policy remains in the two extensions, which have
no imports from one another. Prompt identity tags add a small fixed number of
tokens per automatic run; preventing duplicate dispatch removes accidental calls.

Validation includes lifecycle integration tests in the critical harness,
existing Goal/Grub controller tests, and actual Agent queue consumption in both
standard and weak-model-compatible loops. Five repository gates and the dist
package boundary pass. DIP was run on a clean source snapshot because the local
workspace contains an unrelated `.tmp/qwen-code-src` checkout that the checker
recurses into. Remote CI must validate the committed snapshot before merge.

Existing completion authority is unchanged: Goal completion is model-reported;
Grub validates its feature-list contract, not independent execution evidence.
This repair does not claim to solve arbitrary objective verification.

Reopen if cancellation removes unrelated messages, abort schedules a new run,
resume duplicates work or fails to restart it, or a foreign run advances a task.
