# PB02: Print Trace Surface

```yaml
finding_id: PB02
severity: p0
files_primary:
  - modes/print-mode.ts
  - cli/args.ts
status: selected
```

## Problem

PawBench runs Catui non-interactively. Even after workspace traces exist, the harness needs a discoverable reference without reverse-engineering Catui internals.

## Decision

Extend the existing `--print-loop-result` JSON line with the latest trace path when available. This preserves the existing text stdout contract and adds structured metadata to stderr where loop metadata already lives.

## Boundary

Do not emit full traces to stdout by default. Full trace content stays in JSONL files so large tool outputs and future trace versions do not destabilize print output.

