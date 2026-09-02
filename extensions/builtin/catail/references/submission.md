# Submission Package and Human Gate

Use this playbook only when the requested endpoint includes submission readiness. It prepares and verifies a package; it does not perform the external submission action.

## Preconditions

Require an accountable submitter, resolved venue decision, current official instructions, versioned manuscript, bounded claim-evidence record, final figures and tables, method and analysis records, authorship decisions, and known artifact/declaration requirements. Missing inputs remain explicit blockers.

For durable work, create or update `research/SUBMISSION.md` from the template and run:

```text
node <catail-skill-dir>/scripts/audit.mjs --root . --stage submission
```

The audit checks structure only. It cannot establish scientific merit, venue fit, policy compliance, correct rendering, or acceptance readiness.

## Scientific preflight

- Trace every central factual and numeric manuscript claim to verified evidence.
- Reconcile title, abstract, contribution list, methods, results, limitations, figures, tables, supplement, and availability statements.
- Preserve null, negative, contradictory, adverse, failed, and inconclusive outcomes.
- Verify that causal, novelty, generalization, and reproducibility language does not exceed the design or evidence.
- Separate confirmatory, exploratory, and post-hoc analyses and disclose material deviations.

## Venue and policy preflight

- Reverify the edition, track, deadline and timezone, template, page and file limits, anonymity model, dual-submission policy, prior-publication policy, artifact rules, ethics, conflicts, funding, author changes, AI/tool-use disclosure, and required forms from official sources.
- Record source URLs and access dates. Do not rely on cached instructions or a previous edition.
- Resolve differences between a generic template, track-specific page, submission-system fields, and publisher instructions with the accountable submitter.

## Artifact and rendering preflight

- Build the exact manuscript and supplement intended for submission from a clean environment.
- Inspect the rendered output page by page for clipping, overflow, missing fonts, broken equations, low-resolution figures, inaccessible color use, incorrect references, metadata leaks, and anonymity failures.
- Verify archives can be opened and contain only intended files; remove secrets, local paths, hidden identities, temporary data, and unrelated outputs.
- Check that code, data, model, environment, license, and reproducibility statements match what will actually be released or withheld.

## Human approval gate

The accountable human must confirm authorship and order, affiliations, conflicts, funding, ethics, disclosures, final artifact hashes or versions, target track, and external submission authority. Record approval and the approved package revision in `SUBMISSION.md`.

Stop with status `ready-for-human-submission`, `blocked`, `hold`, or `withdrawn`. Never click submit, upload to an external venue, accept legal terms, or represent author approval without explicit human action and authority.
