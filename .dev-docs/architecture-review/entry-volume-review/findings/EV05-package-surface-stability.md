# EV05: Package Surface Changes Are Stability Decisions

```yaml
id: EV05
status: selected-compatible-subpaths
severity: high
scope:
  - package.json
  - index.ts
  - modes/index.ts
  - scripts/bundle-deps.js
  - package files
classification: package surface
related_decisions:
  - Q3
  - P8
```

## Problem

P6 naturally tempts broad cleanup:

- remove mode exports from root `index.ts`
- change package `files`
- move browser assets
- change bundled workspace package layout
- add subpath exports

Those are public/stability decisions, not incidental implementation details.

## Verdict — SELECTED

P6 may reduce eager loading and package cost, but it must not narrow public SDK/package surface without explicit Q3/P8 decision.

## Q3 Resolution

Q3 selects the compatible subpath route:

- keep root barrels compatible in P6
- do not remove provider exports from `@pencil-agent/ai`
- add explicit subpath exports only as an additive package-surface slice
- migrate nanoPencil internal imports by capability group after subpaths exist
- defer root export narrowing/deprecation to P8 or a breaking-change release

Detailed matrix: [package-surface-matrix.md](../package-surface-matrix.md)

## Boundary Rules

- Root `index.ts` narrowing belongs to P8 unless Q3 explicitly pulls it into P6.
- Package `files`, bin entries, and subpath exports require REVIEW.
- Deprecation beats removal unless the phase explicitly declares a breaking change.
- Build/package changes need a rollback path independent from mode lazy dispatch.
- Internal import migration must not depend on undocumented deep package paths; add explicit subpaths first.

## Acceptance

- Public API snapshot is compared before/after any package surface change.
- Package contents diff is reviewed for missing runtime assets.
- Any intentional public surface change is documented as GB-2.
