# Issue: `mem-core.extract:fallback:work-llm-failure`

```yaml
filed_on: 2026-05-13
classification: REVIEW
source:    mem-core.extract
severity:  warning
category:  fallback
occurrences_today:  7         # bootstrap window, not 24h
sessions_today:     4
versions_today:     [1.14.0]
providers:          [custom-anthropic, minimax-coding]
models:             [mimo-v2.5-pro, MiniMax-M2.7]
first_seen_today:   2026-05-03T12:20:40Z
last_seen_today:    2026-05-11T13:29:11Z
```

## Why this is not auto-fixable

SOP §3.3: any change here would land in **`packages/mem-core/src/extraction.ts`** and almost certainly modify either (a) the prompt asking the LLM to return JSON, or (b) the retry policy that decides when to give up. Prompts shipped to the model and retry policy both fall under "prompt templates" and adjacent stability contracts, so this is REVIEW even though `packages/mem-core/` is not in the §3.2 hard core boundary.

## Likely code path(s)

- `packages/mem-core/src/extraction.ts:284` — emission site for `work-llm-failure`.
- `packages/mem-core/src/extraction.ts:72` — sibling fingerprint `llm-failure`, same retry/fallback mechanism.
- Whatever prompt template feeds the structured-JSON extractor (search inside `extraction.ts` and around the call site).

## Sample diagnostic (redacted)

```json
{
  "source":   "mem-core.extract",
  "severity": "warning",
  "category": "fallback",
  "message":  "NanoMem structured work extraction fell back after repeated invalid JSON output.",
  "detail":   {
    "error": "StructuredJsonFailure: LLM did not return parseable JSON for a structured memory task; first_output_prefix=\"\""
  },
  "occurrence_count": 1
}
```

Observation: `first_output_prefix` is empty — i.e., the LLM returned literally nothing parseable, not just malformed JSON. Most occurrences came from `MiniMax-M2.7`; some from `mimo-v2.5-pro`. Both are non-Anthropic providers.

## Question for the human

The model is returning empty content where JSON is required — should we (a) tighten the prompt with a clear "respond with `[]` if there is nothing" instruction, (b) raise retries before falling back, (c) accept the heuristic fallback as good enough and lower the diagnostic to `info`, or (d) provider-gate the LLM extractor so MiniMax-class models route to the heuristic path immediately?

## Suggested options

1. **(a) Prompt tightening** — add `If there is nothing to extract, respond with []` to the structured extraction prompt. Smallest change, may not help if the model is empty-streaming due to a refusal.
2. **(b) Retry++** — bump the parseable-JSON retry budget from N to N+1; cheap insurance.
3. **(c) Re-classify as info** — the heuristic fallback is functional; the warning is noisy. Risk: hides regressions if the LLM extractor degrades further.
4. **(d) Provider gating** — skip LLM extraction for providers/models on a known-flaky list. Largest change; needs a config knob.
5. **Defer** — accept current behavior; revisit if occurrences > 20/24h.

## References

- Daily report: `../2026-05-13.md`
- SOP: `../../daily-issue-sop.md`
- Related: `mem-core-extract-fallback-llm-failure.md`, `mem-core-insights-fallback-non-json-llm-output.md`
