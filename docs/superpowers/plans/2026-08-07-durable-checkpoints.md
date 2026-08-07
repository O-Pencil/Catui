# Durable Human-in-the-loop Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a paused tool approval and resume it once after a runtime restart without replaying side effects.

**Architecture:** Agent core defines a versioned serializable checkpoint and atomic store port. A `pause` policy decision returns a checkpoint instead of executing; runtime restores and consumes it immediately before the guarded tool boundary.

**Tech Stack:** TypeScript, Vitest, atomic JSON filesystem conventions already used by Catui session state.

---

### Task 1: Checkpoint contract and stores

**Files:**
- Create: `core/lib/agent-core/src/run-checkpoint.ts`
- Create: `core/lib/agent-core/test/run-checkpoint.test.ts`
- Modify: `core/lib/agent-core/src/index.ts`

- [ ] Add failing tests for version validation, expiry, atomic consume, replay rejection, and redacted serialization.
- [ ] Run the focused test and confirm failure.
- [ ] Implement `AgentRunCheckpoint`, `CheckpointStore`, and `InMemoryCheckpointStore` without serializing closures or credentials.
- [ ] Run the focused test and confirm pass.
- [ ] Commit `feat(agent-core): add durable run checkpoint contract`.

### Task 2: Pause and resume execution

**Files:**
- Modify: `core/lib/agent-core/src/tool-policy.ts`
- Modify: `core/lib/agent-core/src/types.ts`
- Modify: `core/lib/agent-core/src/agent-loop.ts`
- Modify: `core/lib/agent-core/src/structured-adaptive-agent-loop.ts`
- Test: `core/lib/agent-core/test/agent-loop.test.ts`

- [ ] Add failing tests proving pause never executes, approved resume executes once, denial remains denied, expiry/replay fail closed, and both loop frameworks match.
- [ ] Run the named tests and confirm pause is unsupported.
- [ ] Add the `pause` decision, checkpoint result metadata, and resume input path immediately before policy/tool execution.
- [ ] Run all agent-core tests.
- [ ] Commit `feat(agent-core): pause and resume guarded tool calls`.

### Task 3: Runtime persistence adapter and docs

**Files:**
- Create: `core/runtime/checkpoint-store.ts`
- Modify: `core/runtime/sdk.ts`
- Test: `test/sdk.test.ts`
- Modify: `core/runtime/AGENT.md`
- Modify: `.dev-docs/architecture-review/agent-harness-review/closure.md`

- [ ] Add failing SDK tests using two runtime instances and one temporary store directory.
- [ ] Run the focused suite and confirm the checkpoint cannot survive reconstruction.
- [ ] Implement opt-in atomic JSON persistence, path confinement, version validation, and SDK resume options.
- [ ] Run focused tests, document compatibility and closure evidence.
- [ ] Commit `feat(runtime): persist human approval checkpoints`.

### Task 4: Full acceptance

**Files:**
- Modify: `.dev-docs/architecture-review/agent-harness-review/README.md`
- Modify: `.dev-docs/architecture-review/agent-harness-review/closure.md`

- [ ] Run `npm test`.
- [ ] Run `npx tsc --noEmit && npm run build`.
- [ ] Run `npm run verify:dip && npm run verify:quality && npm run verify:package-boundary && npm run verify:package-boundary:dist`.
- [ ] Record exact results, public API additions, token/performance assessment, and deferred next-major strict-plan change.
- [ ] Commit `docs(harness): close reliability architecture review`.
