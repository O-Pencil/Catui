# Progress-aware Livelock Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop repeated no-progress tool cycles before the coarse turn limit and report an actionable typed reason.

**Architecture:** A pure agent-core tracker fingerprints normalized tool evidence and maintains a bounded stagnation window. Both loops feed it identical results and reset it only on meaningful novelty or an explicit progress marker.

**Tech Stack:** TypeScript, Vitest, Node crypto-free deterministic canonicalization.

---

### Task 1: Pure progress tracker

**Files:**
- Create: `core/lib/agent-core/src/loop-progress.ts`
- Create: `core/lib/agent-core/test/loop-progress.test.ts`
- Modify: `core/lib/agent-core/src/index.ts`

- [ ] Add failing tests for stable object-key canonicalization, repeated error/denial detection, success/input novelty reset, and bounded history.
- [ ] Run `npx vitest run core/lib/agent-core/test/loop-progress.test.ts` and confirm failure.
- [ ] Implement `LoopProgressTracker` and `AgentLoopProgressOptions` with disabled-by-default semantics.
- [ ] Run the focused test and confirm pass.
- [ ] Commit `feat(agent-core): detect no-progress tool cycles`.

### Task 2: Integrate both loops

**Files:**
- Modify: `core/lib/agent-core/src/types.ts`
- Modify: `core/lib/agent-core/src/agent-loop.ts`
- Modify: `core/lib/agent-core/src/structured-adaptive-agent-loop.ts`
- Test: `core/lib/agent-core/test/agent-loop.test.ts`

- [ ] Add failing tests proving both frameworks stop at the same threshold and steering resets stagnation.
- [ ] Run the named tests and confirm they hit the old turn limit.
- [ ] Feed normalized tool outcomes into the tracker and add `livelock_detected` run metadata with fingerprint and repeat count.
- [ ] Run agent-core tests and confirm existing defaults are unchanged.
- [ ] Commit `feat(agent-core): stop progress-free loops early`.
