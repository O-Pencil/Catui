# P5 Mode Architecture Calibration

```yaml
doc: mode-architecture-calibration
scope: P5 interactive-mode split
status: active
created_at: 2026-06-03
parent:
  - ./README.md
  - ../execution-plan/P5-ui-split.md
trigger:
  - "Do not just keep maintaining one large file after splitting methods"
  - "Re-check InteractiveMode from the functional/top-level mode architecture"
```

## 1. Why This Document Exists

The current P5 work started from the real god file: method clusters, state clusters, import seams, and safe extraction order. That was necessary, but it is not sufficient.

If we only move method clusters out of `interactive-mode.ts`, we may still preserve the wrong architecture: one mode-shaped object remains the implicit owner of model selection, auth/provider configuration, slash commands, session navigation, input submission, extension UI, and rendering.

This document is the top-level correction:

> `InteractiveMode` must converge to a TUI adapter + composition root. It must not remain the owner of product/business capabilities.

P5 therefore has two simultaneous goals:

1. **Stop the god file bleeding**: extract coherent, reviewable, reversible slices.
2. **Preserve the target architecture direction**: each slice must move toward a mode adapter + ports/controllers/services model, not toward a new smaller god file.

## 2. Final Role of InteractiveMode

### Verdict

`InteractiveMode` is not a domain service and should not become a base class for all modes.

Its end-state role is:

```text
InteractiveMode = TUI adapter + composition root + wiring shell
```

It should own:

- TUI creation and lifecycle (`TUI`, terminal, focus, render invalidation).
- Composition of interactive-only controllers/hosts.
- Keybinding wiring from editor/TUI actions to owner capabilities.
- TUI ports: `showSelector`, `showStatus`, `showError`, `requestRender`, editor-shell mount points.
- Subscription wiring from `AgentSession` events to the render layer.

It should not own:

- Provider credential/config rules.
- Model selection rules.
- Slash command business dispatch.
- Session tree/navigation rules.
- Input submission routing.
- Self-update workflow.
- Extension surface lifecycle internals.
- Long-term runtime/session behavior.

### Why Not a Shared BaseMode

A `BaseMode` inheritance hierarchy looks attractive but is a high-risk abstraction here:

```text
BaseMode
  ├─ InteractiveMode
  ├─ PrintMode
  ├─ RpcMode
  └─ AcpMode
```

Reject this as the primary architecture for P5:

- It encourages protected hooks and hidden override contracts.
- It tends to become a new god object shared by all modes.
- Interactive/print/rpc/acp differ in IO model, lifecycle, and surface semantics.
- The first shared abstraction would be guessed before the second consumer proves it.

The preferred architecture is composition:

```text
Mode adapters
  ├─ InteractiveTuiAdapter
  ├─ PrintAdapter
  ├─ RpcAdapter
  └─ AcpAdapter

Shared capabilities behind ports
  ├─ model selection / model switching
  ├─ auth + provider configuration
  ├─ slash command dispatch
  ├─ session navigation
  ├─ input submission
  ├─ cancellation
  └─ compaction/session runtime facade

Interactive-only surfaces
  ├─ prompt/overlay/widget/editor hosts
  ├─ model/provider/scoped-model selectors
  ├─ settings selector
  ├─ tree/session/user-message selectors
  └─ streaming render components
```

## 3. Boundary Taxonomy

Every P5 slice must be classified into one of these buckets before implementation.

| Bucket | Meaning | Examples | Rule |
|--------|---------|----------|------|
| **Shared capability** | Mode-independent business rule or workflow | model selection rule, auth/provider config, slash command resolution, session navigation operation | Extract behind a port only when the boundary is known; move to `_shell` or `core` only after a second consumer is real |
| **Interactive controller** | TUI-specific orchestration over a capability | model overlay, tree overlay, settings overlay, input-submit adapter | May live under `modes/interactive/controllers`; must not own provider/session/runtime rules that can be shared |
| **Interactive surface host** | Reusable TUI surface lifecycle | PromptHost, CustomOverlayHost, PersistentSurfaceRegistry, EditorComponentAdapter | Pure interactive; no cross-mode ambition |
| **Composition wiring** | Object creation and connection of ports | `InteractiveMode` constructor/init/keybinding setup | Stays in mount; should shrink but not disappear |
| **Render layer** | TUI rendering and event-to-component mapping | handleEvent, message components, tool trace rendering | Deferred until controller seams stabilize |

## 4. Current P5 Slice Reclassification

