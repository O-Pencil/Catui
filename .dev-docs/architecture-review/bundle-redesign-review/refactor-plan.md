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
| 1 | Package boundary hardening | BR01 | yes | Add manifest/dist guards and formalize public packages vs embedded private libs |
| 2 | Browser extension packaging | BR02 | after maintainer accepts UX-first recommendation | Keep Browser as one extension capability; do not split raw harness assets first |
| 3 | Model metadata chunking | BR03 | after startup/import/churn metrics | Generator-backed only; preserve synchronous catalog APIs unless explicitly changed |
| 4 | esbuild/chunked build pipeline | BR04 | deferred | Reopen only for measured build/startup/size target; transpile-only before bundling |

## Recommended First Implementation Slice

BR01 is the first code slice, and it should stay boring:

- Add `npm run verify:package-boundary` for static manifest checks:
  - public package host dependency ranges match local package versions.
  - public packages declare `publishConfig.access = public`.
  - host package does not publish-resolve private internal libs.
  - root `files` includes `dist/**/*.js`, `dist/**/*.d.ts`, and `dist/**/*.json`.
- Add `npm run verify:package-boundary:dist` for capable-machine post-build checks:
  - `dist/node_modules/@pencil-agent/{ai,agent-core,tui}` exists.
  - embedded package manifests are sanitized and keep `default` export compatibility.
  - `mem-core` publish dist contains `extension.js` and `config.js`.
- Keep npm registry checks outside this script; `npm view`/install smoke remains a release-machine task.

This has higher leverage than esbuild because it prevents repeats of beta.2-beta.6 failures.

## Implementation Not Recommended Yet

Do not start these until BR01 is green:

- replacing `tsc` with esbuild
- publishing `@pencil-agent/ai` as a new public package
- moving browser source/assets
- changing `models.generated.ts` generator output

## Recalibrated Second Implementation Slice

BR02 should harden the Browser **extension capability** boundary before any size-driven package split:

```text
Browser extension               # commands + tools + Python harness + skills + workspace seed
npm package                     # distribution unit, not automatically the same thing as an extension
interactive /browser fallback   # host-owned discovery / enable guidance
```

The previous "asset package first" idea is rejected for now: it reduces initial install size but worsens first-use flow and splits one extension capability across two concepts. If Browser leaves the host tarball later, move/package the whole Browser extension behind a first-class install/enable UX.

## Third Slice Gate

BR03 should not proceed because `models.generated.ts` is 14k lines by itself. The compressed built output is only about 26K, so install-size savings are likely small. Only implement generated provider chunks if one of these is true:

- startup/import metrics show the eager catalog is meaningfully expensive.
- maintainers accept the complexity specifically to reduce provider metadata churn.

If implemented, keep the current sync facade:

```text
getModel()
getModels()
getProviders()
ModelRegistry.loadBuiltInModels()
```

No async catalog migration belongs in P7.

## Fourth Slice Gate

BR04 should not start as a bundling rewrite. Esbuild has plausible benefits:

- faster JS emission during release builds.
- fewer runtime files if a later bundle design is accepted.
- smaller unpacked JS if minification is accepted.

But the current runtime depends on package-shaped internal libs, extension loader aliases, dynamic imports, and sibling asset paths. Therefore the only acceptable first esbuild slice is:

```text
typecheck/declarations by TypeScript
JS transpilation by esbuild
no bundling
no minification
same dist file topology
```

Bundling is a separate future review, not a P7 default.

## Exit Criteria For P7 Review

- Maintainer accepts or rejects BR01-BR04.
- P7 execution plan is updated with the chosen first code slice.
- If P7 code proceeds, it has a capable-machine validation owner.
