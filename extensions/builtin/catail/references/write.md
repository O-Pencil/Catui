# Evidence-Bound Scientific Writing

Use this playbook only when the relevant claim-evidence bindings are available.

## Intake

Resolve document type, audience, target venue and current instructions, study design, reporting guidance, scope, verified source manifest, methods, results, figures/tables, authorship and declarations, confidentiality, and data/code availability.

## Drafting rules

- Draft from claim IDs and verified evidence records, not memory or search snippets.
- Every factual or numeric central statement must resolve to evidence whose direction, magnitude, population/system, outcome, comparison, timepoint, and uncertainty align.
- Keep methods consistent with the frozen protocol and amendments; keep results consistent with registered analyses and figures.
- Preserve confirmatory, exploratory, and post-hoc labels.
- Include negative, null, adverse, failed, unexpected, and inconclusive results when part of the study record.
- State concrete limitations, rival explanations, and bounds on generalization.
- Mark missing or unverified fields explicitly. Never fill plausible citations, numbers, approvals, software versions, author roles, funding, conflicts, or availability statements.

Separate drafting, evidence verification, and final human approval. AI-generated fluency is not evidence and does not confer authorship.

## Consistency pass

Reconcile claim IDs, citations, sample sizes, denominators, units, labels, timepoints, table/figure references, method/result choices, and declarations. Run `audit.mjs --stage write`, then inspect every remaining gap manually.

Finish by listing passages that remain unverified or require accountable author judgment.
