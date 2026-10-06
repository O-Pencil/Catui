# Local model enhancement closure

Design review completed before implementation. The optional extension, catalog entry,
shared plan-mode readback allowance, P1/P2/P3 maps, usage guide, and CI-reachable
regression suite are implemented.

## Verification

- Eleven extension regressions pass, covering the real file loader, wrapped file
  reads, on/off restoration, persisted session reload and branch isolation, error
  and image preservation, bounded readback, unavailable evidence, prefix stability,
  plan permissions, and a scripted three-request SDK tool/readback loop. The latter
  uses no network, no actual model, and disables automatic compaction to isolate
  the extension's request projection from the existing compaction subsystem.
- A 24014-character error fixture projects to 4302 characters while preserving
  the complete stored result and recovering its omitted middle. This is payload
  accounting, not a throughput or task-completion benchmark.
- Related runtime-owner/context/registry and plan-mode regressions pass.
- All five required gates pass: `verify:dip`, `verify:quality`,
  `verify:package-boundary`, `build`, and `tsc --noEmit`.
- Additional `verify:structure`, `verify:package-boundary:dist`, and
  `verify:contract` pass. The size ratchet still reports 39 existing oversize
  files; its baseline is unchanged. DIP reports no current violations.
- `npm ci` encountered a pre-existing lockfile/node-types mismatch under the
  installed npm version. Worktree dependencies were installed using
  `npm install --ignore-scripts --package-lock=false`; dependency declarations
  and the lockfile were not changed.

## PR self-check

- P1 optional extension table, parent P2 maps, source P3 headers, and the shared
  permission owner's P2/P3 contracts are updated.
- The only runtime integration is the existing read-only plan-policy allowlist.
  No new provider, public exports, protocol contracts, dependencies, reverse
  imports, default-enabled extension, model calls, or timers were added.
- The extension adds one small reader schema and a short instruction when enabled.
  Long tool results are projected; short results can incur net prompt overhead.
  Request token counts and GPU/RAM use are not guaranteed by character budgets.
- Loading, commands, real tool execution, SDK continuation, and off-mode were
  exercised. The readback tool intentionally stays registered while off so old
  previews remain recoverable; unloading removes that schema.
- The dedicated review is linked from the PR. Human review should assess the
  head/tail trade-off and the bounded first-release scope.

Deferred: exact tokenizer-aware request enforcement, FreeToken provider changes, background model concurrency coordination, and real-model task benchmarks. Reopen when measured failures identify a need; do not widen the public API speculatively.
