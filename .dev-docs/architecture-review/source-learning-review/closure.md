# Source Learning Acceptance

status: implemented; final rebased validation and CI pending

Implemented protected independent model selection, daily cited quality audits,
private baseline-failing generalization and baseline-passing compatibility tests,
fixed-window completed-run measurements, and explicit adaptive method scope.

Local acceptance: DIP, quality, package boundary, build and type checks passed
before rebasing onto the goal/grub lifecycle fix. Real Git and native macOS
verification accepted a general repair and rejected both an overfit repair and
an adjacent-behavior regression. A read-only Ali Coding Plan Qwen 3.7 Plus probe
completed successfully. Final CI receipts belong to the PR.

Public SDK exports and dependencies are unchanged. Daily model cost increases by
one audit invocation and one hidden-test invocation per repair, within the same
eight-call daily budget. Statistical monitoring remains observational and may
remain inconclusive indefinitely when matched samples are unavailable.

Dependency/schema self-modification is not enabled by adaptive scope; it still
requires a separate compatibility contract. Reopen on provider alias ambiguity,
audit calibration failures, hidden-test leakage, or mismatched cohort drift.
