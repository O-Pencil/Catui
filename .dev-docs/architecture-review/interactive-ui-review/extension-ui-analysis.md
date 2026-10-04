# extension-ui rewrite analysis (pre-implementation)

```yaml
doc: extension-ui-analysis
parent: ./README.md
finding: UI02 (extension-ui-controller was unplanned, rewrite)
status: analysis-before-implementation
target: modes/interactive/interactive-mode.ts → controllers/extension-ui/*
nature: rewrite (lifecycle coordination layer redesigned) + component wiring pure move
```

> This is the **pre-implementation analysis** for the extension-ui slice. It's the only P5 slice explicitly labeled "rewrite" (UI02), and the one most likely to break the **extension-facing contract**. Establish the contract, the smells, the decomposition, the seams, and the risks before any code moves.

---

## 1. Size

**31 methods + 12 state fields** (the largest cluster inside interactive-mode). Methods span L1300–2332; state L277–308.

---

## 2. Hard contract: `ExtensionUIContext` (rewrite must not break)

`createExtensionUIContext()` (L1811) returns `ExtensionUIContext`; ~25 methods are **directly called by extension authors**. The rewrite **must preserve this shape and semantics verbatim**:

| Category | Contract methods |
|----------|-------------------|
| prompts | `select` `confirm` `input` `notify` |
| Persistent surfaces | `setStatus` `setWidget` `setFooter` `setHeader` |
| custom | `custom` (overlay / inline + onHandle) |
| Editor text | `pasteToEditor` `setEditorText` `getEditorText` |
| Editor replacement | `setEditorComponent` |
| Editor prompt | `editor` `openExternalEditor` |
| Terminal | `setTitle` `onTerminalInput` |
| Theme | `theme` `getAllThemes` `getTheme` `setTheme` |
| Render state | `setWorkingMessage` `getToolsExpanded` `setToolsExpanded` |

> **`createExtensionUIContext` = aggregator**: it assembles `ExtensionUIContext` from multiple sources; many pieces **don't belong to extension-ui** (theme → mount / theme; editor text → mount / editor; setTitle → ui; setWorkingMessage / toolsExpanded → `this.state`). After the rewrite it remains the **single assembly point**, composing from 4 hosts + mount capabilities the same contract object. **Acceptance baseline = behavior of these 25 methods unchanged.**

---

## 3. Smell: three parallel prompt-lifecycles

`showExtension{Selector,Input,Editor}` (plus `confirm` delegating to selector) share a **verbatim skeleton**:

```
1. if opts.signal.aborted → resolve(undefined)
2. onAbort = () => { hideX(); resolve(undefined) }; signal.addEventListener
3. this.dismissActiveExtensionPrompt(false)        ← single-active-prompt invariant
4. this.extensionX = new XComponent(... submit→{hideX;resolve(v)} cancel→{hideX;resolve(undefined)} ...)
5. editorContainer.clear(); addChild(extensionX); ui.setFocus(extensionX); requestRender()
```

Paired with: `hideX` (→ `dismissX` + render), `dismissX(restoreFocus)` (→ clear field + dispose + `remountEditorShell` + `restoreEditorFocusIfPossible`).

**= 9 methods + 3 coordinating methods** (`dismissActiveExtensionPrompt` clears all 3; `hasActiveExtensionPrompt` = any of the three; `restoreEditorFocusIfPossible` = no active prompt + editor mounted → focus the editor).

**Essence**: three components (Selector / Input / Editor) slot into the **same "single-active-prompt" slot**. That's the rewrite target.

---

## 4. Decomposition (4 hosts + aggregator, refines UI02)

| Host | Responsibility | Absorbs | Own state |
|------|----------------|----------|-----------|
| **PromptHost** | Single-active-prompt slot: mount into editorShell, focus, submit / cancel / abort → resolve, dismiss → dispose + remount + restore focus | show{Selector,Input,Editor} + hide×3 + dismiss×3 + dismissActiveExtensionPrompt + hasActiveExtensionPrompt | `activePrompt` (merges extensionSelector / Input / Editor into a single slot) |
| **CustomOverlayHost** | `custom`: overlay (ui.showOverlay / hideOverlay + onHandle) or inline (mount into editorShell); save / restore editor text | showExtensionCustom | No persistent state (per-call close closure) |
| **PersistentSurfaceRegistry** | Keyed persistent surfaces: widget (above / below) / footer / header / status | setExtensionWidget / clearExtensionWidgets / renderWidgets / renderWidgetContainer / setExtensionFooter / setExtensionHeader / setExtensionStatus / resetExtensionUI | extensionWidgetsAbove / Below, widgetContainerAbove / Below, customFooter, customHeader, builtInHeader, headerContainer |
| **EditorComponentAdapter** | `setEditorComponent`: replace the editor component, preserve editor text / callbacks / shortcuts / focus | setCustomEditorComponent | (operates on `this.editor` / `this.defaultEditor`) |

