# Entry & Volume Review

```yaml
review_id: entry-volume-review
parent_findings:
  - ../findings/F06-modes-static-imports.md
  - ../findings/F07-dist-bundle-composition.md
scope:
  - main.ts
  - modes/index.ts
  - root/package exports
  - extensions/builtin/browser
  - core/lib/ai provider/model loading
status: active
created_at: 2026-06-04
phase: P6
```

## Purpose

P6 is not just a performance patch. It redefines **what cost a user pays at startup and install time**.

This review exists to keep P6 aligned with the target architecture:

```text
entry chooses only the requested surface
optional capabilities are paid for only when used
provider catalogs/loaders do not make every provider eager
public SDK/package surfaces remain compatible unless explicitly reviewed
```

P6 code landing is still blocked by P5 DoD. This review can run in parallel with P5 because it is documentation and boundary design only.

## Current Finding Set

| Finding | Status | Purpose |
|---------|--------|---------|
| [EV01](./findings/EV01-p6-p5-dependency-boundary.md) | selected | P6 review may run now; P6 code that touches entries/modes waits for P5 stable entry shape |
| [EV02](./findings/EV02-mode-lazy-dispatch-boundary.md) | selected | `main.ts` should select one mode by dynamic import; `modes/index.ts` must not eager-load heavy modes |
| [EV03](./findings/EV03-browser-opt-in-boundary.md) | selected | Browser automation is an optional capability; moving it out of builtin default load is an intentional behavior change requiring Q2 |
| [EV04](./findings/EV04-ai-provider-lazy-boundary.md) | selected-runtime-first | Provider metadata/runtime loading split is defined; first code slice is runtime lazy resolver, metadata chunking is deferred |
| [EV05](./findings/EV05-package-surface-stability.md) | selected | P6 touches package `files`, root exports, and subpath shape; compatibility changes require explicit REVIEW |

## Workflow

1. **Calibrate**: read [entry-architecture-calibration.md](./entry-architecture-calibration.md) before changing code.
2. **Classify**: each P6 change is entry dispatch / optional capability / provider loading / package surface.
3. **Gate**: apply [gates.md](./gates.md) before implementation.
4. **Implement after P5**: do not edit P5-active files while another Agent is splitting interactive UI.
5. **Record**: update [refactor-plan.md](./refactor-plan.md) with the actual order, validation, and intentional behavior changes.

## Non-Goals

- Do not rewrite P5 interactive controllers as part of P6.
- Do not narrow root `index.ts` as an opportunistic side effect; coordinate with P8/Q3.
- Do not remove browser functionality; only change default loading/installation after Q2.
- Do not change model selection, prompts, provider semantics, or token accounting.

## Relationship To P6

[P6-entry-volume.md](../execution-plan/P6-entry-volume.md) is the runbook. This directory explains why each entry/volume boundary is valid and what must be true before code moves.
