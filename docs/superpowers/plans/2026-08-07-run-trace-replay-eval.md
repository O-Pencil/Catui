# Run Trace Replay and Harness Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a versioned, redacted run-trace protocol, deterministic replay validation, and a repeatable harness-evaluation gate covering both Catui loop frameworks.

**Architecture:** `@catui/agent-core` owns the protocol, recorder, semantic tracing helpers, replay validator, and in-memory sink so both loops share one contract. The root runtime owns secure JSONL persistence because filesystem policy belongs to the host. A root-level eval runner consumes declarative scenario manifests, executes isolated loop fixtures without network access, and enforces deterministic correctness and safety thresholds in CI.

**Tech Stack:** TypeScript strict mode, Node.js 20 APIs, Vitest for `agent-core`, Node test runner for root runtime/eval integration, GitHub Actions.

---

## Task 1: Versioned trace protocol and validation

**Files:**
- Create: `core/lib/agent-core/src/run-trace.ts`
- Create: `core/lib/agent-core/test/run-trace.test.ts`
- Modify: `core/lib/agent-core/src/index.ts`

1. Write failing Vitest cases for the closed `RunTraceEventV1` discriminated union, canonical fingerprint stability, and rejection of unknown versions, kinds, malformed payloads, duplicate IDs, and non-contiguous sequences.
2. Run `npm test --prefix core/lib/agent-core -- run-trace.test.ts` and confirm failure because the module does not exist.
3. Implement the V1 envelope, typed payload map, canonical JSON hashing, single-event parsing, and ordered trace validation using `unknown` plus runtime guards.
4. Export the protocol and rerun the focused test until green.
5. Run `npm run build --prefix core/lib/agent-core` and commit as `feat(harness): add versioned run trace protocol`.

## Task 2: Redacting serialized recorder and sinks

**Files:**
- Create: `core/lib/agent-core/src/run-trace-recorder.ts`
- Create: `core/lib/agent-core/test/run-trace-recorder.test.ts`
- Modify: `core/lib/agent-core/src/index.ts`

1. Write failing cases proving sequential event IDs/sequences, injected clock/ID determinism, redaction before sink delivery, bounded queue behavior, `best_effort` failure capture, `required` failure propagation, flush ordering, and in-memory snapshots.
2. Run the focused test and confirm the missing API failure.
3. Implement `RunTraceRecorder`, `RunTraceSink`, `RunTraceRedactor`, `InMemoryRunTraceSink`, bounded serialized append, flush, and opt-in body capture while always retaining fingerprints.
4. Rerun focused tests and the agent-core build; commit as `feat(harness): add redacted trace recorder`.

## Task 3: Shared semantic instrumentation in both loops

**Files:**
- Create: `core/lib/agent-core/src/run-trace-context.ts`
- Create: `core/lib/agent-core/test/agent-loop-run-trace.test.ts`
- Modify: `core/lib/agent-core/src/types.ts`
- Modify: `core/lib/agent-core/src/agent.ts`
- Modify: `core/lib/agent-core/src/agent-loop.ts`
- Modify: `core/lib/agent-core/src/structured-adaptive-agent-loop.ts`
- Modify as required at execution boundaries: `core/lib/agent-core/src/structured-adaptive-tool-orchestration.ts`, `core/lib/agent-core/src/structured-adaptive-streaming-tool-executor.ts`, `core/lib/agent-core/src/tool-policy.ts`

1. Add failing loop tests that run identical deterministic fixtures through `standard` and `weak-model-compatible`, asserting ordered run/turn/model/tool/policy/checkpoint/progress/transition/completion events and paired tool calls.
2. Confirm failures show absent trace output, not fixture defects.
3. Add an optional trace configuration to the public agent/loop API and a per-run semantic context that centralizes IDs, parent relationships, fingerprints, and recorder calls.
4. Instrument lifecycle boundaries without changing the existing `AgentEvent` stream contract or loop concurrency rules. Flush trace writes before terminal completion; treat recorder failures according to configured mode.
5. Run focused trace tests, existing harness reliability tests, full agent-core tests, and build; commit as `feat(harness): trace both agent loop frameworks`.

