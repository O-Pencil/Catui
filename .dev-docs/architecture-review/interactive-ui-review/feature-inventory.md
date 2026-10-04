# interactive-mode Feature Inventory v1

```yaml
doc: feature-inventory
version: v1     # full code scan + 5 subjective items settled (extension acceptance = A contract + C built-in manual tests); UI01 blocker cleared
parent: ./README.md
purpose: |
  P5 acceptance baseline (functional acceptance, not characterization) + maintainer feature catalog.
  After refactor, verify each "function correct" without comparing implementations. Completeness = acceptance strength (UI01 core risk).
source_of_truth: modes/interactive/interactive-mode.ts @ 7960 lines (pre-split snapshot)
legend:
  owner: prospective controller to extract into (see P5 §status-survey cluster table in git history)
  verify: post-refactor confirmation column (⬜ pending / [x] pass / ✗ regression / **Warning:** intentional change — declared)
```

> **How to use**: each row = `trigger → expected behavior (acceptance criterion)`. After refactor reproduce by "trigger" and confirm "expected" → [x].
> Intentionally changed behavior / symbols → mark **Warning:** and document in the corresponding review card / Phase (GB-2), does not count as regression.
> **v0 is the reverse-engineered skeleton; maintainer must verify completeness** (missing entry = that feature has no protection).

---

## P5 Acceptance Priority (operator checklist)

> **Execution order**: after each major slice, run P0 critical-path tests first; then run owner-specific acceptance; finally fill in the A-F tables below. P5 accepts rewrites, so the acceptance goal is "function correct + boundary clearer", not byte-for-byte / symbol-for-symbol identical.

### P0 Critical path (run after each major slice)

| Path | Acceptance criterion | verify |
|------|----------------------|--------|
| TUI startup | Interactive mode enters; home screen status / footer / editor render normally | ⬜ |
| Plain prompt | Submit plain text, receive assistant response, message enters session | ⬜ |
| Streaming stability | During streaming, text appears incrementally; after end, editor focus restores and input is ready | ⬜ |
| Interrupt / cancel | `esc` / `ctrl+c` during run interrupts or takes the existing cancel path; TUI doesn't hang | ⬜ |
| Input routing | Plain text / slash / bash prefix / attachment input don't route into each other incorrectly | ⬜ |
| Error recoverable | Errors surface in UI; next input can still proceed | ⬜ |
| Session persistence | Current session can save; after re-entry or resume, history is visible | ⬜ |

### P0 Non-functional constraints (every slice review checks)

| Constraint | Acceptance criterion | verify |
|------------|----------------------|--------|
| Token neutrality | UI split must not add default prompt / context / system message / tool-result content; must not change user-message / attachments / follow-up / compaction-instruction semantics sent to the model; user's actual token consumption does not increase because of the split | ⬜ |
| Compatibility preservation | TUI entry, slash / keybinding, extension UI API, public exports, config file format stay compatible; intentional breakage must be recorded per GB-2 and accepted | ⬜ |
| Data fallback preservation | settings / auth / provider / session / extension surface defaults, missing-file, read-failure, cancel path, half-write fallbacks must not be weakened | ⬜ |
| Performance neutrality | P5 is not performance optimization, but must not noticeably degrade cold start, first-paint, overlay-open, input-submit, streaming-render; controller construction must not introduce eager heavy work | ⬜ |
| Responsibility-only change | This phase's goal is responsibility split + follow-up code constraints; apart from declared GB-2 items, do not use the refactor to change product semantics | ⬜ |

### Owner-specific acceptance

