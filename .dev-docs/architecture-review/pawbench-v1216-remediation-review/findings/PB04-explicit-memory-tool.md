# PB04: Explicit Memory Tool

```yaml
finding_id: PB04
severity: p2
files_primary:
  - packages/mem-core/src/engine.ts
  - packages/mem-core/src/extension.ts
status: selected
```

## Problem

NanoMem automatically extracts preferences at turn end, but benchmark transcript scoring expects memory/persistence to be visible as a tool call when the user explicitly says to remember a preference. Automatic lifecycle extraction is correct product behavior, but it is not a traceable model action.

## Decision

Add `nanomem_remember` as a narrow extension tool owned by `catui-mem`. The tool accepts explicit memory type, summary, and detail, then writes through `NanoMemEngine.remember()` so the same dedupe/update and V2 semantic paths are used.

## Boundary

This does not replace automatic extraction. It gives the model an explicit action for direct user memory requests and lets runtime run traces show that action.
