# Position a Research Direction

Use this playbook after initial framing, source discovery, and candidate-claim generation, but before a study protocol. Its purpose is to decide whether the direction deserves further research and what kind of contribution it could honestly support. It cannot guarantee acceptance or publication.

## Required inputs

- the originating topic or observation and its provenance limits;
- candidate questions, hypotheses, rivals, and disconfirming outcomes;
- a dated search log and source register containing sources actually inspected;
- intended audience or field, if known;
- realistic resource, data, skill, time, safety, and governance constraints.

If the search is too shallow to identify nearest work or serious competitors, set the decision to `search-more`; do not create a full protocol.

## Positioning workflow

1. Build a state-of-the-art map by theme, claim, method, dataset/system, result direction, and evidence quality. Do not write a sequence of paper summaries.
2. Identify the nearest prior work and compare it directly with the candidate direction: question, construct, mechanism, population/system, data, method, baseline, outcome, and limitations.
3. Look for competition and saturation: direct precedents, recent preprints, negative results, replication attempts, benchmark leakage, adjacent terminology, and fast-moving unpublished work when discoverable.
4. State the proposed contribution type: new phenomenon, mechanism, causal estimate, method, dataset, benchmark, replication, boundary condition, contradiction, synthesis, or negative result. “Applies X to Y” is not sufficient without an information gain.
5. Evaluate publication dimensions separately:
   - significance and relevance to the intended audience;
   - bounded originality relative to the documented search;
   - methodological credibility and whether the question can be answered;
   - feasibility of data, measurement, expertise, compute, time, and approvals;
   - discriminating power against the strongest rivals;
   - value if the result is null, negative, or contradicts the preferred mechanism;
   - reproducibility, artifact availability, and likely reporting standard;
   - venue or audience fit, without predicting acceptance.
6. Run adversarial review. Name fatal flaws, cheap alternative explanations, dependence on a single benchmark or model, construct-validity risks, and ways the result could be technically correct but scientifically uninformative.
7. Record one decision in `POSITION.md`:
   - `advance` — enough evidence and feasibility exist to design a substantive study;
   - `pilot-only` — uncertainty should first be reduced by a labeled pilot or measurement-validation study;
   - `reframe` — the question or contribution must change before more search or design;
   - `search-more` — prior-art coverage is inadequate;
   - `stop` — low information gain, fatal infeasibility, unacceptable risk, or clear saturation makes continuation unjustified.

## Evidence discipline

Every literature-dependent statement in `POSITION.md` must cite source IDs from `literature/source-register.csv`. Separate:

- bibliographic verification;
- what the source actually reports;
- your comparison or inference;
- the still-unverified novelty or contribution judgment.

Record disagreements and low-quality evidence instead of averaging them into apparent consensus. A bounded search supports only a bounded positioning statement.

## Acceptance

The position record names nearest work and serious rivals, explains the information gain over them, exposes feasibility and fatal-flaw risks, values informative null results, and gives a traceable decision. Only `advance` or `pilot-only` may proceed to `design`.
