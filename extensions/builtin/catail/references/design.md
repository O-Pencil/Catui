# Freeze a Study Design

Use this playbook before data collection or before inspecting target benchmark results.

Create `research/studies/<study-id>/STUDY.md` from the template and assign revision `r1`. Resolve:

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
- Baselines and negative controls address the strongest rival explanations.
- Planned analyses are distinguishable from later exploration.
- Ethics, safety, privacy, or governance blocks are resolved or execution remains blocked.
