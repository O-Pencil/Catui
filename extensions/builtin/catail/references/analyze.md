# Analyze Research Results

Use this playbook after valid run artifacts exist.

## Workflow

1. Read the frozen study revision and planned analysis before inspecting target results.
2. Register each analysis in `research/analysis/analysis-register.csv` as `confirmatory`, `exploratory`, or `post-hoc` before interpreting it.
3. Validate units, denominators, missingness, exclusions, independence, repeated measures, data leakage, and run eligibility.
4. Report descriptives and raw-data views before inferential summaries.
5. Check model/test assumptions. Record deviations from the plan and why the alternative was used.
6. Report effect sizes or target estimates with uncertainty, not p-values or point accuracy alone. Address multiplicity where applicable.
7. Run robustness, sensitivity, subgroup, or ablation analyses only when justified and label their status honestly.
8. Bind result artifacts to claim IDs through the evidence register; include null, negative, failed, and contradictory results.
9. Classify each affected claim as supported, mixed, unsupported, inconclusive, or withdrawn within its declared scope. Diagnose method failure separately from scientific refutation.

Do not interpret non-significance as equivalence, association as causation, predictive accuracy as mechanism, or post-hoc fit as confirmation. Do not calculate “observed power” from the observed effect; use precision or sensitivity analysis instead.

## Reproducibility

Preserve analysis code, environment, input run IDs, transformations, exclusions, seeds, outputs, and logs. Prefer a rerunnable script or notebook with a clean execution record over hand-calculated prose.

Finish with supported, mixed, unsupported, inconclusive, withdrawn, and method-failed outcomes separately. Route any follow-up hypothesis, redesign, replication, or stop decision through `iterate`; do not silently launch another run.
