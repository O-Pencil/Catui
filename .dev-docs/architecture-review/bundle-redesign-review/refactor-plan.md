# Bundle Redesign Refactor Plan

```yaml
plan_for: bundle-redesign-review
phase: P7
status: proposed
created_at: 2026-06-06
```

## Order

| Order | Slice | Finding | Code Allowed Now? | Notes |
|-------|-------|---------|-------------------|-------|
| 0 | Review/postmortem | BR01-BR04 | docs only | This document set |
| 1 | Package boundary hardening | BR01 | yes, after beta.6 install smoke | Add pack/install checks and formalize embedded private libs |
| 2 | Browser asset optionalization | BR02 | after Q2 | Biggest real install-size win; user-facing opt-in path required |
| 3 | Model metadata chunking | BR03 | after size/startup metrics | Generator-backed only; preserve synchronous catalog APIs unless explicitly changed |
| 4 | esbuild/chunked build pipeline | BR04 | deferred | Do not start until package boundaries are stable and prior slices are measured |

## Recommended First Implementation Slice

BR01 should be the first code slice, and it should be boring:

- Add a package smoke script that checks public package versions and embedded lib resolution.
- Add a dry-run review checklist for `dist/node_modules/@pencil-agent/{ai,agent-core,tui}`.
- Add a `mem-core` package smoke that imports `@pencil-agent/mem-core/extension` after install.
- Document publish order in the release checklist.

This has higher leverage than esbuild because it prevents repeats of beta.2-beta.6 failures.

## Implementation Not Recommended Yet

Do not start these until BR01 is green:

- replacing `tsc` with esbuild
- publishing `@pencil-agent/ai` as a new public package
- moving browser source/assets
- changing `models.generated.ts` generator output

## Exit Criteria For P7 Review

- Maintainer accepts or rejects BR01-BR04.
- P7 execution plan is updated with the chosen first code slice.
- If P7 code proceeds, it has a capable-machine validation owner.

