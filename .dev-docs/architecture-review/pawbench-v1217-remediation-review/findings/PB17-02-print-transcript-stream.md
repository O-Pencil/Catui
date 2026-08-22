# PB17-02 Print Transcript Stream

## Phenomenon

PawBench v1.2.17 still extracts zero tool calls because it reads `<workspace>/.catui/token-save/history.jsonl`. Catui v1.2.17 writes semantic traces to `.catui/traces/latest.jsonl`, but the benchmark harness did not consume that new path.

## Essence

File discovery is a brittle transcript boundary. Print-mode benchmark runs already consume stdout/stderr, so transcript evidence should be emitted as a stable NDJSON stream instead of requiring a workspace side file.

## Decision

Add a print-mode transcript stream that emits one JSON object per event:

- `tool_use`
- `tool_result`
- `assistant_text`
- `result`

This stream belongs to `modes/print` and consumes runtime/session events. It must not depend on TokenSave or private session storage.

## Verification

- Parse args recognizes the new transcript stream option.
- Print-mode tests assert tool-use/tool-result/result lines are emitted in text mode.
- Existing text and JSON mode behavior remains unchanged when the option is absent.
