# PawBench v1.2.17 Remediation Review

```yaml
review_id: pawbench-v1217-remediation-review
source_report: /Users/cunyu666/Dev/PawBench/catui_v1217_report_for_team.md
scope:
  - remove TokenSave as a shipped/default extension
  - add benchmark-readable print transcript stream
  - improve report P1 security alignment behavior
status: active
created_at: 2026-08-22
```

## Purpose

PawBench v1.2.17 still reports zero tool calls because its extractor reads the legacy workspace TokenSave history path. The user has also decided to remove TokenSave instead of continuing to carry the ambiguous extension.

This review moves transcript ownership out of TokenSave entirely: benchmark/audit evidence is a print/runtime output contract, not an output-shortening analytics side effect.

## Decisions

| Finding | Status | Decision |
|---------|--------|----------|
| [PB17-01](./findings/PB17-01-remove-tokensave.md) | selected | Remove TokenSave from default extension metadata and product command surface; delete its shipped extension source and tests. |
| [PB17-02](./findings/PB17-02-print-transcript-stream.md) | selected | Add a print-mode NDJSON transcript stream for tool calls/results and final result so PawBench does not scrape TokenSave files. |
| [PB17-03](./findings/PB17-03-security-alignment.md) | selected | Extend security-audit coverage for report P1 authority and injection patterns without moving safety policy into core tools. |

## Non-Goals

- Do not recreate `<workspace>/.catui/token-save/history.jsonl`.
- Do not keep TokenSave as a hidden default dependency.
- Do not make PawBench parse private session internals.
- Do not attempt to solve model-capability P2 algorithm tasks through product code.

## Acceptance

- Default extension paths and metadata contain no `token-save` entry.
- `/tokensave` is not advertised as a product command.
- TokenSave source and TokenSave-specific tests are removed from active test scripts.
- Print mode can emit a machine-readable NDJSON transcript containing tool-use, tool-result, assistant-text, and result events.
- Security tests cover untrusted skill clone, malicious instruction comments, and human-admin authority boundaries.
- `npm test`, DIP, quality, package-boundary, build, TypeScript, and dist boundary checks pass before closeout.
