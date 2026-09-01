# Frame the Research Question

Use this playbook to turn a topic, observation, or product idea into candidate research directions without prematurely selecting a design.

## Workflow

1. Classify the origin as a broad topic, empirical observation, prior claim, practical problem, theoretical tension, replication need, or method opportunity. Do not invent an observation for a topic-only request.
2. If an observation exists, freeze it before interpretation: source, unit, population/system, time, missingness, preprocessing, uncertainty, and whether it was expected or noticed after inspection. If none exists, write `not_applicable — topic-led` under observation provenance.
3. Generate an initial set of candidate questions independently of literature examples where practical, and record their origin as human, AI-assisted, literature-inspired, or mixed. This is divergence, not selection.
4. For each promising question, separate candidate hypothesis, mechanism, prediction, rival explanation, null/indeterminate outcome, and required evidence.
5. Define what result would weaken each candidate and what would still be learned from a null result.
6. Record coarse feasibility constraints, affected stakeholders, and required safety or institutional gates. Do not make owner, authorship, exact sample size, compute budget, or model version the main decision unless they currently block safety or basic feasibility.
7. Update `RESEARCH.md` and `claims/hypothesis-register.csv`; create claim rows only for actual candidate claims, with status `candidate` and no invented evidence or source IDs.

Prefer causal language only when the design, intervention/allocation, and estimand support it. Otherwise use descriptive, associational, or predictive language.

## Quality checks

- The question is narrow enough to answer with available units, data, and time.
- Hypotheses make different observable predictions rather than restating the same preference.
- Topic, observation, hypothesis, prediction, and evidence are visibly distinct.
- Success and stopping criteria are not defined solely by statistical significance.
- The user can explain what result would change their mind.

At this stage the primary question may remain a candidate. Finish with the strongest candidate questions, their provenance and rivals, the most important unresolved assumption, and the search needed to position them. Do not proceed directly to `design`.