| Owner | Must-test focus |
|-------|-----------------|
| model-overlay | `/model` overlay; `/model provider/model-id` exact pick; must ensure provider config success before picking model; cancelled config must not switch or write default model; provider → model flow; `/scoped-models`; cycle model; cycle thinking; footer / border / status update |
| auth / provider-config | `/apikey`; `/login`; `/logout`; custom-provider base URL / API key / model name config; cancellation must not produce half-writes; registry refresh after config + consumed by model-overlay |
| settings-overlay | `/settings`; theme preview/apply; image-related toggles; thinking-block show/hide + rebuild; editor padding / autocomplete; token stats / buddy / presence / quiet startup etc. settings can save |
| tree-overlay | `/resume`; `/tree`; `/fork`; `/new`; selector nav / filter / sort / rename / delete + banner state |
| slash-dispatcher | Built-in slash commands route to owner; unknown command behavior unchanged; extension commands not swallowed; `/compact`, `/mcp`, `/resources`, `/status`, `/usage` stay reachable; existing easter eggs preserved |
| input-submit | Plain prompt; slash not sent as prompt; extension slash command; `!` / `!!` bash; attachment submit; streaming steer / follow-up / queue; compaction queue; optimistic rollback |
| extension-ui | select / input / editor / confirm; single-active prompt; focus / text restore; custom overlay handle / onHandle; inline custom restore; widget / footer / header / status set / clear; `setEditorComponent` callbacks / keybindings; reset clears all extension surfaces |
| render layer | `agent_start` / `message_update` / tool events / end; tool expand / collapse; thinking show / hide; image tool result; error / abort / retry / compaction order; chat rebuild |

### Acceptance record template

```text
Slice:
Build:
Feature inventory rows:
- ...
Non-functional checks:
- Token neutrality:
- Compatibility:
- Data fallback:
- Performance:
Intentional changes:
Issues:
```

---

## A. Slash commands (33 entries; owner: slash-dispatcher unless noted)

| Command | Trigger | Expected behavior (acceptance criterion) | owner | verify |
|---------|---------|-------------------------------------------|-------|--------|
| `/model [term]` | Input | Open model picker overlay; with term, pre-filter | model-overlay | ⬜ |
| `/scoped-models` | Input | Open scoped-models picker | model-overlay | ⬜ |
| `/thinking [lvl]` | Input | Cycle / set thinking level | model-overlay | ⬜ |
| `/agent-loop` | Input | Cycle agent-loop framework | slash-dispatcher | ⬜ |
| `/settings` | Input | Open settings picker | settings-overlay / mount | ⬜ |
| `/apikey` | Input | Enter API key entry flow | auth | ⬜ |
| `/login [provider]` | Input | OAuth login (direct if provider given, else picker) | auth | ⬜ |
| `/logout` | Input | OAuth logout picker | auth | ⬜ |
| `/mcp [args]` | Input | List / enable / disable MCP server | slash-dispatcher (via facade, UI03) | ⬜ |
| `/export [path]` | Input | Export session as HTML | slash-dispatcher | ⬜ |
| `/share` | Input | Upload / generate share link | slash-dispatcher | ⬜ |
| `/copy` | Input | Copy last assistant text | slash-dispatcher | ⬜ |
| `/status` | Input | Show session / system status | slash-dispatcher | ⬜ |
| `/usage` | Input | Show token / cost usage | slash-dispatcher | ⬜ |
| `/name [text]` | Input | Set session name | slash-dispatcher | ⬜ |
| `/session` | Input | Session info / actions | slash-dispatcher | ⬜ |
| `/resume` | Input | Open session-resume picker | tree-overlay | ⬜ |
| `/new` | Input | New session (clear) | tree-overlay / lifecycle | ⬜ |
| `/fork` | Input | Fork from a user message | tree-overlay | ⬜ |
| `/tree` | Input | Open branch-tree picker | tree-overlay | ⬜ |
| `/changelog` | Input | Show changelog | slash-dispatcher | ⬜ |
| `/hotkeys` | Input | Show keybinding table | slash-dispatcher | ⬜ |
| `/resources` | Input | Show loaded resources (extensions / skills / themes) | slash-dispatcher | ⬜ |
| `/reload` | Input | Reload config / resources | slash-dispatcher (runtime reload) | ⬜ |
| `/compact [instr]` | Input | Manual context compaction (may include instruction) | slash-dispatcher (via AgentSession) | ⬜ |
| `/soul` | Input | Show soul state | slash-dispatcher | ⬜ |
| `/persona [text]` | Input | Cycle / show persona | slash-dispatcher | ⬜ |
| `/memory` | Input | Show memory state | slash-dispatcher | ⬜ |
| `/language [lang]` | Input | Cycle interface language | slash-dispatcher | ⬜ |
| `/update` | Input | Check and update version | self-update | ⬜ |
| `/reinstall` | Input | Reinstall | self-update | ⬜ |
| `/quit` | Input | Quit | _shell/cancellation | ⬜ |
| `/arminsayshi` | Input | Easter egg | slash-dispatcher | ⬜ |

