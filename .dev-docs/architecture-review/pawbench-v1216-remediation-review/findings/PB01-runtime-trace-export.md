# PB01: Runtime Trace Export

```yaml
finding_id: PB01
severity: p0
files_primary:
  - core/runtime/agent-session.ts
  - core/runtime/run-trace-jsonl.ts
status: selected
```

## Problem

Catui already records semantic run traces in memory, including tool request and completion events. The trace is lost at process exit unless an extension consumes it, so non-interactive benchmark harnesses have no stable workspace artifact to inspect.

## Decision

Persist the completed trace from `AgentSession.prompt()` to `<cwd>/.catui/traces/<runId>.jsonl` and refresh `<cwd>/.catui/traces/latest.jsonl` after trace finalization. Runtime owns this because it creates the trace recorder and knows the current workspace.

## Boundary

TokenSave remains under `~/.catui/token-save/projects/<projectKey>/`. Its history is not a canonical transcript and should not be used as the general tool-call source.

