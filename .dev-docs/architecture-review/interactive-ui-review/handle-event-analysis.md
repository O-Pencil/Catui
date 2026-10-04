# handleEvent render layer — dedicated review (pre-UI04 implementation)

```yaml
doc: handle-event-analysis
phase: P5
finding: UI04 (handle-event-render-god, deferred → now activated)
status: review
source: modes/interactive/interactive-mode.ts::handleEvent (2138-2475, ~337 lines, 12 cases)
decision: SELECTED A (single stream-render-controller, pure move; retry / compaction overlay state becomes private) — 2026-06-04
```

## 0. Premise

UI04 was long-deferred in the gates ("wait until controllers and state ownership settle, then cut"). Now image / self-update / extension-ui / state / model-overlay / auth / tree / settings / slash / input-submit / interrupt are all in place — preconditions met. This is the **last piece** of mount-shedding (#8, target < 500 lines): if handleEvent doesn't leave mount, the shell can't shrink to target.

Structural review, no characterization recorded. The binding constraints are **UI-G8 token neutrality** (rendering must not change what's sent to the model) and **UI-G9 compatibility** (the visible timing of streaming / tools / loader / retry / compaction stays unchanged).

## 1. Phenomenon layer: 12 cases collapse into 6 render concerns

| Concern | cases | Main actions |
|---------|-------|--------------|
| **run lifecycle / loader / working-msg** | agent_start, agent_end | loader start/stop, statusContainer, buddy working/happy, run timer, working message override, exit cleanup (clearAttachments / checkShutdownRequested) |
| **assistant streaming message** | message_start[assistant], message_update, message_end | streamingComponent / Message lifecycle, updateContent, toolCall → ToolExecutionComponent, abort/error marking, setArgsComplete |
| **user / custom echo** | message_start[user/custom] | custom → addMessageToChat; user → optimistic dedup (shift on match) |
| **tool execution display** | tool_execution_start / update / end | pendingTools map: insert / update / delete ToolExecutionComponent |
| **auto-compaction overlay** | auto_compaction_start / end | escape override, loader, rebuild chat, compaction summary, flushCompactionQueue |
| **auto-retry overlay** | auto_retry_start / end | escape override, loader, final failure showError |

## 2. Essence layer: state can't be cleanly split (key evidence)

handleEvent touches 13 render-state fields. Counting "reads/writes outside handleEvent":

| Field | External r/w count | Meaning |
|-------|--------------------|---------|
| `loadingAnimation` | **21** | Strong coupling with interrupt (`queue.isLoadingAnimationActive`), working-message, timer |
| `pendingTools` | **8** | Shared with toggleToolOutputExpansion, tool helpers |
| `toolOutputExpanded` | **8** | Toggle (Ctrl-T) + tool component |
| `streamingComponent` | **7** | Rebuild / working-message etc. |
| `streamingMessage` | **5** | Same |
| `optimisticUserMessages` | **5** | Written by input-submit render port, read for dedup by handleEvent |
| `agentRunStartMs` | **4** | start/stopAgentRunTimer, updateWorkingMessage |
| `workingMessageOverride` | **3** | working-message |
| `pendingWorkingMessage` | **1** | working-message |
| `retryEscapeHandler` | **0** | **only handleEvent** (also read by agent_start, still belongs to this layer) |
| `autoCompactionEscapeHandler` | **0** | **only handleEvent** |
| `retryLoader` | **0** | **only handleEvent** |
| `autoCompactionLoader` | **0** | **only handleEvent** |

**Conclusion**: render core state (loadingAnimation / pendingTools / streamingComponent / toolOutputExpanded) has **too many external r/w sites**. Force-splitting "by case into sub-controllers each owning a slice of state" would create cross-controller shared-state contracts (pendingTools written from streaming / tool / lifecycle; loadingAnimation read by interrupt) — replaying the service-locator. The only cleanly self-owned fields are retry / auto-compaction's escape + loader (external 0).

## 3. Three cross-cutting concerns (every "split by case" hits these)

1. **pendingTools has three writers**: message_update (build from toolCall content) + tool_execution_* (update) + agent_end / message_end (clear / mark error).
2. **escape swap × interrupt-controller**: auto_retry_start / auto_compaction_start save the current `onEscape` (= interrupt's `dispatchEscape` closure) and override with abortRetry / abortCompaction; agent_start / *_end restore. The render layer and interrupt share `defaultEditor.onEscape` — the seam needs defining (see §5).
3. **loaders share statusContainer**: loadingAnimation / retryLoader / autoCompactionLoader mutually exclusive clear + addChild on the same statusContainer.

## 4. Philosophy layer: why we still extract (even if just a move)

- Hard precondition for mount-shedding: a 337-line render god doesn't leave mount, #8 can't reach <500.
- handleEvent holds **real render-logic complexity** (event → component orchestration); extraction satisfies UI-G5 (not an empty shell).
- After extraction, streaming / tool / loader rendering can be unit-tested without the whole mount.
- Token neutrality is explicit: the render layer only reads session events and writes components; it never submits anything to AgentSession.

## 5. Candidate shape (if choosing A)

`modes/interactive/controllers/stream-render-controller.ts` (render layer)

- `handle(event): Promise<void>` — **faithfully move** the 12-case switch (pure move, preserve-check).
- Self-owned state (external 0 r/w): `retryEscapeHandler` / `autoCompactionEscapeHandler` / `retryLoader` / `autoCompactionLoader` move into the controller as private fields (real ownership gain).
- Remaining render state stays in `interactive-state`, read / written via context (it's already the consolidated holder, fits its role).

Suggested context grouping:

| Port | Capability |
|------|------------|
| `state` | streamingComponent / Message, pendingTools, loadingAnimation, optimisticUserMessages, toolOutputExpanded, agentRunStartMs, working* get/set (via interactive-state) |
| `layout` | chatContainer / statusContainer insert / remove / clear; addMessageToChat, updatePendingMessagesDisplay, rebuildChatFromMessages, requestRender, footer.invalidate |
| `loaders` | new PencilLoader (working / retry / compaction copy), buddy pet, working-message, run timer, formatElapsedSeconds |
| `toolTrace` | shouldRenderToolTrace, getRegisteredToolDefinition, showImages, ToolExecutionComponent factory |
| `runtime` | session.retryAttempt, abortCompaction, abortRetry, flushCompactionQueue, checkShutdownRequested, imagePipeline.clearAttachments |
| `escape` | getMainEscapeHandler / setEscapeHandler (the single controlled channel for sharing `defaultEditor.onEscape` with interrupt) |
| `surface` | showStatus / showError, promptHost.restoreEditorFocusIfPossible, getMarkdownThemeWithSettings, getUserMessageText, init / isInitialized |

mount keeps a thin `handleEvent(event) → this.streamRender.handle(event)` (subscribe stays in mount).

## 6. Open: scope (maintainer to choose)

| Option | What to extract | Evaluation |
|--------|-----------------|------------|
| **A. Single `stream-render-controller` (recommended)** | Move the whole handleEvent into one render controller (pure move); retry / compaction escape + loader become its private state; remaining render state stays in interactive-state via context | Benefit: render god leaves mount, shell-shedding can close, unit-testable; cost: context is broad (7 groups), but serves a single concern (streaming render), and §2 proves that splitting finer would hit shared state. **Lowest risk, achieves the goal** |
| **B. Split by concern into multiple controllers** | loader / status overlay, streaming-message, tool-trace, overlay-escape, each its own controller | Benefit: cleaner concept split; cost: pendingTools three writers + loadingAnimation crosses interrupt + statusContainer shared → cross-controller shared-state contracts, service-locator risk high, many slices |
| **C. Partial extraction + remainder stays in mount** | Only extract the clean pieces (overlay-escape + loader: retry / compaction, external 0); streaming / tool / lifecycle core stays in mount | Benefit: zero-risk small step; cost: mount still carries most of the render god, #8 doesn't reach <500, UI04 in name only |

## 7. Acceptance matrix (regardless of A/B/C)

| Scenario | Acceptance |
|----------|------------|
| agent_start | Loader appears, buddy working, timer starts, retry handler (if leftover) restored |
| Streaming assistant | Incremental updateContent; toolCall generates the tool component immediately |
| message_end abort / error | Unfinished tools marked red and cleared; otherwise setArgsComplete |
| user echo dedup | optimistic hit → shift, no duplicate render |
| custom message | Enters chat directly |
| tool start / update / end | Tool component: create / streaming result / final result (isError propagated) |
| agent_end | Loader stops, streamingComponent removed, pendingTools cleared, attachments cleared, buddy happy, "Completed in X", checkShutdownRequested |
| auto-compaction | esc → abortCompaction, end → restore; rebuild + summary / failure-error line; flushCompactionQueue(willRetry) |
| auto-retry | esc → abortRetry, end → restore; final failure showError |
| **escape coordination** | During compaction / retry, esc goes through override; after end, esc returns to interrupt.dispatchEscape |
| **token neutrality** | Never submits any message to AgentSession during the whole flow |

## 8. Next step

~~maintainer picks scope in §6~~ → **A selected**, implemented. Hand off to #8 mount-shedding evaluation.

## 9. Resolution (A implemented, 2026-06-04)

`modes/interactive/controllers/stream-render-controller.ts` created:

- `handle(event)`: 12-case switch moved **verbatim 1:1** (pure move, preserve-check); priority / branches / copy / timing unchanged.
- Private state (external 0 r/w): `autoCompactionLoader` / `autoCompactionEscapeHandler` / `retryLoader` / `retryEscapeHandler` **moved out** of `InteractiveState` into the controller's private fields.
- Remaining render state stays in `interactive-state`, read / written via `state.get()` (the holder's P3 already declares "will be read by the render-layer controller (UI04)").
- 7 context groups: `state` / `layout` (containers + addMessageToChat / rebuild / render / footer) / `loaders` (PencilLoader copy + buddy + timer + working-message + interrupt key hint) / `toolTrace` (shouldRender / toolDef / showImages) / `runtime` (retryAttempt / abortCompaction / abortRetry / flushQueue / checkShutdown / clearAttachments) / `escape` (get / set onEscape — the single controlled channel) / `surface` (ensureInitialized / focus / userText / markdownTheme / status / error).
- mount: `handleEvent(event) → this.streamRender.handle(event)` (subscribeToAgent stays in mount); the 4 fields are removed from `InteractiveState` (all 25 references are inside the removed handleEvent).

**escape × interrupt seam**: compaction / retry's escape override stores / retrieves `defaultEditor.onEscape` via the `escape` port — what's stored is interrupt's `dispatchEscape` closure; agent_start / *_end restore it — same behavior as interrupt-controller.

**Gates**: UI-G1 (no reverse import) / UI-G2 (named-capability closure, `state.get()` returns the plain holder, not InteractiveMode / AgentSession — compliant) / UI-G3 (render single owner) / UI-G5 (holds the full render logic — real complexity + 4 fields of real ownership) / UI-G7 (mount: no new core imports, facade unchanged) / UI-G8 (token neutral — render doesn't submit) / UI-G9 (compatible — case-by-case timing preserved) / UI-G11 (construction is closure-only, no eager work). `verify-quality` (544 files, no cycles) + `verify-dip` green. TUI / tsc acceptance handed to maintainer.

**Unlock**: #8 mount-shedding can now be evaluated (handleEvent god has left mount).
