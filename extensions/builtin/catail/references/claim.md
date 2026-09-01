# Claim and Evidence Planning

Use this playbook to maintain candidate contributions, hypotheses, predictions, rival explanations, and evidence needs.

## Claim lifecycle

Use stable claim IDs and one of these states:

- `candidate`: proposed, not yet supported;
- `planned`: falsifiable test and evidence need are specified;
- `supported`: current verified evidence is directionally consistent, with limitations;
- `mixed`: verified evidence conflicts or varies by condition;
- `unsupported`: the planned evidence did not support it;
- `inconclusive`: available evidence cannot discriminate the claim from rivals;
- `withdrawn`: no longer advanced, with reason retained.

Never use `proven` or `true` as a workflow state.

For every candidate central claim, record:

- precise statement, scope, population/system, outcome, and direction;
- claim type: descriptive, associational, causal, mechanistic, predictive, methodological, or generalization;
- rival explanations and disconfirming observations;
- prespecified prediction and required evidence type;
- relevant source IDs and evidence IDs, if verified;
- analysis class: confirmatory, exploratory, post-hoc, or not-yet-analyzed;
- owner and verification date.

Update `research/claims/claims.csv` and the relevant section of `RESEARCH.md`. Bind evidence only through `claim-evidence.csv`; do not hide evidence IDs inside prose.

Maintain candidate hypotheses and rivals as separate rows in `research/claims/hypothesis-register.csv`. Do not compress all rivals into one prose cell when they predict different results. Record whether each candidate is human-originated, AI-assisted, literature-inspired, or result-derived; a result-derived hypothesis is exploratory until tested on new target data under a new frozen protocol.

## Audit questions

- Does each claim say less than or equal to what its design and evidence can support?
- Are effect magnitude, uncertainty, population, timepoint, and comparison aligned?
- Could the same result follow from a listed rival explanation?
- Are negative or contradictory results represented?

End by naming the claim with the greatest decision impact and the least adequate evidence.