> Additional: extension-registered `/command` routes via `isExtensionCommand` to ExtensionRunner (owner: extension-ui + slash-dispatcher cooperation; a unified dispatch table is the seam target for F02 / UI02). Bash mode (`!` prefix) is handled by `handleBashCommand` (owner: slash-dispatcher).

---

## B. Key bindings (22 AppActions; owner noted)

| Action | Default key | Expected behavior | owner | verify |
|--------|-------------|-------------------|-------|--------|
| interrupt | `esc` | Interrupt current agent run; double-tap esc can trigger tree / config action | _shell/cancellation | ⬜ |
| clear | `ctrl+c` | Clear / quit confirm (double-tap to quit) | _shell/cancellation | ⬜ |
| exit | `ctrl+d` | Quit | _shell/cancellation | ⬜ |
| suspend | `ctrl+z` | Suspend process | _shell/cancellation | ⬜ |
| showResources | `ctrl+h` | Show loaded resources | slash-dispatcher | ⬜ |
| cycleThinkingLevel | `shift+tab` | Cycle thinking level | model-overlay | ⬜ |
| cycleModelForward | `ctrl+p` | Next model | model-overlay | ⬜ |
| cycleModelBackward | `shift+ctrl+p` | Previous model | model-overlay | ⬜ |
| selectModel | `ctrl+l` | Open model picker | model-overlay | ⬜ |
| selectProviderThenModel | `ctrl+shift+l` | Provider → model picker | model-overlay | ⬜ |
| expandTools | `ctrl+o` | Expand / collapse tool output | mount (render) | ⬜ |
| toggleThinking | `ctrl+t` | Show / hide thinking block | mount (render) | ⬜ |
| toggleSessionNamedFilter | `ctrl+n` | Toggle session named-filter | tree-overlay | ⬜ |
| externalEditor | `ctrl+g` | Open external editor | mount | ⬜ |
| followUp | `alt+enter` | Append follow-up message | mount (queue) | ⬜ |
| dequeue | `alt+up` | Pop queued message | mount (queue) | ⬜ |
| pasteImage | `ctrl+v` | Paste clipboard image | image-pipeline | ⬜ |
| newSession | (no default) | New session | tree-overlay / lifecycle | ⬜ |
| tree | (no default) | Branch tree | tree-overlay | ⬜ |
| fork | (no default) | Fork | tree-overlay | ⬜ |
| resume | (no default) | Resume session | tree-overlay | ⬜ |
| Attachment navigation | Arrow keys (attachment state) | Move / delete on the attachment bar | image-pipeline | ⬜ |

### B-editor. Editor-layer keys (EditorAction, 39 entries — mostly the TUI library, not P5 scope)

> `@pencil-agent/tui`'s `EditorComponent` has its own 39 `EditorAction` (cursor / delete / select / page / undo / yank / ...).
> **Most are pure text editing; owner = tui library; P5 does not touch or accept them.** Only the few that intersect with interactive-mode behavior need acceptance:

| EditorAction | Default key | Expected | owner | verify |
|--------------|-------------|----------|-------|--------|
| submit | `enter` | Trigger input-submit pipeline (→ F table) | input-submit | ⬜ |
| newLine | `shift+enter` | Multi-line break (no submit) | tui / editor | ⬜ |
| expandTools | `ctrl+o` | Expand tool output (same name as AppAction; confirm single path) | mount (render) | ⬜ |
| toggleSessionPath | `ctrl+p` (in selector) | Session selector: toggle path display | tree-overlay | ⬜ |
| toggleSessionSort | `ctrl+s` (in selector) | Session selector: toggle sort | tree-overlay | ⬜ |
| renameSession | `ctrl+r` (in selector) | Session selector: rename | tree-overlay | ⬜ |
| deleteSession / ...Noninvasive | `ctrl+d` / `ctrl+backspace` (in selector) | Session selector: delete | tree-overlay | ⬜ |
| selectConfirm / selectCancel | `enter` / `esc`, `ctrl+c` | Overlay confirm / cancel nav | each overlay controller | ⬜ |

> The other 30 (cursor* / delete* / page* / copy / yank / undo / jump*) are pure editor and not in P5 acceptance.

---

## C. Overlay / Pickers (owner noted)

