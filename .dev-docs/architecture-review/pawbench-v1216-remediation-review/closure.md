# PawBench v1.2.16 Remediation Closure

```yaml
review_id: pawbench-v1216-remediation-review
status: closed
implemented_at: 2026-08-22
closed_at: 2026-08-22
```

## Landed Changes

- Runtime now persists validated semantic run traces to `<workspace>/.catui/traces/<runId>.jsonl` and refreshes `<workspace>/.catui/traces/latest.jsonl`.
- Print mode includes `tracePath` in the existing `--print-loop-result` stderr JSON when a completed trace path is available.
- The default security audit extension blocks external `git clone` commands whose target is a trusted skill directory such as `~/skills`, `~/.agents/skills`, `~/.catui/agent/skills`, `~/.claude/skills`, `~/.codex/skills`, or project `.catui/skills`.
- The detector now expands `~/...` paths relative to the user's home directory instead of accidentally resolving them from filesystem root.
- NanoMem now exposes `nanomem_remember` for explicit user-requested durable memories, using the same engine persistence path as extracted memories.
- Browser Harness remains optional for normal users, but benchmark/CI harnesses can set `CATUI_ENABLE_BROWSER_EXTENSION=1` to include the browser extension in default load paths without mutating user config.

## Verification

Checks run during implementation:

- `node --test --import tsx test/run-trace-jsonl.test.ts`
- `node --test --import tsx test/print-mode-shutdown.test.ts`
- `node --test --import tsx test/security-audit.test.ts`
- `npm run test:harness-eval`
- `npm run test:security`
- `node --test --import tsx packages/mem-core/test/extension-remember-tool.test.ts`
- `npm test --prefix packages/mem-core`
- `node --test --import tsx test/browser-extension-registration.test.ts`
- `npm run verify:dip`
- `npm run verify:quality`
- `npm run verify:package-boundary`
- `npx tsc --noEmit`
- `npm run build`
- `npm run verify:package-boundary:dist`

All listed checks passed on 2026-08-22.

## External Adapter Note

Catui now writes the canonical tool-call evidence under `.catui/traces/`. PawBench should read this path, or read the `tracePath` field from `--print-loop-result`, instead of treating TokenSave history as the transcript source.
