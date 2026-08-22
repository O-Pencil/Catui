# PawBench v1.2.17 Remediation Closure

```yaml
review_id: pawbench-v1217-remediation-review
status: accepted
```

## Verification

- `node --test --import tsx test/security-audit.test.ts` — passed
- `node --test --import tsx test/browser-extension-registration.test.ts` — passed
- `node --test --import tsx test/print-mode-shutdown.test.ts --test-name-pattern "print transcript|transcript events"` — passed
- `npm run test:commands` — passed
- `npm run test:mcp` — passed
- `npm test` — passed
- `npm run verify:dip` — passed
- `npm run verify:quality` — passed
- `npm run verify:package-boundary` — passed
- `npx tsc --noEmit --pretty false` — passed
- `npm run build` — passed
- `npm run verify:package-boundary:dist` — passed

## Accepted Changes

- Removed the default TokenSave extension source, registration metadata, command completion coverage, and tests.
- Added `--print-transcript` for text print mode to emit PawBench-readable NDJSON transcript events on stderr without depending on TokenSave storage.
- Extended the security-audit tool-call boundary to block external skill installs into trusted skill directories, hidden HTML-comment prompt injection persistence, and human-admin-only authority boundary crossings.
