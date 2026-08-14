# Closure

```yaml
status: closed
```

## Implemented

- `modes/interactive/components/footer.ts` now renders `NN%` in the existing token stats segment when cache usage data exists.
- Hit rate uses `cacheRead / (input + cacheRead)`.
- Added `test/footer-cache-hit-rate.test.ts` for direct footer rendering coverage.

## Acceptance

- Focused footer test passes.
- `npm run verify:dip` passes.
- `npm run verify:quality` passes.
- `npm run verify:package-boundary` and `npm run verify:package-boundary:dist` pass.
- `npx tsc --noEmit` passes.
- `npm run build` passes.
