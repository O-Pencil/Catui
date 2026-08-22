# PawBench v1.2.16 Remediation Review

```yaml
review_id: pawbench-v1216-remediation-review
source_report: /Users/cunyu666/Dev/PawBench/catui_v1216_issues_report.md
scope:
  - core/runtime run trace persistence
  - modes/print benchmark-facing trace output
  - extensions/builtin/security-audit skill installation gate
  - packages/mem-core explicit remember tool
  - browser extension benchmark opt-in
status: active
created_at: 2026-08-22
```

## Purpose

PawBench reported that Catui v1.2.16 scored low on tasks that were actually completed because benchmark transcripts had zero tool calls. The immediate root cause is a trace visibility mismatch: PawBench reads `<workspace>/.catui/token-save/history.jsonl`, while TokenSave runtime data now intentionally lives under `~/.catui/token-save/projects/<projectKey>/`.

This review keeps the architectural boundary intact: TokenSave remains a token-savings analytics extension, while benchmark/audit tool-call evidence is owned by runtime run trace persistence.

## Decisions

| Finding | Status | Decision |
|---------|--------|----------|
| [PB01](./findings/PB01-runtime-trace-export.md) | selected | Persist each completed run trace to `<workspace>/.catui/traces/` and keep `latest.jsonl` current. |
| [PB02](./findings/PB02-print-trace-surface.md) | selected | Let print mode expose the latest trace location through structured output, without parsing TokenSave history. |
| [PB03](./findings/PB03-skill-install-security-gate.md) | selected | Block external repository installation into trusted skill directories at the default security extension boundary. |
| [PB04](./findings/PB04-explicit-memory-tool.md) | selected | Add a traceable `nanomem_remember` tool for explicit user memory requests. |
| [PB05](./findings/PB05-browser-benchmark-opt-in.md) | selected | Add an environment opt-in that registers the browser extension for benchmark/CI harnesses without making it a default user extension. |

## Non-Goals

- Do not move TokenSave history back into the project tree.
- Do not invent a PawBench-specific transcript schema inside core runtime.
- Do not make Browser Harness default-on for normal users; browser automation remains explicit opt-in because it can spawn external processes and seed a global helper workspace.
- Do not move safety policy into bash/read/write tools; user-visible security behavior remains extension-owned.

## Acceptance

- A completed prompt with tool use leaves a valid JSONL trace under `.catui/traces/`.
- `latest.jsonl` is atomically updated to the most recent run trace.
- Print mode can emit a machine-readable trace reference with `--print-loop-result`.
- `git clone <external> ~/skills` and equivalent trusted skill-dir targets are denied by `security-audit` in strict mode.
- Explicit user memory requests can be satisfied through a `nanomem_remember` tool call that writes NanoMem storage.
- `CATUI_ENABLE_BROWSER_EXTENSION=1` includes the browser extension in default load paths for benchmark/CI harnesses while normal default paths still omit it.
- DIP, quality, package-boundary, build, and TypeScript gates are run before closeout.
