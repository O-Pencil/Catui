# Entry & Volume Refactor Plan

```yaml
plan_for: entry-volume-review
parent: ./README.md
status: active   # P5 structurally complete (2026-06-04); P6 code unblocked. EV02 landed.
```

## Execution Rule

~~P6 code is blocked by P5.~~ **P5 结构完成（2026-06-04）** → P6 代码解锁。EV02（mode lazy dispatch）已落地；EV03 registration slice 已落地且 physical/package slice 仍待 Q2；EV04 provider matrix 已完成，下一刀只允许 runtime lazy resolver。

```text
P5 interactive entry stable
  -> EV02 mode lazy dispatch
  -> EV03 browser opt-in registration slice (default-load exit; Q2 physical/package still pending)
  -> EV04 provider lazy runtime resolver (metadata chunking deferred)
  -> EV05 package surface sign-off
```

## Slice Order

| Order | Slice | Finding | Code allowed now? | Notes |
|-------|-------|---------|-------------------|-------|
| 0 | P6 review scaffolding | EV01-EV05 | docs only | Safe parallel work while another Agent changes P5 |
| 1 ✅ done | mode lazy dispatch | EV02 / F06 | **landed 2026-06-04** | main.ts only: dropped the eager `modes/index.ts` barrel import; rpc/interactive/print dispatch branches now `await import(...)` the selected runner (ACP already did). modes/index.ts barrel kept as public SDK surface (root index.ts re-exports it; EV-G4 — not narrowed). Cold-start measurement pending capable machine. See EV02 §Resolution |
| 2 ✅ in progress | browser opt-in registration | EV03 / F07 / Q2 | **registration-only allowed** | Browser metadata is optional/defaultDisabled and `getBuiltinExtensionPaths()` no longer returns browser; physical dir/package files unchanged pending Q2 |
| 3 | browser physical/package opt-in | EV03 | no, after Q2 | Moving builtin→optional or independent package is intentional behavior/package change; needs fallback UX and docs |
| 4 ✅ reviewed | ai provider lazy design | EV04 / F07 / Q6 | docs only | Matrix complete: [provider-lazy-matrix.md](./provider-lazy-matrix.md). Decision: runtime lazy first; metadata chunking deferred |
| 5 | ai provider runtime lazy implementation | EV04 | yes, after review | Implement lazy resolver by `model.api`; keep `stream()` sync-return and `getModel/getModels/ModelRegistry` synchronous |
| 6 | ai model metadata chunking | EV04 / F07 | no, later slice | Requires generator change and compatibility wrapper; do not combine with runtime lazy |
| 7 | package surface review | EV05 / Q3 / P8 | docs only | Do not narrow root exports in P6 unless Q3 explicitly says so |

## Conflict Matrix With P5

| P6 Slice | P5 Conflict | Decision |
|----------|-------------|----------|
| mode lazy dispatch | Depends on final interactive entry/export shape | Wait for P5 stable `InteractiveMode` mount and controller wiring |
| browser opt-in | May affect extension-ui feature inventory and builtin extension expectations | Review now; code after P5 extension acceptance is stable |
| ai provider lazy | Cross-mode runtime/provider behavior, not direct P5 file conflict | Design now; implement only with full provider validation |
| package surface | Could interact with P5/P8 public exports and subpaths | Review now; implementation requires explicit compatibility decision |

## Acceptance Shape

Each code slice must record:

```text
Slice:
Cost moved:
Files touched:
Intentional behavior changes:
Compatibility notes:
Validation:
- mode smoke:
- browser fallback:
- provider matrix:
- cold start:
- dist size:
Residual risk:
```

## Near-Term Parallel Work

Safe while P5 is active:

- Maintain this review directory.
- Inspect import graphs by text search.
- Draft Q2 browser opt-in decision.
- Draft provider lazy matrix.
- Define measurement commands for a capable machine.

Not safe while P5 is active:

- Edit `main.ts` dispatch.
- Edit `modes/index.ts`.
- Move `extensions/builtin/browser`.
- Change package `files` or root exports.
- Change `core/lib/ai` provider/model loading.

## Validation Record

| Slice | Cost moved | Files touched | Intentional behavior changes | Compatibility notes | Validation | Residual risk |
|-------|------------|---------------|------------------------------|---------------------|------------|---------------|
| EV02 mode lazy dispatch | Unselected mode import cost leaves startup path | `main.ts` | None intended | `modes/index.ts` remains public facade | Maintainer build pending/confirmed separately; cold-start pending capable machine | Performance claim needs measurement |
| EV03 browser opt-in registration | Browser extension registration/resource discovery leaves default startup path | `builtin-extensions.ts`, slash catalog/dispatcher fallback, browser registry test, P1/P2/P3 docs | Full `/browser` command and browser/browser_admin tools are no longer default-loaded; lightweight `/browser` fallback explains opt-in; user must opt in via `--extension extensions/builtin/browser` or config `extensions:` | Browser source, package `files`, and vendored Python remain shipped; this is not the final F07 package-size reduction | Static diff only on low-performance machine; maintainer should run targeted registry test and build | Q2 still required for physical move/independent package |
| EV04 provider lazy review | Provider runtime lazy design separated from model metadata chunking | `provider-lazy-matrix.md`, EV04 finding/refactor-plan | None; docs only | Public AI APIs stay synchronous; runtime lazy must bridge async import inside event stream | Static review only; implementation requires capable-machine build and provider smoke matrix | Metadata chunking still open; OAuth lazy deferred |