| Current slice | Current location | Target classification | Calibration result |
|---------------|------------------|-----------------------|--------------------|
| `state/interactive-state` | `modes/interactive/state` | Interactive controller support | OK as local state holder; do not turn into global app state |
| `image-pipeline-controller` | `modes/interactive/controllers` | Interactive controller | OK; clipboard/editor-shell/attachments are TUI-specific |
| `self-update-controller` | `modes/interactive/controllers` | Shared capability candidate + interactive adapter | Keep in interactive for P5; move to `_shell/update` only after another mode needs update UX |
| extension UI hosts | `modes/interactive/controllers/extension-ui` | Interactive surface hosts | OK; these are not shared mode logic |
| `model-overlay` | partially normalized in mount | Interactive controller over shared model/provider capabilities | Selection guard is done; next extract overlay as interactive controller and keep provider config behind context |
| `auth/provider-config` | not extracted yet | Shared capability candidate with interactive prompts | First extract as provider-config capability with prompt port; do not bury it in model overlay |
| `slash-dispatcher` | dispatch table done, controller not extracted | Shared command resolution + interactive command execution adapter | Extract controller after model/auth/tree/settings owners exist, so slash delegates instead of carrying their UI details |
| `tree-overlay` | not extracted yet | Interactive controller over session navigation capability | UI selector stays interactive; runtime navigation goes through AgentSession facade |
| `_shell/cancellation` | planned | Shared capability | Good cross-mode candidate because signal/abort semantics already span modes |
| `input-submit` | planned | Interactive adapter over shared command/prompt capabilities | Should route to owners; must not become the new god function |
| `handleEvent/render` | deferred | Render layer | Keep deferred; extract only after event ownership and state shape are stable |
| `showSettingsSelector` | currently in mount | Interactive settings overlay | UI07 selected: do not include in model-overlay; extract as `settings-overlay-controller` after model/auth/tree boundaries stabilize |

## 5. Ports Before Moves

For hybrid slices, first create explicit ports in the controller context. Do not move dependencies by importing the old modules from the new file.

### Model Overlay Port Shape

`model-overlay` should consume provider configuration through a port:

```ts
ensureProviderConfiguredForSelection(model): Promise<boolean>
handleProviderSelectionFromSelector(provider, done): Promise<void>
```

During transition these ports may point back to mount. After `auth/provider-config` is extracted, repoint them to that owner without changing model-overlay code.

The important invariant is:

> Selecting a model is allowed only after provider configuration succeeds.

That invariant belongs to the selection path; credential details belong to provider-config.

### Auth / Provider Config Port Shape

Provider config should expose capability results, not UI/model side effects:

```ts
ensureProviderConfiguredForSelection(model): Promise<boolean>
configureProvider(provider, options): Promise<ProviderConfigResult>
```

It should not own model overlay UI or arbitrary model picker state.

### Slash / Input Port Shape

Slash and input-submit should not be one owner:

- slash-dispatcher owns built-in slash command lookup and command execution routing.
- input-submit owns editor submit classification and ordering.
- extension command execution should be routed through the extension runner capability, not hard-coded into a slash god function.

## 6. Placement Rules

Use these rules before creating a file:

1. **One mode only + TUI objects in the constructor** → `modes/interactive/controllers/...`.
2. **Two mode consumers or no TUI dependency** → candidate for `modes/_shell/...`.
3. **Runtime/session invariant required by SDK or all modes** → `core/runtime` or existing core domain.
4. **Credential/config persistence** → provider-config/auth owner, not overlay owner.
5. **Component lifecycle/focus/render** → interactive surface host, not shared service.
6. **A context with 20 unrelated methods** → boundary is wrong; split the owner before moving code.

## 7. Revised Next-Step Gate

Before continuing P5 code moves, each next slice must answer:

1. Is this a shared capability, interactive controller, surface host, composition wiring, or render layer?
2. What business invariant does it own?
3. What UI surface does it own?
4. Which dependencies are ports rather than imports?
5. Is there a real second mode consumer, or are we prematurely moving to `_shell`/`core`?
6. What feature-inventory rows prove the behavior after the move?

If these answers are unclear, create a short slice analysis doc before implementation.

## 8. Immediate Consequences

1. **Do not target `<500 lines` as a near-term proof.** The first proof is ownership clarity and import reduction. `<500` is post-input-submit + post-render-layer.
2. **Do not put `showSettingsSelector` into model-overlay.** It is a settings overlay with broad TUI/settings dependencies.
3. **Model-overlay is the next code slice**, but only as an interactive controller over ports, not as owner of provider credentials.
4. **Auth/provider-config should follow model-overlay immediately**, because current bridge methods should not stay in mount indefinitely.
5. **Tree/settings owners should land before slash-dispatcher controller extraction**, so slash can delegate `/tree` `/resume` `/fork` `/settings` instead of owning their UI details.
6. **A shared BaseMode is rejected for now.** Shared logic should emerge as ports/services after at least two consumers prove the abstraction.

## 9. Success Criteria

P5 is architecturally successful when:

- `InteractiveMode` reads like a composition root, not a feature owner.
- Each user-facing workflow has a named owner.
- Business rules can be reviewed without reading TUI component code.
- TUI surface lifecycle can be changed without touching provider/session/auth logic.
- Cross-mode shared logic is behind explicit ports, not inherited protected methods.
- Feature behavior is proven by `feature-inventory.md`, and intentional behavior changes are recorded in the review docs.