| Overlay | Trigger | Expected behavior | owner | verify |
|---------|---------|-------------------|-------|--------|
| Model picker | `/model` `ctrl+l` | List models, select to switch | model-overlay | ⬜ |
| Provider → model | `ctrl+shift+l` | Pick provider first, then model | model-overlay | ⬜ |
| scoped-models | `/scoped-models` | Multi-model scope config | model-overlay | ⬜ |
| Settings picker | `/settings` | Browse / modify settings | settings-overlay / mount | ⬜ |
| Session resume picker | `/resume` | List past sessions, resume | tree-overlay | ⬜ |
| Branch tree picker | `/tree` | Tree navigation, pick leaf | tree-overlay | ⬜ |
| User message picker | `/fork` | Pick fork point | tree-overlay | ⬜ |
| OAuth picker | `/login` `/logout` | Pick provider for login / logout | auth | ⬜ |
| Login dialog | Login flow | Enter credentials / OAuth redirect | auth | ⬜ |
| Provider config | Triggered by model picker or provider picker | API key / base URL / custom model config belongs to auth / provider-config; model-overlay only switches model and writes default model after config succeeds; cancelled config must not switch or persist a default model | auth / provider-config + model-overlay | ⬜ |
| Update options | `/update` | Pick update method | self-update | ⬜ |
| Retry options | On update failure | Retry / give up | self-update | ⬜ |
| Extension picker / input / editor / confirm / notify / error | Extension API | Extension-driven prompt / overlay surface; select / input / editor are single-active-prompt; custom overlay preserves handle semantics; notify does not enter the overlay stack | extension-ui | ⬜ |

---

## D. Streaming render features (handleEvent, 13 events; owner: mount / render — UI04 deferred)

> **Acceptance granularity (settled)**: this P5 round **does not touch** handleEvent (UI04 deferred), so D uses **coarse functional acceptance** — for each event, confirm "render happens and shape is right" (e.g. message_update incrementally refreshes text, tool_execution_end produces an expandable result); **no per-frame / per-state byte comparison**.
> Per-state fine-grained verification (tool expand ↔ collapse, thinking show / hide, loader frames) **deferred until UI04 actually rewrites the render layer**; only then are these events the subject of change and require fine-grained acceptance. This round they are "unchanged" bystanders; coarse is enough.

| Event | Expected render | verify |
|-------|-----------------|--------|
| agent_start | Start loading / working animation + timer | ⬜ |
| message_start | Start streaming assistant component | ⬜ |
| message_update | Incremental refresh of assistant text / thinking / toolCall | ⬜ |
| message_end | Finalize assistant message | ⬜ |
| tool_execution_start | Start tool-execution component | ⬜ |
| tool_execution_update | Refresh tool progress | ⬜ |
| tool_execution_end | Finalize tool result (expandable) | ⬜ |
| agent_end | Stop animation / timer, return to idle | ⬜ |
| auto_compaction_start / end | Compaction loader + queued-message hint | ⬜ |
| auto_retry_start / end | Retry loader + esc handling | ⬜ |

---

## E. Other features (owner noted)

| Feature | Trigger | Expected | owner | verify |
|---------|---------|----------|-------|--------|
| Attachment / image pipeline | Paste / drag-in / `ctrl+v` | Add to attachment bar, send with message | image-pipeline | ⬜ |
| Image extraction from text | Text containing paths | Parse as attachments | image-pipeline | ⬜ |
| Autocomplete | Input `/` `@` etc. | Candidate hints | mount (setupAutocomplete) | ⬜ |
| Message queue / dequeue | Input during run | Queue, processed after agent ends | mount (queue) | ⬜ |
| Startup version check | Startup | Background check, prompt on new version | self-update | ⬜ |
| Buddy pet | State change | Pet animation follows state | mount (buddyPet) | ⬜ |
| Extension widget / footer / header | Extension API | Injection-zone render | extension-ui | ⬜ |
| Session-nav banner | switch / fork / tree | Top hint | tree-overlay | ⬜ |
| Startup banner / resource-load display | Startup / `/resources` | Welcome + diagnostics | mount | ⬜ |

---

## F. Input-submit pipeline (owner: `input-submit-controller` (UI06); slash-dispatcher only handles built-in `/command` dispatch)

