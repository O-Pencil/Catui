# Issue: {{fingerprint}}

```yaml
filed_on: {{YYYY-MM-DD}}
classification: BLOCK | REVIEW
source:    {{source}}
severity:  {{severity}}
category:  {{category}}
occurrences_today:  0
sessions_today:     0
versions_today:     []
providers:          []
models:             []
first_seen_today:   {{ISO}}
last_seen_today:    {{ISO}}
```

## Why this is not auto-fixable

<!-- Cite the SOP rule that triggered: which §3.2 / §3.3 item. Be specific. -->

## Likely code path(s)

<!-- File paths from §3.1 step A; one per line. Include a 3-5 line snippet only if it clarifies the question being asked. -->

- `path/to/file.ts`

## Sample diagnostic (redacted)

```json
{
  "source": "...",
  "category": "...",
  "message": "...",
  "detail": { }
}
```

## Question for the human

<!-- One sentence, ending with a question mark. Phrase it so a decision is obvious: design choice, schema change, rollback, ignore, etc. -->

## Suggested options

1. ...
2. ...
3. Defer — accept current behavior.

## References

- Daily report: `../{{YYYY-MM-DD}}.md`
- SOP: `../../daily-issue-sop.md`
