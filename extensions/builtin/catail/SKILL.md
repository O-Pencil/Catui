---
name: catail
description: Run evidence-traceable scientific and scholarly workflows from research framing through literature search, claim mapping, study design, experiment records, analysis, visualization, writing, review, and audit. Use when a user is conducting research or producing a paper and needs reproducible provenance, falsifiable hypotheses, protocol discipline, claim-evidence binding, or research-quality review. Do not use for ordinary coding, generic web research, or unsupported requests to manufacture findings.
metadata:
  short-description: Evidence-traceable research workflow
---

# CATAIL

CATAIL turns a research conversation into an auditable project trail. The agent may help search, reason, implement, analyze, and draft, but durable project artifacts—not conversation memory—are the source of truth.

## Non-negotiable boundaries

- Never present a hypothesis, search result, model response, draft, or plausible explanation as evidence.
- Never fabricate citations, identifiers, methods, data, results, approvals, authorship, or provenance.
- An empty or shallow literature search does not establish novelty.
- Keep observation, question, hypothesis, prediction, analysis, evidence, and claim as distinct objects.
- Preserve null, negative, harmful, failed, and inconclusive results alongside positive results.
- Do not rewrite a frozen protocol in place. Create a new revision and record why it changed.
- Distinguish confirmatory, exploratory, and post-hoc analyses in every register and report.
- Keep confidential, unpublished, personal, proprietary, controlled, or security-sensitive material local unless an accountable human explicitly authorizes a named external destination and data scope.
- Stop at applicable ethics, human/animal research, privacy, biosafety, dual-use, legal, publisher, and institutional gates. A script or model cannot approve them.
- Accountable humans own scientific judgment, authorship, submission, and consequential decisions.

## Start of every CATAIL task

1. Inspect the repository for `research/RESEARCH.md`, `research/METHOD.md`, registers, and the relevant study directory. Read only artifacts needed for the current request.
2. Identify the requested command or infer the narrowest matching playbook from the table below. Load exactly that playbook before acting; load `artifact-contracts.md` only when creating or validating artifacts.
3. State the current stage, available evidence, unresolved blocks, and intended artifact change. Do not silently widen the research question.
4. Make one bounded, verifiable advance. Update durable artifacts and report what remains uncertain.

If no `research/` workspace exists, route to `init`. Do not create it during a review-only or advisory request unless the user asked for project files.

## Commands and routing

| Command | Use | Playbook |
|---|---|---|
| `init` | Establish project purpose, ownership, governance, and artifact workspace | [references/init.md](references/init.md) |
| `frame` | Turn a topic or observation into an answerable research question | [references/frame.md](references/frame.md) |
| `search` | Run a bounded, reproducible literature search and record coverage | [references/search.md](references/search.md) |
| `claim` | Maintain candidate claims, rival explanations, predictions, and evidence needs | [references/claim.md](references/claim.md) |
| `design` | Freeze a study or experiment protocol before inspecting target results | [references/design.md](references/design.md) |
| `experiment` | Execute or ingest a run with code, configuration, environment, and output provenance | [references/experiment.md](references/experiment.md) |
| `analyze` | Analyze data against the frozen plan and register deviations | [references/analyze.md](references/analyze.md) |
| `visualize` | Produce truthful, accessible figures with source and transformation records | [references/visualize.md](references/visualize.md) |
| `write` | Draft only from verified claim-evidence bindings | [references/write.md](references/write.md) |
| `review` | Perform an independent, confidential, evidence-bounded review | [references/review.md](references/review.md) |
| `audit` | Run deterministic structural checks and a bounded human-quality audit | [references/audit.md](references/audit.md) |

Routing rules:

- An explicit command wins.
- When two commands fit, choose the earlier dependency: frame before search; search before novelty claims; design before experiment; analyze before write.
- A request to “research X” usually begins with `frame` unless a precise question and scope already exist.
- A request to “find papers” routes to `search`, not a general research loop.
- A request to “prove” a preferred conclusion routes to `claim` and must preserve rival explanations and disconfirming evidence.
- A request to write a paper with unverified evidence routes first to `audit` or `claim`, not `write`.
- A request to review unpublished material must pass the authorization and local-processing gate in `review` before content is inspected.

## Durable workspace

The default project layout is:

```text
research/
├── RESEARCH.md
├── METHOD.md
├── literature/search-log.csv
├── claims/claims.csv
├── studies/<study-id>/STUDY.md
├── runs/<run-id>/manifest.json
├── analysis/analysis-register.csv
├── evidence/claim-evidence.csv
├── figures/
└── manuscript/
```

Use the templates bundled with this skill as shape references; preserve existing project conventions when they already provide equivalent fields. Read [references/artifact-contracts.md](references/artifact-contracts.md) before creating, migrating, or auditing these files.

## Stage gates

| Gate | Must be true before advancing |
|---|---|
| Frame | Question, scope, intended use, accountable owner, and falsification conditions are explicit. |
| Position | Search provenance and coverage gaps exist; novelty is phrased as a bounded candidate claim. |
| Design | Units, variables, controls/baselines, metrics, exclusions, stopping rules, and planned analysis are frozen. |
| Execute | Every run resolves to a study revision, code revision, configuration, environment, raw outputs, and status. |
| Analyze | Planned and unplanned analyses are labeled; assumptions, uncertainty, effect sizes, failures, and deviations are visible. |
| Write | Every factual or numeric central claim resolves to verified evidence; limitations and negative results are included. |
| Review | Confidentiality and authorization are resolved; findings point to claim, method, result, figure, or evidence IDs. |

Gates are fail-closed for missing facts but reversible as workflow state: return to an earlier stage, create a new revision, and preserve the trail. Never mutate history to make a later result appear prespecified.

## Deterministic audit

Run the local structural checker from the user's project root when artifacts were created or changed:

```text
node <catail-skill-dir>/scripts/audit.mjs --root . --stage <frame|search|claim|design|experiment|analyze|write>
```

The audit checks presence, identifiers, headers, revisions, and claim-evidence bindings. It does not establish truth, novelty, validity, ethics approval, reproducibility, or publication readiness. Report its failures as actionable gaps, then perform the human-quality checks in the current playbook.

## Completion contract

Finish a CATAIL action by reporting:

- the artifact paths changed or inspected;
- the claim, study, run, analysis, and evidence IDs affected;
- what was verified and by which source or command;
- what remains missing, uncertain, exploratory, blocked, or human-owned;
- the next smallest action that would reduce the most important uncertainty.

Stop after the requested stage or a bounded confirmation pass. Do not autonomously continue from a research question to a finished paper.
