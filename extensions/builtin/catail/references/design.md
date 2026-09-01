# Freeze a Study Design

Use this playbook only after the research direction has passed the Position gate and before data collection or inspection of target outcomes.

## Hard prerequisite

Read `research/POSITION.md`, the search and source registers, candidate claims, and the hypothesis register. Stop without creating a full protocol unless:

- retained sources identify nearest prior work and credible competitors;
- the candidate contribution and its bounded originality are explicit;
- feasibility, fatal flaws, information gain, and null-result value were assessed; and
- `POSITION.md` records `advance` or `pilot-only`.

`search-more`, `reframe`, and `stop` block design. `pilot-only` permits only a protocol explicitly labeled `pilot`, `measurement-validation`, or `feasibility`; it does not justify confirmatory contribution claims.

Create `research/studies/<study-id>/STUDY.md` from the template and assign revision `r1`. Resolve:

- position decision reference and study role (`pilot`, `confirmatory`, `replication`, `exploratory`, or `measurement-validation`);
- question, claim IDs, hypotheses, and estimand or target quantity;
- unit of observation, assignment, replication, and analysis;
- population/system, sampling, conditions, controls, and baselines;
- independent/dependent variables, operationalization, metrics, and units;
- randomization, blocking/stratification, masking, ordering, and batch effects;
- sample-size, precision, or resource rationale;
- inclusion, exclusion, missingness, attrition, and outlier rules;
- primary and secondary analyses, assumptions, effect sizes, uncertainty, and multiplicity;
- stopping, failure, safety, and amendment rules;
- code/data versions, environment, and expected raw outputs.

Repeated measurements on one unit are not independent replication. Match analysis to the true randomization and inference unit.

## Freeze rule

Mark the protocol `frozen` with author and timestamp before target results are inspected. Later changes create a new revision or amendment recording what changed, why, when, by whom, and whether target results were already visible. Never rewrite the earlier revision.

## Acceptance

- A different researcher could determine what to run and what result would support or weaken each claim.
- The study answers the positioned contribution rather than merely testing a convenient implementation.
- Baselines and negative controls address the strongest rival explanations.
- Planned analyses are distinguishable from later exploration.
- Ethics, safety, privacy, or governance blocks are resolved or execution remains blocked.
