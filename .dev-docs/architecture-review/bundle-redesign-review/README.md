# Bundle Redesign Review

```yaml
review_id: bundle-redesign-review
phase: P7
parent_finding: ../findings/F07-dist-bundle-composition.md
scope:
  - package.json
  - package-lock.json
  - scripts/copy-internal-libs.js
  - scripts/copy-assets.js
  - core/lib/{ai,agent-core,tui}
  - packages/{extension-sdk,mem-core,soul-core}
  - extensions/builtin/browser
status: closed-as-gated
created_at: 2026-06-06
closed_at: 2026-06-07
```

## Purpose

P7 was originally scoped as "esbuild + `models.generated.ts` split". The beta.2-beta.6 release loop changed the first question: before shrinking bytes, the project must define a stable package/install boundary.

This review answers:

```text
What does the host tarball own?
What must be a public npm package?
Which costs should move to optional install/load paths?
Which P7 implementation slice is worth taking first?
```

## Beta Packaging Postmortem

| Version | Symptom | Root Cause | Resolution |
|---------|---------|------------|------------|
| beta.0 | install failed on first-party package lookup | host declared packages that were not yet public npm packages | beta.1 attempted to remove dependency; later superseded |
| beta.1 | still not a correct model | `extension-sdk` was treated as type-only even though first-party packages needed it as public protocol | beta.2 published first-party packages |
| beta.2 | runtime failed: missing `@pencil-agent/ai` | `core/lib/*` private libs are imported by package name but were neither public deps nor embedded | beta.3 embedded private libs under `dist/node_modules/@pencil-agent/*` |
| beta.3 | extension loader failed with `No "exports" main defined` | loader uses `require.resolve`; bundled internal libs had ESM-only `exports.import` | beta.4 adds `default` export conditions to bundled internal package manifests |
| beta.4 | `mem-core` extension failed loading missing `./config.js` | public `@pencil-agent/mem-core@1.1.0` tarball was incomplete or stale vs repository dist | beta.5 requires republished `mem-core` |
| beta.5/6 prep | `mem-core` publish build failed without local `extension-sdk` link | `mem-core` build depended on workspace install state for type-only SDK imports | beta.6 adds a self-contained type shim for publish build |

## Boundary Conclusion

P7 must preserve this distinction:

| Area | Runtime/install rule | Reason |
|------|----------------------|--------|
| `packages/extension-sdk` | public npm package | stable extension protocol; also used by first-party published packages |
| `packages/mem-core` | public npm package | independent memory implementation; host consumes by npm semver |
| `packages/soul-core` | public npm package | independent soul implementation; host consumes by npm semver |
| `core/lib/ai` | private internal lib embedded in host tarball | not currently a public dependency in candidate D; host runtime imports it by package name |
| `core/lib/agent-core` | private internal lib embedded in host tarball | same |
| `core/lib/tui` | private internal lib embedded in host tarball | same |
| `extensions/builtin/browser` | optional Browser extension capability | registration is opt-in; Browser Harness assets are implementation details of the same extension |

The `dist/node_modules/@pencil-agent/*` embedding is not a regression to old `bundle-deps.js`; it is the formal runtime resolution strategy for private internal libs while they remain in `core/lib`.

## Current Finding Set

| Finding | Status | Purpose |
|---------|--------|---------|
| [BR01](./findings/BR01-package-boundary-hardening.md) | selected-first | Make package boundary/package smoke the first P7 slice |
| [BR02](./findings/BR02-browser-asset-optionalization.md) | recalibrated-ux-first | Browser packaging must preserve extension UX before chasing install-size reduction |
| [BR03](./findings/BR03-model-metadata-chunking.md) | reviewed-metrics-gated | Split `models.generated.ts` only if startup/import or churn metrics justify it |
| [BR04](./findings/BR04-esbuild-risk-deferral.md) | reviewed-deferred | Esbuild can help build speed/file count, but bundling risks package and extension boundaries |

## Closure

See [closure.md](./closure.md).

P7 closes as a gated review plus BR01 package-boundary hardening. It does not continue into browser package moves, model metadata chunking, or esbuild bundling without new metrics and a separate accepted slice.

## Non-Goals

- Do not start esbuild migration during beta packaging stabilization.
- Do not publish `@pencil-agent/ai`, `agent-core`, or `tui` only to fix runtime resolution; that contradicts candidate D unless they are explicitly promoted.
- Do not move browser files without a user-facing opt-in path and package contents review.
- Do not change provider request payloads, prompts, token accounting, or model selection semantics.

## Recommended Next Step

BR01 is the foundation:

```text
package boundary hardening
  -> pack/install smoke
  -> internal-lib embedding manifest checks
  -> public package publish order checks
```

After beta install/runtime is boring, take BR02 as an extension-boundary slice before any size-reduction implementation:

```text
BR02 browser extension capability boundary first
BR03 model metadata chunking second if metrics justify it
BR04 esbuild last, if still needed
```

BR02 should treat Browser as one pluggable extension capability. A raw `browser-harness` asset package is not recommended as the first slice because it optimizes initial install size while worsening first-use flow. If Browser leaves the host tarball later, package the whole Browser extension behind a first-class install/enable UX. Do not add any browser package to host dependencies or optionalDependencies, because npm installs optional dependencies by default.

BR03 is not a package-boundary emergency. The generated model catalog is large in lines but small when compressed. Treat it as a metrics-gated startup/churn problem, not as an automatic size win.

BR04 remains deferred. Esbuild's real potential benefits are faster JS emission, fewer runtime files if bundled, and possible minified unpacked-size reduction. The high-risk part is bundling: it can break the private embedded-lib strategy, extension jiti aliases, dynamic imports, and asset-relative paths. If reopened, start with transpile-only esbuild plus TypeScript declarations, not bundling.
