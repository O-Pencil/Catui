# UI08: Model Overlay Must Not Own Reusable Model Capability

```yaml
id: UI08
status: selected
severity: high
scope:
  - modes/interactive/interactive-mode.ts
  - model-overlay-controller
  - core/runtime/model-controller.ts
  - core/runtime/agent-session.ts
classification: interactive controller over shared capability
```

## Problem

`model-overlay` is the next P5 slice, but its dependency width can be misunderstood as permission to own model capability. That would be the wrong abstraction.

The model workflow has clear second consumers outside interactive TUI:

- `core/runtime/model-controller.ts` owns reusable model state changes: `setModel`, `cycleModel`, `setThinkingLevel`, `cycleThinkingLevel`, thinking clamping, API-key validation, session/default-model persistence, and model-select events.
- `core/runtime/agent-session.ts` exposes those capabilities as the runtime facade.
- `modes/rpc/rpc-mode.ts` consumes model setting/cycling/listing.
- `modes/acp/acp-mode.ts` has its own `/model` and thinking command handling.
- extensions consume model/thinking operations through runtime bindings.

Therefore, reusable model capability must not be buried in `model-overlay-controller`.

## Deletion Test

If `model-overlay-controller` is deleted, the runtime model capability must still exist and remain usable by SDK/RPC/ACP/extensions through `AgentSession`.

If deleting `model-overlay-controller` deletes the only implementation of model switching, thinking selection, API-key validation, default-model persistence, or model history events, the boundary is wrong.

## Verdict — SELECTED

`model-overlay-controller` is allowed to be wide, but only as an **interactive TUI selection workflow**.

It may own:

- `/model` interactive command flow.
- TUI model selector opening, filtering, and provider→model selection.
- scoped-models selector interaction.
- thinking-level TUI commands and keybindings that delegate to `AgentSession`.
- provider-config precondition calls through a port.
- TUI status/error/footer/editor-border feedback after selection.

It must not own:

- model switching business rules.
- thinking clamping/persistence rules.
- API-key validation.
- provider credential/base URL/custom model persistence.
- settings file format.
- cross-mode model command policy.
- runtime model-select event emission.

## Required Port Shape

The controller context must be grouped by capability, not passed as many unrelated mount methods:

```text
ModelOverlayContext
  modelSession       # current model, set/cycle model, thinking, scoped models via AgentSession
  modelCatalog       # registry/candidate access needed by interactive selection
  modelSettings      # enabled/default model settings only
  providerConfig     # ensure provider is configured before selection
  surface            # selector/status/error/prompt/render TUI surface
  footer             # provider count/footer/editor-border refresh
  onModelApplied     # interactive-only side effects such as the daxnuts hook
```

The context is intentionally the widest P5 controller context. It is acceptable because every group serves one workflow: interactive model selection. It must not keep growing after this slice.

## Reuse Rule

Use this rule before moving a method into `model-overlay-controller`:

> If the capability has a second mode/runtime consumer, it belongs in runtime/core or a shared helper behind a port. `model-overlay-controller` may only orchestrate that capability in the TUI.

Examples:

- `AgentSession.setModel()` and `AgentSession.cycleModel()` stay runtime-owned.
- provider credentials stay `auth/provider-config` owned and are consumed through `ProviderConfigPort`.
- exact model-term parsing may become a small pure helper if ACP/RPC/interactive duplication grows, but P5 must not create a broad `ModelSelectionService` before the abstraction has enough evidence.

## Acceptance

- `model-overlay-controller` does not import `interactive-mode.ts` or receive `InteractiveMode`.
- `model-overlay-controller` delegates actual model/thinking mutation to `AgentSession` or a `ModelSessionPort`.
- provider credential/config implementation stays outside the controller.
- `/settings`, agent-loop, tree/session navigation, extension UI, and render-event ownership do not enter the controller.
- Repointing provider configuration from mount to `auth/provider-config-controller` later only changes the `providerConfig` port implementation, not the model-overlay workflow.
- Token neutrality, compatibility, data fallback, and performance neutrality gates still pass.
