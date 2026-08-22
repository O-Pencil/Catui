# PawBench Trace Input Closure

```yaml
review_id: pawbench-trace-input-review
status: accepted
```

## Verification

- `npx vitest --run core/lib/agent-core/test/agent-loop-run-trace.test.ts core/lib/agent-core/test/run-trace.test.ts` — passed
- `node --test --import tsx test/run-trace-jsonl.test.ts` — passed
- `npm run verify:dip` — passed
- `npm run verify:quality` — passed
- `npm run verify:package-boundary` — passed
- `npx tsc --noEmit --pretty false` — passed
- `npm run build` — passed
- `npm run verify:package-boundary:dist` — passed

## Accepted Changes

- `tool.requested` trace payloads now include clear `input` values for new runs while retaining `inputFingerprint`.
- Legacy traces without clear `input` remain valid.
- Workspace `.catui/traces/latest.jsonl` persistence preserves tool inputs for benchmark transcript extraction.
