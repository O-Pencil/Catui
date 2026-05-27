# Issue: `sal.eval:network:http-400-PGRST102`

```yaml
filed_on: 2026-05-13
classification: REVIEW
source:    sal.eval
severity:  error
category:  network
occurrences_today:  1         # bootstrap window, not 24h
sessions_today:     1
versions_today:     [1.13.10]
commit_hash:        027d681
providers:          [dashscope-coding]
models:             [kimi-k2.5]
first_seen_today:   2026-04-29T13:37:51Z
last_seen_today:    2026-04-29T13:37:51Z
```

## Why this is not auto-fixable

SOP §3.3: the only path that emits this fingerprint is `extensions/defaults/sal/eval/insforge-sink.ts` — the **write side of the telemetry tables**. Any change to request encoding, body construction, or error handling here changes the contract between the client and `eval_turns`. REVIEW.

## Likely code path(s)

- `extensions/defaults/sal/eval/insforge-sink.ts` — the SAL→InsForge sink that POSTs `eval_turns` rows. Look for the `POST /api/database/records/eval_turns` site and inspect how the body is serialized.

## Sample diagnostic (redacted)

```json
{
  "source":   "sal.eval",
  "severity": "error",
  "category": "network",
  "message":  "SAL eval upload failed with HTTP 400.",
  "detail":   {
    "method":     "POST",
    "path":       "/api/database/records/eval_turns",
    "statusCode": 400,
    "body":       "{\"code\":\"PGRST102\",\"details\":null,\"hint\":null,\"message\":\"Empty or invalid json\"}",
    "errorCode":  "PGRST102"
  },
  "context":  {
    "adapter":       "insforge",
    "endpoint_host": "intiscu5.us-east.insforge.app",
    "version":       "1.13.10",
    "commit_hash":   "027d681",
    "session_id":    "<redacted>"
  }
}
```

PostgREST `PGRST102` = "Empty or invalid json". Two failure modes match this: (1) the client sent an empty body (race? abort? gzip-without-content-type?), or (2) the client sent something that PostgREST's JSON parser rejects (BOM, leading whitespace, wrong content-type header).

## Question for the human

This is a one-off from version `1.13.10` (current is `1.14.0`); the same sink later emitted a different fingerprint (`network-error`/`socket hang up`) at `1.13.13`. Is `PGRST102` still reachable on current code, or did it get fixed incidentally? If still reachable, should we add a guard that **never POSTs an empty body** at the sink level, and a richer 4xx log that captures the outgoing body length?

## Suggested options

1. **Diagnose only** — add request-side breadcrumbs (body length, content-type) to the diagnostic detail so the next occurrence is debuggable. Low-risk telemetry-side change but still REVIEW (touches the diagnostic schema for this fingerprint).
2. **Defensive empty-body skip** — if the row batch is empty, skip the POST entirely and log info. Avoids the failure mode altogether.
3. **Stale-data acceptance** — single occurrence on an old version, no recent recurrence: close as "fixed-in-tree", track via a non-issue note.
4. **Defer.**

## References

- Daily report: `../2026-05-13.md`
- SOP: `../../daily-issue-sop.md`
- Related: `sal-eval-network-network-error.md`
