# Cancellation / interrupt — dedicated review (pre-implementation)

```yaml
doc: cancellation-analysis
phase: P5
finding: gates.md#single-owner (Ctrl-C/D/Z + shutdown signals; single-key esc multi-target dispatch)
status: review
source:
  - modes/interactive/interactive-mode.ts::onEscape (main + 3 swap sites)
  - modes/interactive/interactive-mode.ts::handleCtrlC/handleCtrlD/handleCtrlZ
  - modes/interactive/interactive-mode.ts::shutdown/checkShutdownRequested
  - modes/interactive/interactive-mode.ts signal registration (SIGHUP/SIGTERM)
decision: SELECTED B (only interactive interrupt-controller; shutdown / signals stay in mount; _shell deferred) — 2026-06-04
```

## 0. Premise

This review is a structural review. The goal is to decide **whether to extract, how much, and what must not change**; it does not record characterization. Different from previous slices, this one has two new properties:

1. **Cross-mode candidate**: the gates assign `Ctrl-C/D/Z + shutdown` to `modes/_shell/cancellation` (cross-mode), not to an interactive-internal controller. That implies a possible new `modes/_shell/` directory (new P2 boundary, FATAL-004 risk).
2. **Single-key esc with multiple targets**: the gates explicitly say "mount wires it, branches delegate to owners" — esc must not be owned exclusively by any single controller.

## 1. Phenomenon layer: current distribution

### 1.1 State fields (scattered across mount)

| Field | Purpose |
|-------|---------|
| `lastEscapeTime` | Double-tap-esc timer when editor is empty → tree/fork (< 500ms) |
| `lastSigintTime` | Double-tap-Ctrl-C timer → shutdown (< 500ms) |
| `shutdownRequested` | Flag set by extensions' `shutdownHandler` for delayed exit; during streaming, doesn't exit immediately, `checkShutdownRequested` re-checks after |
| `isShuttingDown` | `shutdown()` re-entry guard |
| `state.autoCompactionEscapeHandler` | Saved original `onEscape` during auto-compaction |
| `state.retryEscapeHandler` | Saved original `onEscape` during retry |

### 1.2 esc main dispatch (`onEscape`, single key → multiple targets, by priority)

```
loadingAnimation active → restoreQueuedMessagesToEditor({abort:true})   [queue owner]
else isStreaming         → agent.abort()                                   [cancellation/abort]
else isBashRunning       → session.abortBash()                             [bash]
else isBashMode          → clear bash mode (setText / flag / border)        [bash/editor]
else editor empty        → double-tap esc → tree/fork selector (per setting)[tree-overlay]
```

### 1.3 esc's **swap mode** (the critical complexity)

`onEscape` is **not a stable single function**; three places temporarily replace it and then restore it:

| Swap site | Saved to | Replaced with | Restored at |
|-----------|----------|---------------|-------------|
| Manual compaction `compact()` | local `originalOnEscape` | `session.abortCompaction()` | `finally` |
| Auto compaction | `state.autoCompactionEscapeHandler` | custom | compaction end / `agent_start` |
| Retry | `state.retryEscapeHandler` | custom | `agent_start`(2144) / retry end(2450) |

→ Any design where "the cancellation controller owns `onEscape` exclusively" collides with this save/restore. The two flows (compaction / retry) currently own their state in **the unextracted UI04 render layer** (`handleEvent` / loader / retry); see gates `handleEvent` deferred.

### 1.4 Ctrl / signals / shutdown

| Entry | Behavior |
|--------|----------|
| `handleCtrlC` | Double-tap (<500ms) → shutdown; single-tap → clearEditor |
| `handleCtrlD` (when editor empty, guaranteed by CustomEditor) | Direct shutdown |
| `handleCtrlZ` | `ui.stop()` + `process.kill(0,SIGTSTP)`; on `SIGCONT`, `ui.start()` + render |
| `SIGHUP` / `SIGTERM` (registered at init) | `shutdown()` |
| Extension `shutdownHandler` | Sets `shutdownRequested`; non-streaming → immediate shutdown |
| `shutdown()` | emit `session_shutdown` (5s timeout guard) → cleanupClipboardImages → nextTick → `terminal.drainInput(1000)` → `stop()` → print resume hint → `process.exit(0)` |

## 2. Essence layer: what is really "cross-mode"

Break shutdown into pieces:

- **Truly cross-mode thin shell**: process-signal registration (`SIGHUP` / `SIGTERM` / `SIGTSTP` / `SIGCONT`) + re-entry guard + "graceful exit" orchestration skeleton (emit shutdown → cleanup → exit).
- **Strongly interactive-coupled body**: `ui.terminal.drainInput`, `ui.stop/start`, `statusContainer` / `chatContainer`, TUI resume hint, bash / bashMode / loadingAnimation / queue / tree esc dispatch — all TUI-dependent.

Conclusion: **the shutdown skeleton can be cross-mode, the body is interactive**. The esc dispatch is entirely interactive (depends on editor + TUI state).

## 3. Philosophy layer: risks and principles

- **Premature abstraction risk (calibration)**: currently only `interactive` has one real consumer implementing the full shutdown body. There's no evidence that print/rpc/acp need the same graceful exit. Building `_shell/cancellation` big now equals creating a cross-mode service without evidence — calibration explicitly forbids this.
- **FATAL-004 risk**: creating a new `modes/_shell/` requires a P2 at the same time, otherwise the module boundary is invisible in docs.
- **UI04 entanglement**: esc's swap mode (compaction / retry) depends on UI04's deferred render / retry state. Force-extracting the esc dispatch before UI04 forces the controller to grab loadingAnimation / retry / compaction handles — replaying the service-locator.
- **Token-neutral**: this slice doesn't touch what gets sent to the model (apart from existing esc-triggered abort / steer semantics); UI-G8 is basically N/A; **the binding constraint is UI-G9 compatibility** — every key (esc branches, Ctrl-C single/double, Ctrl-D, Ctrl-Z, SIGHUP/TERM, extension delayed exit) must still produce the same action with the same timing.