## Task 4: Deterministic replay and divergence diagnostics

**Files:**
- Create: `core/lib/agent-core/src/run-replay.ts`
- Create: `core/lib/agent-core/test/run-replay.test.ts`
- Modify: `core/lib/agent-core/src/index.ts`

1. Write failing tests for successful replay, first-divergence reporting, missing/extra event detection, fingerprint mismatch, invalid trace rejection, and proof that replay has no model/tool/hook dependencies.
2. Confirm the tests fail on missing replay exports.
3. Implement `replayRunTrace` as a pure state-machine validator that derives and compares semantic outcomes, returning a structured `ReplayDivergence` with sequence, kind, field path, expected, and actual values.
4. Rerun focused tests, full agent-core tests, and build; commit as `feat(harness): add deterministic trace replay`.

## Task 5: Secure JSONL trace persistence

**Files:**
- Create: `core/runtime/run-trace-jsonl.ts`
- Create: `test/run-trace-jsonl.test.ts`
- Modify: `runtime.ts`

1. Write failing Node tests for append/read round trips, owner-only file permissions, invalid JSON, oversize lines/files, unsupported versions, and sequence/order validation.
2. Confirm failure because the runtime module is absent.
3. Implement the host sink/reader using exclusive or append-safe file handles, mode `0600`, configurable byte limits, one JSON object per line, and the shared agent-core validator.
4. Export the runtime API; run the focused test, `npx tsc --noEmit`, and package boundary verification; commit as `feat(runtime): persist run traces as secure jsonl`.

## Task 6: Declarative harness eval runner and initial corpus

**Files:**
- Create: `core/harness-eval/types.ts`
- Create: `core/harness-eval/runner.ts`
- Create: `core/harness-eval/scenarios.ts`
- Create: `scripts/harness-eval.ts`
- Create: `test/harness-eval.test.ts`
- Modify: `package.json`

1. Write failing tests for manifest validation, isolated temporary workspaces, explicit network denial, both-loop expansion, deterministic seed/time/IDs, metric aggregation, threshold failures, JSON report output, and nonzero CLI exit on regression.
2. Add initial deterministic scenarios for policy ordering, approval pause/resume/replay protection, livelock, tool exception/pairing, steering/follow-up, model recovery/token continuation, compaction boundary, and concurrent safe tools.
3. Confirm focused tests fail before creating runner production code.
4. Implement the typed manifest, fixture adapters, runner, metrics (`passRate`, `replayDivergences`, `policyViolations`, `unpairedToolCalls`, latency/turn/tool ceilings), and `npm run eval:harness` command.
5. Run `npm run test:harness-eval`, `npm run eval:harness -- --output .catui/harness-eval-report.json`, and `npx tsc --noEmit`; commit as `feat(harness): add deterministic eval regression gate`.

## Task 7: CI gate and operator documentation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Create: `docs/run-trace-and-replay.md`
- Modify: `docs/superpowers/specs/2026-08-07-run-trace-replay-eval-design.md` only if implementation clarifications are required

1. Add the deterministic harness eval command to CI after dependency build/type validation, with no secrets or network-dependent scenarios.
2. Document opt-in configuration, redaction/body-capture defaults, JSONL retention/permissions, replay diagnostics, manifest schema, local commands, and compatibility guarantees.
3. Run the full verification set: `npm run test --prefix core/lib/agent-core`, `npm run test:harness-eval`, `npm run eval:harness`, `npm test`, `npm run verify:all`, and `npm run build`.
4. Inspect `git diff --check`, review changed files for accidental secrets/`any`/ignored errors, and commit as `ci(harness): gate changes with deterministic evals`.
5. Push the existing PR branch, take one non-blocking `gh pr checks 7` snapshot, update the PR description with D+E scope/evidence, and set Multica metadata `pipeline_status` from that snapshot.
