# Issue: `mem-core.insights:fallback:non-json-llm-output`

```yaml
filed_on: 2026-05-13
classification: REVIEW
source:    mem-core.insights
severity:  warning
category:  fallback
occurrences_today:  2         # bootstrap window, not 24h
sessions_today:     1
versions_today:     [1.14.0]
providers:          [dashscope-coding]
models:             [qwen3.5-plus]
first_seen_today:   2026-05-10T18:50:27Z
last_seen_today:    2026-05-10T18:50:36Z
```

## Why this is not auto-fixable

SOP §3.3: fix surface is the structured-extraction wrapper in `packages/mem-core/src/extension.ts` and the system prompt it ships. Prompt-template territory → REVIEW.

## Likely code path(s)

- `packages/mem-core/src/extension.ts:465` — fingerprint emitted when `extractStructured` returns non-JSON and the fallback path fires.
- Whatever produces `system_prompt_prefix` shown in the diagnostic ("Like human memory reconsolidation: a stored memory is being recalled in a new co…") — likely a const in `extension.ts` or an adjacent module.

## Sample diagnostic (redacted)

```json
{
  "source":   "mem-core.insights",
  "severity": "warning",
  "category": "fallback",
  "message":  "NanoMem LLM structured extraction returned non-JSON text and used its fallback path.",
  "detail":   {
    "output_prefix":        "Finishing one query or step does not mean the task is over. Only decide `complete` when the overarching goal is actually done. If you need another autonomou…",
    "system_prompt_prefix": "Like human memory reconsolidation: a stored memory is being recalled in a new co…"
  },
  "context":  { "session_id": "<redacted>" },
  "occurrence_count": 2
}
```

The model (qwen3.5-plus) is returning conversational text instead of structured JSON, despite the reconsolidation system prompt. This is the same provider-non-compliance pattern seen in the two `mem-core.extract` tickets — just a different call site.

## Question for the human

This is the third fingerprint in 24h that boils down to "model returned prose where we wanted JSON". Should we (a) consolidate all structured-extraction call sites onto a single hardened helper that handles preambles + retries + fingerprinting, or (b) keep call sites independent and let each evolve its own prompt?

## Suggested options

1. **Consolidate** — extract one `extractJsonOrFallback(prompt, validate, opts)` helper used by `extraction.ts` × 2 call sites and `extension.ts` × 1. Single place to harden. Bigger change; needs review of the call sites' specific schemas.
2. **Per-site tightening** — narrow change in `extension.ts` only: strip code fences, retry once with stricter wording.
3. **Provider-aware prompt** — append `Output JSON only. No prose. No markdown.` for providers known to drift.
4. **Defer.**

## References

- Daily report: `../2026-05-13.md`
- SOP: `../../daily-issue-sop.md`
- Related: `mem-core-extract-fallback-llm-failure.md`, `mem-core-extract-fallback-work-llm-failure.md`
