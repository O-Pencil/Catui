# Source Learning Quality Review

status: implementing
owner: extensions/optional/evolution/source/

## Intent and placement

Improve the four observed weaknesses of source evolution: shallow failure mining,
correlated model review, noisy adoption labels, and blanket exclusion of learning
methods. This is extension-owned behavior, not a core/runtime or public protocol
change. Existing benchmark reports validate imported paired task evidence; live
unpaired usage must not be relabeled as that stronger experiment.

## Decisions

1. Capture bounded final-answer summaries and immutable task category/input-size
   cohorts. A budgeted retrospective audits successful and failed completed runs.
   Its findings must cite actual observation IDs across distinct runs. Successful
   audit results provide denominators; absence of an audit is not success.
2. Require a distinct configured reviewer model. It writes hidden generalization
   and compatibility tests in a separate baseline checkout before repair. The
   repair worker never reads those tests. Baseline must fail generalization and
   pass compatibility; the candidate must pass both. Acceptance workers always
   run the trusted bootstrap, while adopted code supplies repair workers.
3. Measure distinct completed runs with matched task/model/workspace cohorts.
   Freeze the baseline, use fixed increasing sample windows, and conservative
   interval bounds instead of repeated raw-rate comparisons. Report token and
   latency changes separately and retain an inconclusive outcome. Usage evidence
   remains observational, never a causal or model-intelligence claim.
4. Add an explicit adaptive scope for pure task detectors and repair strategy.
   These methods can improve through the same hidden tests and independent review.
   Permission, evidence sanitation, budgets, statistical acceptance, GitHub,
   publication, dependency and migration authority remain outside generated edits.

## Acceptance

Test hidden-case overfitting, compatibility regression, same-model refusal,
unreferenced audit claims, successful-run audits, task-cohort mismatch, correlated
tool-event inflation, insufficient evidence, fixed-window decisions and scoped
strategy edits. Preserve all five repository gates and native sandbox checks.
Existing user configuration remains readable; missing independent review identity
is surfaced before launching repair rather than silently falling back.
