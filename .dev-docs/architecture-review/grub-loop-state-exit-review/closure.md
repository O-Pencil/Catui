# Closure — grub loop-state protocol exit

**Date**: 2026-09-12
**Status**: closed

## Implemented

- `extensions/builtin/grub/grub-i18n.ts` — added `protocolExit` notice text (en/zh).
- `extensions/builtin/grub/grub-turn.ts` — terminal stop paths (complete/blocked via
  `finishTurn`, failed via `handleFailure`) now emit the protocol-exit event.
- `extensions/builtin/grub/index.ts` — `/grub stop` and the pause paths
  (`agent_abort`, aborted `agent_result`) publish the protocol-exit notice.
- `extensions/builtin/grub/grub-prompts.ts` — loop-state requirement is
  conditional (only while unfinished), blocks must be wrapped in `<!-- ... -->`,
  and complete/blocked end the protocol for good.
- `extensions/builtin/grub/grub-format.ts` — `formatSnapshot` and
  `describeDecision` omit `nextStep` for `complete` (no stale "next step"
  steering post-completion conversation). `nextStep` still appears for
  continue/stopped/failed/blocked, where remaining work is legitimate info.
- `core/lib/tui/src/components/markdown.ts` — HTML comment tokens are skipped
  in both block and inline positions; other raw HTML still renders as text.
- `extensions/builtin/grub/grub-i18n.ts` — added `completionReport` one-line
  report templates (en/zh): runtime, turns, tool calls, token totals.
- `extensions/builtin/grub/grub-format.ts` — added `buildCompletionReport()`,
  which renders the one-line completion report from cumulative run metrics
  (returns undefined unless status is complete and metrics exist).
- `extensions/builtin/grub/grub-turn.ts` — completed runs publish the report
  event in the chat stream before the detailed terminal snapshot.

## Verifications

- `test/grub-controller.test.ts` — 54/54 pass (added: comment-wrapped parse,
  protocol-exit events, complete hides nextStep, prompt wording, completion
  report en/zh + undefined-without-stats).
- `core/lib/tui/test/markdown.test.ts` — 39/39 pass (added: HTML comment
  hiding block/inline + non-comment HTML still visible).
- `npm run verify:dip` / `verify:quality` / `verify:package-boundary` — green.
- `npx tsc --noEmit` — clean. `npm run build` — green.
- TUI full suite: 433/436 pass; the 3 failures (`tui-nonregression.test.ts`
  cursor-frame assertions) also fail on clean main, unrelated to this change.

## Deferred / reopen conditions

- Hide *unwrapped* `<loop-state>` blocks deterministically at render time.
  Reopen if real-world runs show frequent unwrapped block leakage.
- Strip historical loop-state blocks from persisted conversation on load.
  Reopen if compacted/imported sessions re-trigger protocol imitation.
- Print/RPC output filtering for grub blocks (raw consumers keep full text).