## 4. Candidate controller shape (if extracting interactive side)

`modes/interactive/controllers/interrupt-controller.ts` (**interactive**, NOT `_shell`)

| Port | Capability |
|------|------------|
| `state` | get/set `lastEscapeTime`, `lastSigintTime` |
| `runtime` | isStreaming / isBashRunning, agent.abort, abortBash, abortCompaction |
| `queue` | is loadingAnimation active, restoreQueuedMessagesToEditor |
| `bash` | isBashMode, clear bash mode |
| `editor` | getText, clearEditor |
| `tree` | showTreeSelector / showForkSelector + getDoubleEscapeAction |
| `lifecycle` | requestShutdown (→ mount's shutdown orchestration) |

**`onEscape` body still wired by mount** (gates require this): mount only checks state, forwards to the controller's `dispatchEscape()`; the swap sites keep using `state.*` save/restore, but what they save / restore is the stable reference `controller.dispatchEscape`.

## 5. Dead / duplicate points

- `checkShutdownRequested` and `shutdownHandler`'s streaming delayed-exit are a pair — must be handled together; can't move only half.
- `lastEscapeTime` / `lastSigintTime` are two independent double-tap timers — don't merge their semantics.

## 6. Open: scope (maintainer to choose)

| Option | What to extract | Cost / benefit |
|--------|----------------|-----------------|
| **A. Full** | Create `modes/_shell/` for the signal + shutdown skeleton + interactive `interrupt-controller` | Benefit: cross-mode shutdown DRY in place. Cost: under-evidenced cross-mode abstraction + new P2 + entanglement with UI04 swap — heaviest |
| **B. Interactive only (recommended)** | Extract only `interrupt-controller` (esc dispatch + Ctrl-C/D/Z classification); shutdown / signals stay in mount | Benefit: collapses esc multi-target + double-tap timers + Ctrl classification under a single clear owner; `_shell` waits for a second mode to appear (YAGNI). Cost: shutdown still in mount |
| **C. Defer the whole slice** | Do #8 mount-shedding first, or wait for UI04 | Benefit: avoids swap × UI04 entanglement. Cost: mount still carries esc / Ctrl / shutdown |

## 7. Acceptance matrix (regardless of A/B)

| Scenario | Acceptance |
|----------|------------|
| esc: loading active | Restore queued messages to editor and abort |
| esc: streaming | `agent.abort()` |
| esc: bash running | `abortBash()` |
| esc: bash mode | Clear mode + restore border |
| esc: empty editor double-tap | Per setting → tree/fork; single-tap only records time |
| esc: during compaction / retry | Still uses each swap handler (abortCompaction / custom); main dispatch restored at end |
| Ctrl-C single / double | Single → clearEditor + record time; double (<500ms) → shutdown |
| Ctrl-D (empty editor) | shutdown |
| Ctrl-Z / SIGCONT | Suspend / resume TUI normally |
| SIGHUP / SIGTERM | Graceful shutdown (emit + cleanup + exit) |
| Extension delayed exit | Set flag during streaming; re-trigger after streaming ends |
| shutdown re-entry | Second call returns immediately |

## 8. Next step

~~maintainer picks scope in §6~~ → **B selected**, implemented.

## 9. Resolution (B implemented, 2026-06-04)

`modes/interactive/controllers/interrupt-controller.ts` created (6 port groups, zero imports):

- `dispatchEscape()`: §1.2 five-branch priority **preserved verbatim**; `lastEscapeTime` double-tap timer moved into the controller.
- `handleCtrlC()`: `lastSigintTime` double-tap → `lifecycle.requestShutdown`, single-tap → `editor.clearEditor`, moved into the controller.
- `handleCtrlD()` → `lifecycle.requestShutdown`; `handleCtrlZ()` → `lifecycle.suspend`.
- mount: `onEscape = () => this.interrupt.dispatchEscape()`; Ctrl bindings now point at `this.interrupt.*`; delete `handleCtrlC` / `handleCtrlD` and the `lastEscapeTime` / `lastSigintTime` fields; `handleCtrlZ` body renamed to mount `suspend()` (implemented by the `lifecycle.suspend` port).

**Stays in mount (B boundary)**: `shutdown()` graceful-exit orchestration, `isShuttingDown` re-entry guard, `SIGHUP` / `SIGTERM` registration, `shutdownRequested` / `shutdownHandler` / `checkShutdownRequested` extension-delayed exit, `suspend()`'s TUI mechanics.

**Swap mode needs no change**: the three manual / auto compaction / retry save / restore sites are on `this.defaultEditor.onEscape`; what they now capture is the `dispatchEscape` closure, so save / restore semantics are unchanged.

**Gates**: UI-G1 (no reverse import) / UI-G2 (named-capability closure, includes lifecycle, doesn't pass InteractiveMode) / UI-G3 (esc + Ctrl single owner, onEscape still mount-wired — meets gates) / UI-G5 (controller owns two timers + classification — the real complexity) / UI-G7 (mount shed 2 methods + 2 fields, zero new core imports, facade unchanged) / UI-G8 N/A (no model content changed) / UI-G9 compatible (every key produces the same action with the same timing) / UI-G11 (zero-import construction, lazy-friendly). `verify-quality` + `verify-dip` green. TUI / tsc acceptance handed to maintainer.

**Deferred**: `modes/_shell/cancellation` — defer until print / rpc / acp actually need shared graceful exit (YAGNI).
