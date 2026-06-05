# Entry & Volume Refactor Plan

```yaml
plan_for: entry-volume-review
parent: ./README.md
status: active   # P5 structurally complete (2026-06-04); EV04 runtime validated; EV05 reviewed.
```

## Execution Rule

~~P6 code is blocked by P5.~~ **P5 结构完成（2026-06-04）** → P6 代码解锁。EV02（mode lazy dispatch）已落地；EV03 registration slice 已落地且 physical/package slice 仍待 Q2；EV04 runtime lazy 已实现并验收；EV05/Q3 已选择 compatible subpaths 路线；AI package layer review 已确认哪些能力属于 `@pencil-agent/ai`。下一刀是 additive `@pencil-agent/ai/*` subpath exports，随后才按 capability group 迁移内部 root imports。

```text
P5 interactive entry stable
  -> EV02 mode lazy dispatch
  -> EV03 browser opt-in registration slice (default-load exit; Q2 physical/package still pending)
  -> EV04 provider lazy runtime resolver (metadata chunking deferred)
  -> EV05 package surface sign-off
  -> EV05 additive subpaths + internal import migration (future implementation slice)
```

## Slice Order

| Order | Slice | Finding | Code allowed now? | Notes |
|-------|-------|---------|-------------------|-------|
| 0 | P6 review scaffolding | EV01-EV05 | docs only | Safe parallel work while another Agent changes P5 |
| 1 ✅ done | mode lazy dispatch | EV02 / F06 | **landed 2026-06-04** | main.ts only: dropped the eager `modes/index.ts` barrel import; rpc/interactive/print dispatch branches now `await import(...)` the selected runner (ACP already did). modes/index.ts barrel kept as public SDK surface (root index.ts re-exports it; EV-G4 — not narrowed). Cold-start measurement pending capable machine. See EV02 §Resolution |
| 2 ✅ in progress | browser opt-in registration | EV03 / F07 / Q2 | **registration-only allowed** | Browser metadata is optional/defaultDisabled and `getBuiltinExtensionPaths()` no longer returns browser; physical dir/package files unchanged pending Q2 |
| 3 | browser physical/package opt-in | EV03 | no, after Q2 | Moving builtin→optional or independent package is intentional behavior/package change; needs fallback UX and docs |
| 4 ✅ reviewed | ai provider lazy design | EV04 / F07 / Q6 | docs only | Matrix complete: [provider-lazy-matrix.md](./provider-lazy-matrix.md). Decision: runtime lazy first; metadata chunking deferred |
| 5 ✅ done | ai provider runtime lazy implementation | EV04 | landed | Lazy resolver by `model.api` implemented and validated; `stream()` sync-return and `getModel/getModels/ModelRegistry` stay synchronous |
| 6 | ai model metadata chunking | EV04 / F07 | no, later slice | Requires generator change and compatibility wrapper; do not combine with runtime lazy |
| 7 ✅ reviewed | package surface review | EV05 / Q3 / P8 | docs only | Q3 selects additive subpaths plus internal migration; do not narrow root exports in P6 |
| 8 ✅ reviewed | AI package layer review | EV05 / Q3 | docs only | Confirms AI owns LLM contracts/catalog/stream/provider/oauth, not runtime/TUI/mem/soul |
| 9 ✅ done | additive AI subpath exports | EV05 / Q3 | landed | Added explicit `@pencil-agent/ai/*` subpaths while keeping root legacy-compatible; maintainer validation passed |
| 10 ✅ in progress | internal AI import migration | EV05 / Q3 | active | Type-only/models/OAuth/registry/events/schema slices validated by maintainer build; current slice migrates stream/overflow/json/env imports to explicit subpaths |

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

Safe after EV05 review:

- Maintain this review directory.
- Inspect import graphs by text search.
- Draft Q2 browser opt-in decision.
- Draft provider lazy matrix.
- Define measurement commands for a capable machine.
- Add reviewed `@pencil-agent/ai/*` subpath exports in a dedicated package-surface slice.

