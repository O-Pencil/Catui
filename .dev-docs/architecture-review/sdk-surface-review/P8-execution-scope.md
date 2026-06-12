# P8 — Executable Scope: narrow the public export surface

```yaml
doc: P8-execution-scope
parent: ./README.md            # sdk-surface-review (SK01-03 = the WHY)
runbook: ../execution-plan/P8-sdk-narrow.md
status: implementation-accepted
risk: high (intentional public API break — only valid in a major bump)
created_at: 2026-06-11
```

## Goal

Make the **public export surface isomorphic to the refactored architecture**. The
directory layers (packages / core / modes / extensions) and concept layers
(cognition / tool / interface) are migrated, but the root barrel `index.ts` is
still the pre-refactor "everything in one bucket": 296 symbols across host SDK,
extension protocol, runtime internals, tools, interactive UI, theme, CLI `main`,
config — all behind one import path `@pencil-agent/nano-pencil`.

P8 is the **one phase where "functionally unchanged" intentionally does not hold
for public API symbols** → it can only ship in a major version window (2.0).

### Why (benefits, per refactor goal)

- **可扩展**: extension authors depend on a small, versioned `@pencil-agent/protocol`
  protocol package instead of the whole host barrel.
- **可维护**: UI components / runtime internals stop being frozen-as-public-API, so the
  TUI and runtime become refactorable again (renaming `ModelSelectorComponent` is no
  longer a breaking change).
- **可兼容**: only the intentional ~20-symbol SDK surface is the compatibility contract;
  internals evolve freely; subpaths let advanced users opt into volatility knowingly.
- **合理分配 / 可读**: the export structure *becomes* the architecture map — root = embed
  SDK, protocol = write extensions / package integrations, subpaths = advanced internals, removed = not
  public. New exports get a clear "落点" rule (the §2b layer-placement, extended to exports).

## What de-risks this (audited 2026-06-11)

- **Builtin extensions do NOT import the root barrel** — they use relative imports
  `../../../core/extensions-host/types.js`. Narrowing root does not break builtin source.
- **First-party packages are already on protocol** — `packages/mem-core/src` imports
  `ExtensionAPI`/`ExtensionContext` from `@pencil-agent/protocol` (not the root barrel).
- **protocol already has the foundation** — exports `./tools` + `./lifecycle` + `./commands`
  (P3). B is *completing* it, not starting from zero.
- ∴ internal churn is small. The **breaking impact is external**: (a) external library
  consumers of `@pencil-agent/nano-pencil`, and (b) **user extensions** that import from
  the root barrel via the jiti alias at `core/extensions-host/loader.ts:45`
  (`"@pencil-agent/nano-pencil": import("../../index.js")`) — the doc comment in
  `core/extensions-host/types.ts:204` even teaches `import { CustomEditor } from "@pencil-agent/nano-pencil"`.

## Export Matrix (296 → 4 destinations)

Detailed sign-off matrix: [`public-api-matrix.md`](./public-api-matrix.md).
Migration guide: [`migration-guide.md`](./migration-guide.md).

> Source: full `index.ts` (348 lines). Counts are approximate per group.

### Bucket A — KEEP in root `@pencil-agent/nano-pencil` (~20, the stable host embedding SDK)

| Symbols | From |
|---------|------|
| `createAgentSession`, `CreateAgentSessionOptions`, `CreateAgentSessionResult`, `PromptTemplate`, `SDKLogger`, `silentLogger`, `defaultLogger` | core/runtime/sdk |
| `PencilAgent`, `quickAgent`, `PencilAgentOptions` | core/runtime/pencil-agent |
| `VERSION`, `getAgentDir` | config |

Tool factories (`createBashTool`, `createCodingTools`, `createReadTool`/Edit/Write/Find/Grep/Ls,
`createReadOnlyTools`, `readOnlyTools`) — KEEP in root for SDK embedding and also expose through
`./tools` with the concrete tool implementations.

### Bucket B — MOVE to `@pencil-agent/protocol` (only cross-publish public contracts)

The entire `from "./core/extensions-host/index.js"` block (index.ts:68–157):

- **Types (~80)**: `ExtensionAPI`, `ExtensionContext`, `ExtensionContextActions`,
  `ExtensionCommandContext(Actions)`, `Extension`, `ExtensionFactory`, `ExtensionHandler`,
  `ExtensionRuntime`, `ExtensionEvent`, `ExtensionError`, `ExtensionFlag`, `ExtensionShortcut`,
  `ExtensionUIContext`, `ExtensionUIDialogOptions`, `ExtensionWidgetOptions`, `WidgetPlacement`,
  `ToolDefinition`, `AgentToolResult`, `AgentToolUpdateCallback`, `ToolInfo`, `RegisteredTool`,
  `RegisteredCommand`, all `*Event` types (`AgentStart/EndEvent`, `Turn/ToolCall/ToolResultEvent`,
  `Session*Event`, `UserBashEvent`, `Bash/Edit/Find/Grep/Ls/Read/WriteToolCallEvent`, …),
  `MessageRenderer`, `MessageRenderOptions`, `ToolRenderResultOptions`, `SlashCommand*`,
  `ProviderConfig`, `ProviderModelConfig`, `KeybindingsManager`, `AppAction`, `Input*`, `Exec*`.
- **Values (~14)**: `createExtensionRuntime`, `discoverAndLoadExtensions`, `ExtensionRunner`,
  `wrapRegisteredTool(s)`, `wrapToolWithExtensions`, `wrapToolsWithExtensions`,
  `isBash/Edit/Find/Grep/Ls/Read/WriteToolResult`, `isToolCallEventType`.

