# PawBench Trace Input Review

```yaml
review_id: pawbench-trace-input-review
source_report: /Users/cunyu666/Dev/PawBench/catui_v1219_tracking_report.md
scope:
  - include benchmark-readable tool inputs in semantic run traces
status: accepted
created_at: 2026-08-23
```

## Purpose

PawBench v1.2.19 can discover `.catui/traces/latest.jsonl` and extract tool names, but it cannot score tool correctness because `tool.requested` records only `inputFingerprint`. The trace already observes tool arguments at the loop boundary, so the loss happens inside Catui's trace projection.

## Decision

Record the original tool-call input on new `tool.requested` events while keeping `inputFingerprint` for compatibility and deduplication. Historical traces that only contain the fingerprint remain valid.

## Non-Goals

- Do not recreate TokenSave history storage.
- Do not require PawBench to parse private session internals.
- Do not remove `--print-transcript`.
- Do not move the trace contract into `packages/protocol`; this remains host-internal agent-core/runtime evidence.

## Acceptance

- `tool.requested` events emitted by agent loops include `payload.input`.
- Existing traces without `payload.input` still parse and replay.
- Workspace JSONL persistence round trips the clear input.
- The change remains local to `core/lib/agent-core` trace projection and runtime persistence consumers.