Not safe without a separate package-surface snapshot/review:

- Edit `main.ts` dispatch.
- Edit `modes/index.ts`.
- Move `extensions/builtin/browser`.
- Change package `files`.
- Narrow root exports.
- Change `core/lib/ai` model metadata loading.

## Validation Record

| Slice | Cost moved | Files touched | Intentional behavior changes | Compatibility notes | Validation | Residual risk |
|-------|------------|---------------|------------------------------|---------------------|------------|---------------|
| EV02 mode lazy dispatch | Unselected mode import cost leaves startup path | `main.ts` | None intended | `modes/index.ts` remains public facade | Maintainer build pending/confirmed separately; cold-start pending capable machine | Performance claim needs measurement |
| EV03 browser opt-in registration | Browser extension registration/resource discovery leaves default startup path | `builtin-extensions.ts`, slash catalog/dispatcher fallback, browser registry test, P1/P2/P3 docs | Full `/browser` command and browser/browser_admin tools are no longer default-loaded; lightweight `/browser` fallback explains opt-in; user must opt in via `--extension extensions/builtin/browser` or config `extensions:` | Browser source, package `files`, and vendored Python remain shipped; this is not the final F07 package-size reduction | Static diff only on low-performance machine; maintainer should run targeted registry test and build | Q2 still required for physical move/independent package |
| EV04 provider lazy review | Provider runtime lazy design separated from model metadata chunking | `provider-lazy-matrix.md`, EV04 finding/refactor-plan | None; docs only | Public AI APIs stay synchronous; runtime lazy must bridge async import inside event stream | Static review only; implementation requires capable-machine build and provider smoke matrix | Metadata chunking still open; OAuth lazy deferred |
| EV04 provider runtime lazy | Built-in provider runtime imports leave `stream.ts` direct startup path until first matching `model.api` use | `core/lib/ai/src/api-registry.ts`, `core/lib/ai/src/providers/register-builtins.ts`, `core/lib/ai/src/stream.ts`, AI P2/P3 docs | None intended for model catalog, stream return type, payloads, token accounting, or provider selection | `@pencil-agent/ai` root provider re-exports remain; full root-barrel startup reduction requires EV05/Q3 | Maintainer confirmed `npm run build`, `npm run verify:quality`, and EV04 provider checks passed after TS loader fix | Dynamic import failures surface through stream error path; root-barrel and metadata costs remain separate work |
| EV05 package surface review | Defines whether root barrel/package API may change | `package-surface-matrix.md`, EV05 finding/refactor-plan/README | None; docs only | Q3 rejects root narrowing in P6; selects additive subpaths and internal migration | Static package/import review only; no code changed | Actual subpath exports and import migration still need implementation + build/package snapshot |
| AI package layer review | Defines which AI package layers are stable enough to become subpaths | `ai-package-layer-review/README.md`, refactor-plan/README | None; docs only | Confirms `ai` package remains LLM boundary kit; TUI/mem/soul/runtime stay outside | Static local package/import review plus external calibration from pi-mono/pi-rs/Hermes | Subpath exports still need implementation; OpenClaw used only as category context due ambiguous primary source |
| EV05 additive AI subpaths | Adds stable import boundaries for AI capability groups | `core/lib/ai/package.json`, `core/lib/ai/src/schema.ts`, `core/lib/ai/src/events.ts`, `core/lib/ai/src/registry.ts`, AI P2 docs | None intended; root `@pencil-agent/ai` remains compatible | Subpaths are additive; provider root exports are not removed | Maintainer confirmed `npm run build` and `npm run verify:quality` passed | Undocumented deep package imports may still be affected by `exports`; internal migration still pending |
| EV05 AI type-only import migration | Moves pure type-only root imports off the legacy barrel | root/modes/core/extensions/tests files with `import type ... from "@pencil-agent/ai"` | None intended; no value imports moved | `OAuth*` types route to `@pencil-agent/ai/oauth`; stream classes route to `@pencil-agent/ai/events`; contracts route to `@pencil-agent/ai/types` | Maintainer confirmed `npm run build` passed after stream/schema import fixes | Mixed value/type imports remain on root until value subpath migrations |
| EV05 AI models import migration | Moves model catalog/helper value imports off the legacy barrel | model resolver/switcher/runtime thinking/model controller, interactive model selector, agent-core model tests, simplify/characterization/sdk tests | None intended; imports only | `getModel/getModels/getProviders/modelsAreEqual/supportsXhigh` route to `@pencil-agent/ai/models`; model/message contracts remain on `@pencil-agent/ai/types` | Maintainer confirmed `npm run build` and `npm run verify:quality` passed | `models.generated.ts` metadata cost is unchanged; stream/OAuth/registry root imports remain |
| EV05 AI OAuth import migration | Moves OAuth registry/helper imports off the legacy barrel | `core/platform/config/auth-storage.ts`, `core/mcp/figma-auth.ts`, `core/model-registry.ts`, interactive login/provider config UI | None intended; imports only | `getOAuthProvider/getOAuthProviders/getOAuthApiKey/registerOAuthProvider/OAuth*` route to `@pencil-agent/ai/oauth`; `getEnvApiKey` remains on root until an env subpath exists | Maintainer confirmed `npm run build` and `npm run verify:quality` passed | OAuth subpath still imports built-in provider implementations by design; this is package-boundary cleanup, not OAuth runtime laziness |
| EV05 AI registry import migration | Moves provider registry imports off the legacy barrel | `core/model-registry.ts`, `core/runtime/agent-session.ts` | None intended; imports only | `registerApiProvider/resetApiProviders` route to `@pencil-agent/ai/registry`; streaming helpers remain on root until stream slice | Maintainer confirmed build passed | `@pencil-agent/ai/registry` intentionally exposes built-in provider registration seams; provider smoke remains EV-G6 |
| EV05 AI events/schema import migration | Moves event stream and schema/validation imports off the legacy barrel | `core/lib/agent-core/*`, `core/model-registry.ts` | None intended; imports only | `EventStream/AssistantMessageEventStream` route to `@pencil-agent/ai/events`; `validateToolArguments` and agent-core TypeBox re-exports route to `@pencil-agent/ai/schema` | Maintainer confirmed `npm run build` and `npm run verify:quality` passed | `streamSimple/completeSimple/isContextOverflow/parseStreamingJson` root imports remain for the stream/overflow slice |
| EV05 AI stream/helper import migration | Moves remaining internal runtime helper imports off the legacy barrel | AI package subpaths, agent-core loops/proxy, runtime retry/session/extension bindings, compaction, auth storage, simplify, interactive mode docs/imports | None intended; imports only | `stream/complete/streamSimple/completeSimple` route to `@pencil-agent/ai/stream`; `isContextOverflow` to `@pencil-agent/ai/overflow`; `parseStreamingJson` to `@pencil-agent/ai/json`; `getEnvApiKey` to `@pencil-agent/ai/env`; root remains for extension-loader bundling shim and legacy public API | Local static import scan/diff check only; maintainer build required | New helper subpaths are additive public surface; root barrel compatibility remains unchanged |
| P1 builtin extension path closure | Removes executable `extensions/defaults` path remnants after the P1 skeleton rename | `scripts/copy-assets.js`, idle-think link-world fallback, extension path tests, extension-host P3, P1 plan | None intended; path alignment only | Browser opt-in physical/package decision remains EV03 Q2; this only aligns existing builtin paths | Maintainer confirmed `npm run build` and `npm run verify:quality` passed | Historical/archive docs may still mention defaults as pre-rename context; not executable debt |
