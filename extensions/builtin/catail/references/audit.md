# Audit a CATAIL Workspace

Use this playbook to assess structural completeness and research-quality risks without advancing the workflow automatically.

## Deterministic pass

Run:

```text
node <catail-skill-dir>/scripts/audit.mjs --root . --stage <stage>
```

Use the latest relevant stage. Treat every failure as a missing or inconsistent artifact, not proof that the research itself is wrong. Do not edit artifacts merely to silence the checker.

Use `--stage submission` only when a publication package is the requested endpoint. It additionally requires resolved `VENUE.md` and `SUBMISSION.md` records; this structural pass does not prove venue fit, policy compliance, acceptance readiness, or scientific merit.

## Human-quality pass

Inspect:

- question and scope drift;
- bounded search coverage and novelty overstatement;
- claims stronger than design or evidence;
- protocol revisions made after target-result access;
- pseudoreplication, leakage, weak baselines, missing controls, or ambiguous units;
- unregistered exclusions, retries, analyses, or deviations;
- selective reporting and missing null/negative/failure records;
- effect sizes, uncertainty, multiplicity, and assumption handling;
- figure integrity, accessibility, and source linkage;
- confidentiality, ethics, safety, authorship, policy, and human approval gaps;
- inability to reproduce a run or analysis from recorded code/data/environment identifiers.

## Output

Report findings by severity and stable IDs. For each, include evidence, affected artifact/ID, violated invariant, smallest corrective action, and whether human authority is required. Separate checker failures from expert scientific judgments.

Stop after one audit and one bounded confirmation pass. Do not enter an open-ended self-review loop.