**Aggregator `createExtensionUIContext`** stays in the controller; assembles `ExtensionUIContext` from the 4 hosts above + mount capabilities.

**Small pieces**: terminal input (`addExtensionTerminalInputListener` / `clear` + `extensionTerminalInputUnsubscribers`) absorbed into the controller; extension loading (`initExtensions` / `setupExtensionShortcuts` / `getRegisteredToolDefinition`) is extension **runtime** assembly — can share a controller but should be distinguished from UI hosts.

> **Don't introduce a generic overlay stack** (UI02 resolution): PromptHost is **a single slot** (not a stack) — the current behavior is "one prompt at a time"; no nesting requirement. If real nesting ever appears, address it then.

---

## 5. Seam: deep coupling with editor-shell (design difficulty)

extension-ui is **heavily coupled to editor-shell**: prompts mount into `editorContainer` (replacing the editor slot), dismiss must `remountEditorShell()` to restore. The host needs a **narrow context** to get these mount capabilities:

| Context capability | Use |
|--------------------|-----|
| `getEditorContainer()` | clear / addChild / children.includes |
| `getEditor()` / `getDefaultEditor()` | setText / getText / focus, replace |
| `remountEditorShell()` | Restore editor shell after dismiss |
| `getUi()` (setFocus / requestRender / showOverlay / hideOverlay / terminal) | Focus / render / overlay |
| `getKeybindings()` | ExtensionEditorComponent / custom factory |
| `getChatContainer()` | showExtensionError render |
| `showStatus / showError / showWarning` | notify delegation |
| `getState()` (workingMessageOverride / loadingAnimation / toolOutputExpanded) | setWorkingMessage / getToolsExpanded |
| `getWidgetContainers()` (above / below slots) | Persistent widget render |

> **Cross-owner sharing**: `restoreEditorFocusIfPossible` is also called by handleEvent (agent_start / end) — it depends on PromptHost's `hasActivePrompt()` + editor-shell. After the rewrite, the host exposes `hasActivePrompt()`; mount's focus-restore queries the host. Or the host owns the method and mount calls it. Single owner (UI-G3) must be made explicit.

---

## 6. "Passing through" methods that don't belong to extension-ui (don't absorb by mistake)

| Method | Substance | Destination |
|--------|-----------|-------------|
| `shouldRenderToolTrace` | Tool-trace render policy (reads settings) | **render / UI04, NOT extension-ui** |
| `showExtensionNotify` | Thin adapter (→ showStatus / Error / Warning) | Stay in aggregator or thin shell |
| `showExtensionError` | Render extension errors to chat | extension-ui (extension lifecycle) |

---

## 7. Rewrite invariants (acceptance baseline)

1. **`ExtensionUIContext`'s 25 methods behave verbatim the same** (the hard contract).
2. **Single-active-prompt invariant**: before showing any prompt, clear the existing one (PromptHost's single slot guarantees this naturally).
3. **Focus restoration**: after dismiss, if no active prompt and editor is mounted → focus the editor; agent_start / end's focus restore still works.
4. **Editor-shell restoration**: after dismiss / custom close → `remountEditorShell` + editor text / focus restored.
5. **Abort semantics**: signal aborted → resolve(undefined) + clean up listener.
6. **Persistent surfaces**: widget / footer / header / status set / clear / render behavior unchanged; `resetExtensionUI` cleans everything.
7. **Behavioral review**: during extraction, **proactively verify** extension prompt / overlay / widget (per A contract + C built-in manual tests; see [behavior-review-log](./behavior-review-log.md)).

---

## 8. Recommended extraction order (host by host, each step tsc + functional acceptance)

1. **PersistentSurfaceRegistry** (most independent, pure move on keyed surfaces, trial run)
2. **PromptHost** (core rewrite: 3 lifecycles → single slot; main battleground for the smell)
3. **CustomOverlayHost** (per-call; depends on PromptHost's editor-shell seam being stable)
4. **EditorComponentAdapter** (editor replacement)
5. **`createExtensionUIContext`** changed to assemble from 4 hosts + mount capabilities (contract-unchanged acceptance)
6. Terminal input + extension loading absorbed into the controller

> Each step: `ExtensionUIContext` contract diff = empty (or explicitly declared); functional acceptance matches the host's prompt / surface behavior; UI-G7 imports tighten.

---

## 9. To-read during implementation (details to fill in then)

- `setCustomEditorComponent` body (L2042–2115): editor replacement's text / callback / shortcut / focus preservation details.
- `setExtensionWidget` / `renderWidgetContainer` (L1454–1713): widget rendering and container layout.
- `initExtensions` (L1300–1407): extension loading and host assembly point.
- `ExtensionUIContext` type definition (extensions-host): the authoritative contract shape.
