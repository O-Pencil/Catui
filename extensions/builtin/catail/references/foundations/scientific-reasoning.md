# Scientific Reasoning and Language

Read this reference when CATAIL must classify knowledge objects, update a claim after evidence, distinguish negative outcomes, or translate scientific content across languages.

## Objects are not interchangeable

| Object | Meaning | Minimum record |
|---|---|---|
| Observation | What was reported, measured, or noticed | source, unit, system/population, time, measurement, missingness, uncertainty |
| Question | A bounded unknown worth resolving | scope, intended use, answerability, competing possibilities |
| Hypothesis | A candidate explanation or prediction | origin, mechanism, scope, rival, discriminating prediction, disconfirming and indeterminate outcomes |
| Evidence | An inspected observation relevant to a claim | provenance, quality, direction, scope, uncertainty, limitations, verification state |
| Claim | A scoped proposition the researcher may defend | type, statement, population/system, comparison, outcome, direction, evidence and rivals |
| Conclusion | A provisional judgment under current evidence | claim, state, rationale, boundary, unresolved alternatives, next update condition |

An observation becomes evidence only after its provenance, quality, relevance, and inferential role are assessed. A source reporting a claim is evidence that the source made that report; it is not automatically evidence that the claim is correct.

## Epistemic state transitions

Use object-appropriate transitions rather than a universal “true/false” flag:

```text
unknown
  -> candidate
  -> testable / assessable
  -> under investigation
  -> supported | contradicted | mixed | inconclusive | method-failure
  -> replicated | revised | refuted | withdrawn | superseded
```

Do not use `proven` or `true` as routine states. “Supported” always means supported by named evidence within a declared scope and limitations.

Every material transition records:

- prior and new state;
- evidence or source identifiers;
- applicable system, population, comparison, outcome, and time;
- strength and uncertainty;
- contradictory evidence and rival explanations;
- the observation that would change the state again.

Writing, repetition, citation count, or reviewer agreement does not by itself strengthen an epistemic state.

## Distinguish negative outcomes

| Outcome | Interpretation |
|---|---|
| No evidence located | Search or evidence is absent; the claim is not thereby false |
| Non-significant difference | The analysis did not reject the tested null; it is not automatically evidence of no meaningful effect |
| Informative equivalence or bound | An adequately designed equivalence, non-inferiority, or interval-based analysis may support the absence of a meaningful effect within its margin |
| Method failure | Execution, measurement, validity, leakage, or analysis failure prevented the intended inference |
| Contradictory evidence | Credible evidence points against the claim within its scope |
| Mixed evidence | Credible results differ by measure, condition, source, or study |
| Inconclusive evidence | Available evidence cannot discriminate the claim from rivals |

Do not protect a preferred hypothesis by labeling every unfavorable result “inconclusive.” Use design sensitivity, measurement validity, uncertainty, and prespecified meaningful bounds to decide whether evidence is informative.

## Source and evidence quality

Useful source states include:

```text
located -> metadata-checked -> abstract-screened -> full-text-inspected
        -> quality-assessed -> admissible | limited | invalid
```

Record retractions, corrections, publication status, access limits, duplicate cohorts, conflicts, and whether the central proposition was verified in the original source. Search snippets and generated summaries remain discovery aids.

## Language scopes

Manage four independent language scopes:

- **dialogue language:** alignment, explanations, questions, and feedback;
- **artifact language:** paper, abstract, report, review, protocol, or other deliverable;
- **source language:** official title, terminology, instrument, identifier, and direct quotation;
- **terminology language:** stable glossary used across the project and bilingual mappings where needed.

Language precedence is:

1. explicit instruction scoped to the current task or artifact;
2. declared session preference;
3. current prompt's main language;
4. project default.

Do not expand the scope of a language instruction. “Write the paper in English” does not require English discussion. “Explain in Chinese” does not authorize translating official source titles or quotations as though the translation were original.

## Preserve epistemic force across languages

Translation and editing must not strengthen or weaken a scientific claim:

| Intended force | Suitable English |
|---|---|
| 暂时支持 | provisionally supports |
| 与该假设一致 | is consistent with the hypothesis |
| 证据有限 | the evidence remains limited |
| 结果无法确定 | the results are inconclusive |
| 未排除替代解释 | alternative explanations cannot be ruled out |
| 在指定条件下 | under the specified conditions |
| 尚未得到独立复现 | has not yet been independently replicated |

Never translate “暂时支持” as “proves,” non-significance as “there is no effect,” association as causation, or a possible mechanism as the mechanism. Maintain a project glossary when a construct, variable, or method has more than one plausible translation.

## Reasoning output

When the distinction matters, make the chain visible:

```text
Observation -> quality and provenance -> evidential role
            -> candidate explanations and rivals
            -> bounded claim -> provisional conclusion
```

State what remains human judgment, but do not front-load ownership, authorship, or submission decisions before the scientific question and contribution have been positioned unless authorization or safety requires it.
