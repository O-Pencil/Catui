# UI07: Settings Overlay Is Not Model Overlay

```yaml
id: UI07
status: selected
severity: medium
scope:
  - modes/interactive/interactive-mode.ts
  - showSettingsSelector
  - modes/interactive/components/settings-selector.ts
classification: interactive controller
```

## Problem

Earlier P5 drafts grouped `/settings` under `model-overlay` because the settings selector includes model-adjacent options such as thinking level and transport. The actual method is broader:

- image display settings
- skill command enablement
- steering/follow-up modes
- transport / agent loop / thinking level
- theme and theme preview
- hide thinking block + chat rebuild
- changelog, quiet startup, hardware cursor, editor padding/autocomplete
- token stats, buddy, presence

This is not a model overlay. It is a TUI settings overlay with many cross-owner callbacks.

## Deletion Test

If `showSettingsSelector` is placed in `model-overlay-controller`, that controller becomes a dumping ground for settings, theme, image, buddy, presence, editor appearance, and chat rebuild concerns.

That violates the calibration document:

- `model-overlay` should be an interactive controller over model/provider capabilities.
- settings surface lifecycle belongs to an interactive settings overlay or remains mount-owned until reviewed.
- provider/model selection rules must not become the excuse for absorbing unrelated settings.

## Verdict — SELECTED

Create a separate slice:

```text
settings-overlay-controller
```

Classification:

```text
Interactive controller
```

Recommended ownership:

- Owns `showSettingsSelector` and `SettingsSelectorComponent` callback wiring.
- Consumes named ports for settings mutation, theme preview/apply, editor appearance update, chat rebuild, footer invalidation, buddy sync, autocomplete setup, status/error.
- Does not own model selection, provider credentials, image pipeline internals, render layer internals, or runtime/session business rules.

## Boundary Rules

- `model-overlay-controller` must not import or call settings-selector.
- `settings-overlay-controller` must not receive `InteractiveMode`.
- A broad context is a warning sign. If the context exceeds a small set of coherent ports, split settings into sub-ports grouped by owner:
  - settings persistence
  - theme
  - editor appearance
  - chat/render refresh
  - buddy/presence
  - session mode flags

## Order

Do not extract `settings-overlay-controller` before model/auth/tree boundaries are stable unless it blocks slash-dispatcher context shrinkage.

Recommended position:

1. `model-overlay-controller`
2. `auth-provider-config-controller`
3. `tree-overlay-controller`
4. `settings-overlay-controller`
5. `slash-dispatcher-controller`

Reason: slash-dispatcher can then delegate `/settings`, `/model`, `/login`, `/tree`, `/resume`, `/fork` to named owners instead of owning their UI details.

## Acceptance

- `/settings` opens the same selector.
- All settings callbacks remain reachable.
- Theme preview/apply still invalidates UI.
- Hide-thinking rebuild still works.
- Editor padding/autocomplete changes still update the active/default editor as before.
- Buddy/presence toggles still affect the same surfaces.

