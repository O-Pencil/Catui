# Issue: `sal.eval:network:network-error`

```yaml
filed_on: 2026-05-13
classification: REVIEW
source:    sal.eval
severity:  error
category:  network
occurrences_today:  2         # bootstrap window, not 24h
sessions_today:     1
versions_today:     [1.13.13]
commit_hash:        9c2e846
providers:          [minimax-coding]
models:             [MiniMax-M2.7]
first_seen_today:   2026-05-03T13:18:40Z
last_seen_today:    2026-05-03T13:18:40Z
```

## Why this is not auto-fixable

SOP §3.3: emitted from `extensions/defaults/sal/eval/insforge-sink.ts` — same telemetry write side as `http-400-PGRST102`. Any retry/backoff/timeout change here alters the network contract between the SAL adapter and the InsForge backend. REVIEW.

## Likely code path(s)

- `extensions/defaults/sal/eval/insforge-sink.ts` — search for `network-error` and the wrapping try/catch around the POST.
- Sibling fingerprint family: timeouts and socket-hang-up failures appear adjacent in the same buffer.

## Sample diagnostic (redacted)

```json
{
  "source":   "sal.eval",
  "severity": "error",
  "category": "network",
  "message":  "SAL eval upload is failing due to a network connection error.",
  "detail":   {
    "host":  "intiscu5.us-east.insforge.app",
    "error": "socket hang up"
  },
  "context":  {
    "adapter":       "insforge",
    "endpoint_host": "intiscu5.us-east.insforge.app",
    "version":       "1.13.13",
    "commit_hash":   "9c2e846",
    "session_id":    "<redacted>"
  }
}
```

A second buffered diagnostic in the same payload reports `SAL eval upload timed out.` — both failure modes from the same session. Pattern: the InsForge endpoint (or the path between client and endpoint) drops connections under sustained POST load.

## Question for the human

This is upstream-side flakiness, not a code defect per se. Should we (a) add exponential backoff + jitter for transient transport errors before surfacing as `error`, (b) downgrade the severity once a retry succeeds (only emit `error` when the *batch* fails after retries), or (c) treat this as expected upstream noise and leave alone?

## Suggested options

1. **(a) Retry + backoff** — wrap the POST with N retries on `ECONNRESET`/`socket hang up`/timeout, exponential 1s/2s/4s. Only emit the diagnostic when *all* retries fail. Medium change; affects the network contract semantically.
2. **(b) Severity ladder** — single failure = `info`, repeated within window = `warning`, full-batch-loss = `error`. Same retry mechanism, different surface.
3. **(c) Accept upstream noise** — keep current behavior; revisit if rate climbs.
4. **Defer.**

## References

- Daily report: `../2026-05-13.md`
- SOP: `../../daily-issue-sop.md`
- Related: `sal-eval-network-http-400-pgrst102.md`
