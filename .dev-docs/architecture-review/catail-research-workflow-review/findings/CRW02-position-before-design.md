# CRW02 — Position before design

## Evidence

A real invocation asked CATAIL to initialize a project about long-term memory in coding agents and “complete problem definition and study design.” The generated workspace created detailed claims and a study contract while `literature/search-log.csv` remained empty and no retained-source register or nearest-work comparison existed. The response then prioritized owner, effect size, model configuration, and benchmark parameters.

## Cause

V1 documented “search before novelty” but did not encode it as a cumulative dependency. `frame` and `design` could be selected together, the design audit checked only study shape and freeze status, and claim `source_ids` referred to no durable source registry. The workflow therefore rewarded protocol completeness before topic validity.

## Decision

- Add a source-level literature register distinct from the query log.
- Add a `POSITION.md` gate for state of the art, nearest work, competition, contribution, feasibility, null-result value, fatal flaws, and a bounded decision.
- Allow design only after `advance` or `pilot-only`; restrict `pilot-only` to pilot, feasibility, or measurement-validation roles.
- Add a hypothesis register to keep observations, hypotheses, rivals, predictions, and evidence distinct.
- Add an iteration register and playbook so refutation, mixed evidence, inconclusive results, and method failure cannot become silent reruns or rewritten hypotheses.
- Keep ownership unresolved during early positioning when it is not a safety or authorization blocker; require it before design freeze.

## Acceptance

The demonstrated unpositioned-design workspace fails the design audit. A complete positioned fixture passes. A confirmatory protocol under `pilot-only` fails. Prompt overhead remains bounded and no new runtime, network, public API, or cross-extension dependency is introduced.
