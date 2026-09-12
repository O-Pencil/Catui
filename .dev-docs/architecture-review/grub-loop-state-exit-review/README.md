# grub loop-state protocol exit review

```yaml
review_id: grub-loop-state-exit-review
status: closed
trigger: user-reported defect (2026-09-12) — after a grub task completes, the agent
  keeps emitting <loop-state> protocol blocks in ordinary conversation; blocks are
  also user-visible machine noise
scope:
  - extensions/builtin/grub   (protocol exit, conditional prompts, terminal formatting)
  - core/lib/tui markdown      (HTML comment hiding, generic markdown semantics)
```

## Purpose

Fix the "grub task finished but the agent keeps speaking loop-state" defect.

Three root causes verified against the code:

1. No protocol-exit state transition: `buildGrubCodingPrompt` requires a
   `<loop-state>` block every turn with no conditional; on terminal state the
   harness only published an informational snapshot, so conversation history
   kept modelling loop-state behavior.
2. `nextStep` inside the state block trains "write plan, wait for dispatch";
   after completion the habit persisted.
3. Protocol blocks rendered as plain text in the chat.

## Boundary decisions

- **`extensions/builtin/grub/`** owns the protocol semantics: terminal
  transitions now publish an explicit `protocolExit` notice (i18n, both
  locales), prompts require the loop-state block only while the task is
  unfinished, and loop-state blocks must be wrapped in an HTML comment
  (`<!-- ... -->`) so they stay invisible to the user.
- **`core/lib/tui` markdown** hides HTML comment tokens (block + inline).
  This is generic markdown semantics (comments are invisible in HTML
  rendering), not grub business knowledge leaking into the TUI: markdown.ts
  has no reference to loop-state or grub. The grub extension owns the
  "protocol payload travels inside a comment" convention.
- Terminal formatting (`formatSnapshot` / `describeDecision`) no longer
  echoes `nextStep` for `complete` decisions: a finished task has no next
  step, and echoing one steers later turns back into grub mode.
- The live message object is never mutated: display-only hiding happens at
  render time, and `extractGrubDecision` parses raw assistant text, so the
  harness keeps working unchanged.

## Non-goals

- Context-history scrubbing of old loop-state blocks (kept as evidence).
- Hiding blocks in print/RPC modes (raw consumers).
- Deterministic render-side stripping of *unwrapped* `<loop-state>` blocks;
  if a model forgets the comment wrapper, visibility degrades to the
  pre-fix status quo, which is acceptable.

## Default-enabled extension user-visible change (GB-2)

grub is a default-builtin extension. This change alters user-visible
behavior: protocol blocks disappear from chat, and terminal turns print a
short "protocol has ended" notice. Intentional, declared in the PR.

## Acceptance

- [x] `resolveGrubTurn` terminal paths publish the protocol-exit notice (complete + failure stop); `/grub stop` and pause paths publish it too.
- [x] Coding/initializer/task prompts require comment-wrapped blocks and state the protocol ends after complete/blocked.
- [x] `formatSnapshot` / `describeDecision` drop `nextStep` for complete.
- [x] Markdown hides HTML comments but still renders non-comment raw HTML.
- [x] `test/grub-controller.test.ts` 51/51, `core/lib/tui/test/markdown.test.ts` 39/39.
- [x] `tsc --noEmit`, `verify:dip`, `verify:quality`, `verify:package-boundary`, `build` all green.
- [x] Pre-existing baseline failures unchanged (3 cursor-frame tests in `tui-nonregression.test.ts`, also failing on clean main).