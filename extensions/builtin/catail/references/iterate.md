# Update or Iterate After Evidence

Use this playbook after analysis when evidence supports, weakens, refutes, complicates, or fails to resolve a claim. Iteration is scientific updating, not repeated testing until a preferred result appears.

## Diagnose before acting

Classify the outcome and record the evidence IDs:

- `supported` — evidence is directionally consistent within its declared scope and limitations;
- `mixed` — credible evidence differs by measure, condition, study, or source;
- `unsupported` — the prespecified result contradicts or fails to support the claim under an informative design;
- `inconclusive` — precision, measurement, execution, or coverage is insufficient to discriminate candidates;
- `method-failure` — protocol execution, validity, leakage, instrumentation, or analysis failure prevents the intended inference;
- `withdrawn` — the claim is no longer advanced, with the reason preserved.

Do not call every null result inconclusive. Use precision, validity, sensitivity, and the prespecified smallest meaningful effect to distinguish an informative refutation from insufficient information.

## Choose the next branch

- If supported: seek robustness, boundary tests, or independent replication before broad generalization; writing remains bounded to current evidence.
- If mixed: identify the moderator or boundary-condition hypothesis and label it exploratory until independently tested.
- If unsupported: update or withdraw the claim, retain the negative result, revisit rivals, and run a new study only when it offers new information.
- If inconclusive: diagnose which uncertainty dominates; improve measurement, sampling, or design rather than repeating unchanged runs.
- If method failure: repair the method, create a new protocol revision or study, and keep failed runs visible. Do not relabel repaired analyses as prespecified for data already inspected.
- If a new result suggests a new hypothesis: register its origin as result-derived and exploratory. It becomes confirmatory only under a new frozen protocol and new target data.
- If the contribution is no longer novel or feasible: return to `position` and choose `reframe`, `search-more`, or `stop`.

Append the decision to `research/iterations/iteration-log.csv`. Link prior claim status, diagnosis, decision, new question or hypothesis, new study/revision, analysis class, and next evidence needed. New executions receive new run IDs; raw results and prior protocols are immutable.

## Acceptance

The claim register reflects the evidence, negative and failed outcomes remain visible, the next action reduces a named uncertainty, and no later hypothesis or analysis is misrepresented as prespecified.
