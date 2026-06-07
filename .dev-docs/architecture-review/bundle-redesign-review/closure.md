# P7 Bundle Redesign Closure

```yaml
review_id: bundle-redesign-review
phase: P7
status: closed-as-gated
closed_at: 2026-06-07
code_scope:
  implemented:
    - BR01 package-boundary guard
  deferred:
    - BR02 browser package move
    - BR03 model metadata chunking
    - BR04 esbuild bundling
```

## Closure Verdict

P7 should close as a **gated review and package-boundary hardening slice**, not as a broad bundle rewrite.

The beta.2-beta.6 loop proved that the urgent problem was not "too many bytes"; it was unstable package ownership:

```text
public packages                 -> npm semver dependencies
private core/lib runtime libs    -> host-embedded dist/node_modules packages
optional capabilities            -> UX-first extension decisions, not raw asset moves
build pipeline                   -> measured target before replacement
```

BR01 fixed the load-bearing release boundary. BR02-BR04 now have explicit gates and should not proceed without new evidence.

## Final Finding State

| Finding | State | Decision |
|---------|-------|----------|
| [BR01](./findings/BR01-package-boundary-hardening.md) | implemented | Keep public package vs embedded-private-lib guard. This is the only P7 code slice accepted now. |
| [BR02](./findings/BR02-browser-asset-optionalization.md) | recalibrated-ux-first | Browser is one extension capability. Do not split raw Browser Harness assets first. |
| [BR03](./findings/BR03-model-metadata-chunking.md) | reviewed-metrics-gated | Do not split `models.generated.ts` because of line count. Require startup/import/churn metrics. |
| [BR04](./findings/BR04-esbuild-risk-deferral.md) | reviewed-deferred | Esbuild may help build speed, but bundling is deferred. If reopened, start transpile-only. |

## What Changed

Implemented guardrails:

- `npm run verify:package-boundary`
- `npm run verify:package-boundary:dist`
- `packages/soul-core/package.json` declares `publishConfig.access = public`
- P7 docs now encode public package vs embedded private lib boundaries.

No broad runtime behavior rewrite was accepted.

## What Did Not Change

- Browser remains a complete optional extension capability.
- Browser Harness remains an implementation asset of that extension.
- `models.generated.ts` remains monolithic until metrics justify generator-backed chunking.
- The build pipeline remains `tsc`-based.
- Provider request payloads, prompts, token accounting, model selection, and extension loader behavior are not intentionally changed by P7.

## Why Not Continue P7 Code Now

### BR02: Browser

Moving raw Browser Harness assets to a package optimizes first install size but worsens first-use UX. Users think in terms of the Browser extension, not an extension shell plus an asset package.

Future move condition:

```text
package the whole Browser extension only after a first-class install/enable UX exists
```

### BR03: Model Metadata

`models.generated.ts` is large in lines but small when compressed. It is a startup/import/churn question, not a release-boundary emergency.

Future move condition:

```text
capture startup/import/churn metrics and preserve sync getModel/getModels/getProviders
```

### BR04: Esbuild

Esbuild's strongest benefits require bundling or minification, which can disturb internal package embedding, extension aliases, dynamic imports, and asset-relative paths.

Future move condition:

```text
prove a concrete build/startup/size target; start with transpile-only, no bundling
```

## Validation State

P7 static validation:

```bash
npm run verify:package-boundary
```

P7 capable-machine validation:

```bash
npm run build
npm run verify:package-boundary:dist
npm publish --dry-run --tag beta
npm install -g @pencil-agent/nano-pencil@beta
nanopencil -v
```

Notes:

- prerelease publishes must use `npm publish --tag beta`.
- `npm publish --dry-run` for prerelease versions also needs `--tag beta`.
- If a size win is claimed later, attach tarball and unpacked before/after data.

## Reopen Matrix

| Reopen Area | Required Evidence | First Allowed Slice |
|-------------|-------------------|---------------------|
| Browser package move | User-facing install/enable UX exists and browser opt-in smoke is defined | Move/package whole Browser extension, not raw harness assets |
| Model metadata chunking | Startup/import/churn metrics justify generator complexity | Generated provider chunks plus sync aggregate compatibility wrapper |
| Esbuild | Build/startup/size target is measured and unmet by safer slices | Transpile-only esbuild plus TypeScript declarations; no bundling |

## Handoff

P7 can be treated as closed for the current refactor branch once:

- BR01 guard passes on the release machine.
- fresh beta install has no extension/package load errors.
- maintainers accept that BR02-BR04 are gated follow-up work, not current-scope blockers.