**Updated work rule (2026-06-12)**: do **not** move the entire host `types.ts` block. First build
[`protocol-inventory.md`](./protocol-inventory.md), then move only types that cross a publish boundary.
Host-only rich types remain in `core/extensions-host/types.ts`; the host may re-export or `extends`
protocol contracts to preserve compatibility.

### Bucket C — MOVE to explicit subpaths (~120, intentionally-supported internals)

Add `package.json` `exports` subpaths; remove from root:

| Subpath | Symbols (from) |
|---------|----------------|
| `./session` | `SessionManager` + all session-entry types, `migrateSessionEntries`, `parse/buildSessionContext`, version consts (session-manager) |
| `./session/compaction` | `compact`, `generateSummary`, `generateBranchSummary`, `findCutPoint`, `shouldCompact`, `estimateTokens`, `DEFAULT_COMPACTION_SETTINGS`, + compaction types (~22) |
| `./config` | `AuthStorage` + backends, `SettingsManager` + settings types, `DefaultResourceLoader`/`ResourceLoader`, `DefaultPackageManager`/`PackageManager` types |
| `./models` | `ModelRegistry` |
| `./runtime` | `AgentSession` + types, `createEventBus`/`EventBus`, `convertToLlm` |
| `./tools` | `bashTool`, `editTool`, `codingTools`, read/edit/write/find/grep/ls tools + their `*Options`/`*Details`/`*Input` types, `truncate*`, `formatSize`, `DEFAULT_MAX_*` (~48) |
| `./skills` | `loadSkills`, `loadSkillsFromDir`, `formatSkillsForPrompt`, `Skill`, `SkillFrontmatter`, … |

> Subpaths are **additive** — they could ship in a 2.x minor *before* the breaking removal.
> But doing them in 2.0 alongside the removal gives one coherent surface from day one.

### Bucket D — REMOVE from root (~60, not public SDK)

| Symbols | Disposition |
|---------|-------------|
| `main` (main.ts) | **remove** — CLI entry is the `nanopencil` bin, not an SDK export |
| `InteractiveMode`, `runPrintMode`, `runRpcMode`, `*ModeOptions` (modes) | remove from root; no first-implementation subpath because modes are not a supported public API yet |
| 38 interactive UI components (`*Component`, selectors, `appKey`/`keyHint`/`renderDiff`, editor keys) | remove from root; no first-implementation `./ui` surface because TUI internals change frequently |
| theme utils (`getMarkdownTheme`, `highlightCode`, `initTheme`, `Theme`, `ThemeColor`, …) | remove from root; future public UI/theme surface requires a focused review |
| `copyToClipboard`, `parseFrontmatter`, `stripFrontmatter`, `ReadonlyFooterDataProvider` | remove from root or `./utils` (internal-leaning) |

## Rewire & republish checklist

1. **protocol**: add public contracts one slice at a time (Bucket B) → bump version → **publish** when consumed externally.
2. **host**: import protocol from `@pencil-agent/protocol` (not root barrel);
   rewrite `index.ts` to Bucket A only; add Bucket C subpaths to `package.json` `exports`.
3. **builtin extensions**: switch relative `core/extensions-host/types` imports → `@pencil-agent/protocol`
   only when they need protocol-only contracts; rich host command/UI contexts stay host-local.
4. **first-party packages**: `mem-core` already on protocol ✓; verify `soul-core`; republish if their
   protocol version bumps.
5. **jiti alias** (`core/extensions-host/loader.ts:45`): decide what the runtime injects to user extensions —
   keep `@pencil-agent/nano-pencil` → narrowed root only, and add `@pencil-agent/protocol` alias so
   user extensions can adopt the protocol package. Update the `types.ts:204` doc example accordingly.
6. **docs**: the `docs/extensions.md` + `docs/sdk.md` skill manuals (scaffolded) document the new surfaces.

## Migration guide (CHANGELOG breaking draft)

```md
### BREAKING (2.0): public API surface narrowed (P8)

`@pencil-agent/nano-pencil` root now exports only the host embedding SDK
(createAgentSession, PencilAgent, quickAgent, loggers, VERSION).

- Extension protocol (ExtensionAPI, ToolDefinition, lifecycle events, …)
  → import from `@pencil-agent/protocol`.
- Sessions/compaction/config/models/runtime/tools/skills internals
  → import from `@pencil-agent/nano-pencil/{session,config,models,runtime,tools,skills}`.
- Interactive UI components & theme are no longer public in the first P8 implementation.
- `main` and CLI utilities are no longer exported (use the `nanopencil` bin).

Codemod: most imports change only the module specifier, not the symbol names.
```

## Execution order & gates

1. B (protocol inventory + sliced host rewire) — verify host builds importing protocol from `@pencil-agent/protocol`.
2. C (subpath exports) — `package.json exports` + confirm dist has each subpath's `.js`/`.d.ts`.
3. D (root removal; no first-implementation UI/modes subpath) — rewrite `index.ts`.
4. **Symbol diff is now the INTENDED breaking set** — regenerate `collect-baseline.ts` symbols; the diff
   vs `baseline/public-api-symbols-main.txt` is reviewed as the *declared* P8 break (not an accident).
5. Build method unchanged (tsc-per-package + minify + embed); only source moves + `exports` map + imports.

## Acceptance (SK01)

- [ ] root API is intentionally small (~20) and documented (docs/sdk.md).
- [ ] no internal module imports the root barrel (already true for builtin source; verify after rewire).
- [ ] extension protocol authoritative in `@pencil-agent/protocol`; host + first-party packages import from it where contracts cross publish boundaries.
- [ ] external consumer migration guide + CHANGELOG breaking note shipped.
- [ ] public symbol diff accepted as declared P8 break in the 2.0 window.