| Feature | Trigger | Expected | owner | verify |
|---------|---------|----------|-------|--------|
| Built-in slash handled first | Input `/model` etc. built-in command | Matches built-in command, does not continue as plain message | slash-dispatcher + input-submit | ⬜ |
| Embedded persona | Input `text /persona ...` | Execute persona switch, and submit pre-text as a user message | input-submit / persona | ⬜ |
| Bash command | Input `!cmd` | Execute bash, not as a normal message; if a bash is already running, preserve editor text and hint | input-submit / bash | ⬜ |
| Bash exclude-from-context | Input `!!cmd` | Execute bash and mark excludeFromContext | input-submit / bash | ⬜ |
| Input during compaction | Plain text input while compaction runs | Plain text goes to compaction queue; extension commands still execute immediately | input-submit / queue | ⬜ |
| Streaming steer | Text input while agent is streaming | Optimistic render the user message first, then submit as steer | input-submit / queue | ⬜ |
| Streaming attachment | Attachment / image-path input during streaming | Process images; drop with hint if the model doesn't support images | input-submit + image-pipeline | ⬜ |
| Normal attachment submit | Attachment / image-path input when idle | Image goes into message content; after submit, clear attachment bar and clean up temp files | input-submit + image-pipeline | ⬜ |
| External-input callback | Submit while `onInputCallback` exists | Call the callback, do not go through agent prompt | mount / input-submit | ⬜ |
| Submit failure rollback | Plain message prompt throws | Remove the corresponding optimistic user message and show an error | input-submit / render | ⬜ |

> **Warning — duplicate handler smell (evidence for slash rewrite)**: `/memory`, `/arminsayshi`, `/resume`, `/quit` are branched in **both** `executeBuiltinSlashCommand` (L165-180) **and** the submit handler (L2808-2827). The submit handler calls `executeBuiltinSlashCommand` first and returns on hit (L2782-2784), so those 4 branches in the submit handler are **likely unreachable dead code**. **Slash rewrite (UI02) must eliminate this duplication**; on acceptance, confirm these 4 commands still go through only one path (dispatch table) with unchanged behavior.

---

## Code fully scanned vs awaiting maintainer judgement

**v0.5 settled from code** (no need to read 7960 lines row by row):
- A's 33 entries = all branches in `executeBuiltinSlashCommand` (standard command set complete; extension commands go through `isExtensionCommand`)
- B's 22 AppActions + relevant EditorActions in B-editor (the other 30 pure editor ones excluded)
- F's submit pipeline = `setupEditorSubmitHandler` read in full (embedded persona / bash / compaction queue / steer / attachment / rollback)
- Duplicate-handler smell (4 commands double-handled) flagged

**Already decided (2026-06-02)**:

- [x] **Per-feature hybrid decision**: don't mark per-row; **inherit the cluster decision** of the owner (see git history).
- [x] **D render acceptance granularity**: this round uses **coarse functional acceptance**; per-state fine-grained verification deferred to UI04 (see D section).
- [x] **input-submit as a separate card**: extract `input-submit-controller`; after UI07 adds `settings-overlay-controller` the controller set is 9 (see git history).
- [x] **Double-tap esc / esc dispatch ownership**: `onEscape` is single-key multi-target dispatch — **mount wires it** (check state, then forward), branches delegate to owner (abort → cancellation, empty double-tap → tree-overlay, queue restore → queue). See git history.

**Still needs your call (point 4, 3 choices) — how to accept extension dynamic commands / keybindings / widgets**:

| Option | Approach | Pro | Con |
|--------|----------|-----|-----|
| **A. Contract acceptance (recommended)** | Accept the `ExtensionUIContext` **contract**: the host correctly routes "any registered command / widget / overlay"; test the dispatch mechanism, not specific extensions | Decoupled from which extensions are installed; stable; reproducible | Does not verify specific extensions end-to-end |
| **B. Fixture extension** | Build a minimal **test extension**, register known `/cmd` + widget + prompt, accept against it | End-to-end; isolated; reproducible | Need to maintain the fixture |
| **C. Built-in extension manual tests** | For each shipped built-in extension (interview / loop / plan / team / security-audit / soul / …), manually run its commands + UI | Verifies real extensions | Not automatable; depends on humans |

> **Already decided: A + C** (2026-06-02) — A verifies "dispatch contract unbroken" (automated, stable) + C manually tests the real built-in extensions (interview / loop / plan / team / security-audit / soul / …) as a fallback; B (fixture) waits until we want automated regression later.

> After your review, this table becomes P5's acceptance gate + maintainer feature catalog. After extracting each controller, fill in the verify column for the entries under that owner.
