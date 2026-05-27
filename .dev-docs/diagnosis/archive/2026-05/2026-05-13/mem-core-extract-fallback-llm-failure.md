# Issue: `mem-core.extract:fallback:llm-failure`

```yaml
filed_on: 2026-05-13
classification: REVIEW
source:    mem-core.extract
severity:  warning
category:  fallback
occurrences_today:  3         # bootstrap window, not 24h
sessions_today:     2
versions_today:     []        # version not stamped on these rows
providers:          [minimax-coding]
models:             [MiniMax-M2.7]
first_seen_today:   2026-05-03T07:00:15Z
last_seen_today:    2026-05-03T09:28:26Z
```

## Why this is not auto-fixable

SOP §3.3: same family as `work-llm-failure` — fix surface is the LLM extraction prompt + retry policy in `packages/mem-core/src/extraction.ts`. Prompt-template territory is REVIEW.

## Likely code path(s)

- `packages/mem-core/src/extraction.ts:72` — emission site (note: this is the *first-level* extractor; `:284` is the *structured-work* variant).

## Sample diagnostic (redacted)

```json
{
  "source":   "mem-core.extract",
  "severity": "warning",
  "category": "fallback",
  "message":  "extractWithLLM failed, falling back to heuristic",
  "detail":   { "error": "Error: LLM extraction response must be a JSON array" },
  "occurrence_count": 1
}
```

Distinct from `work-llm-failure` in that the LLM returned *something* but not a JSON array. Suggests partial/preamble text.

## Question for the human

This and `work-llm-failure` together form the same problem: MiniMax-class models don't consistently return raw JSON arrays. Should the extractor be hardened with a **forgiving JSON sniffer** (find the first `[…]` block in the output and parse that), or should we keep the strict parse + heuristic fallback?

## Suggested options

1. **Forgiving sniffer** — preprocess LLM output: regex-extract the first `[` … matching `]` and parse that. Robust to preambles. Adds ~10 lines.
2. **Strict + retry once** — keep strict parse, add a single retry with the system message "Return only valid JSON. No prose. No code fences."
3. **Accept current heuristic** — the fallback already prevents user-visible damage; consider de-noising the diagnostic.
4. **Defer.**

## References

- Daily report: `../2026-05-13.md`
- SOP: `../../daily-issue-sop.md`
- Related: `mem-core-extract-fallback-work-llm-failure.md`
