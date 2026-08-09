# Closure

Status: closed on 2026-08-07.

## Delivered

- `ToolPolicyPipeline` provides deterministic before/after policy ordering, input and
  result transforms, fail-closed policy errors, typed extension denials, and distinct
  approval pauses. Both standard and weak-model-compatible loops consume it.
- `planFilePath` selects strict SDK plan writes; callers omitting it retain the legacy
  markdown profile with a once-per-process deprecation diagnostic.
- `LoopProgressTracker` canonicalizes inputs and outputs and stops repeated failures,
  denials, multi-step cycles, or identical successful no-progress calls with
  `livelock_detected`. It is disabled by default and reported in run policy/transition
  telemetry.
- `AgentRunCheckpoint`, `CheckpointStore`, `resolveRunCheckpoint`, in-memory storage,
  and `FileCheckpointStore` implement versioned, expiring, path-confined, atomic,
  at-most-once approval handoff across runtime instances. A pause terminates the run
  before later siblings execute; `Agent.resumeCheckpoint()` atomically validates the
  session and conversation boundary before consumption, resumes at the next policy,
  serializes against concurrent agent work, executes or denies the pending call once,
  pairs only unpaired siblings, and continues the original loop. `FileCheckpointStore`
  is an additive root SDK export.
- Extension input/output hooks are runtime policy adapters rather than hidden tool
  wrappers, so SDK caller permission checks see transformed input and result policies
  receive the actual executed input and explicit error state.

## Verification

- Root tests: pass.
- Plan tests: 10/10 pass.
- Checkpoint filesystem tests: 3/3 pass.
- Agent-core suite: 120 pass, 43 integration tests skipped by their existing guards.
- TypeScript `--noEmit`, production build, DIP, quality, static package boundary and
  built-artifact package boundary: pass.

## Compatibility and cost

All controls are opt-in, so existing prompt/token volume remains unchanged. Policies
that declare `mayPause: false` keep structured-loop concurrency; potentially pausing
policies serialize a batch to prevent side effects racing approval. The public API
change is additive. Enabled livelock tracking retains only a bounded fingerprint
window. Checkpoint JSON contains the pending tool input by design; callers must choose
a private directory with appropriate filesystem permissions.

## Reopen conditions

Reopen for the next major release when removing the legacy markdown plan profile, or
when a product surface needs a built-in approval UI that calls `resolveRunCheckpoint`
instead of supplying its own policy/approval adapter.
