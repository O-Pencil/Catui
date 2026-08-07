# Closure

Status: closed on 2026-08-07.

## Delivered

- `ToolPolicyPipeline` provides deterministic before/after policy ordering, input and
  result transforms, fail-closed policy errors, typed extension denials, and distinct
  approval pauses. Both standard and weak-model-compatible loops consume it.
- `planFilePath` selects strict SDK plan writes; callers omitting it retain the legacy
  markdown profile with a once-per-process deprecation diagnostic.
- `LoopProgressTracker` canonicalizes tool evidence and stops repeated failures or
  denials with `livelock_detected`. It is disabled by default and reported in run
  policy/transition telemetry.
- `AgentRunCheckpoint`, `CheckpointStore`, `resolveRunCheckpoint`, in-memory storage,
  and `FileCheckpointStore` implement versioned, expiring, path-confined, atomic,
  at-most-once approval handoff across runtime instances. `FileCheckpointStore` is an
  additive root SDK export.

## Verification

- Root tests: pass.
- Plan tests: 10/10 pass.
- Checkpoint filesystem tests: 2/2 pass.
- Agent-core tests: 111 pass, 43 intentionally skipped integration cases.
- TypeScript `--noEmit`, production build, DIP, quality, static package boundary and
  built-artifact package boundary: pass.

## Compatibility and cost

All controls are opt-in, so existing loop behavior and prompt/token volume remain
unchanged. The public API change is additive. Enabled livelock tracking retains only a
bounded fingerprint window. Checkpoint JSON contains the pending tool input by design;
callers must choose a private directory with appropriate filesystem permissions.

## Reopen conditions

Reopen for the next major release when removing the legacy markdown plan profile, or
when a product surface needs a built-in approval UI that calls `resolveRunCheckpoint`
instead of supplying its own policy/approval adapter.
