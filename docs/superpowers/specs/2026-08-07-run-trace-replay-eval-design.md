# Run Trace, Deterministic Replay, and Harness Eval Design

**Issue:** HAP-45  
**Status:** Proposed for implementation  
**Scope:** The first post-policy reliability slice: versioned run traces, side-effect-free replay, and deterministic harness regression gates.

## Context

Catui now has ordered tool policies, progress-aware livelock detection, durable approval checkpoints, two loop implementations, run limits, recovery, compaction, and run-result telemetry. The remaining high-leverage gap is proof: a failed or inefficient run cannot yet be reconstructed from one canonical event stream and replayed without calling the model or re-executing side effects.

The current `AgentEvent` union is UI-oriented. It has no common run/turn identity, sequence, schema version, redaction boundary, or correlation parent, and several tool payloads are `any`. Extension telemetry has a `runId`, but it is not the canonical agent state-machine record. Eval documentation is still a draft governance layer rather than an executable regression system.

## Goals

1. Produce a complete, ordered, versioned record of one agent run.
2. Replay a captured run without network access or side effects and fail on the first semantic divergence.
3. Use recorded and synthetic scenarios as deterministic CI regressions.
4. Keep tracing opt-in and preserve current SDK and UI behavior when disabled.
5. Redact secrets before data crosses the agent-core sink boundary.
6. Keep the protocol independent of any telemetry vendor or storage backend.

## Non-goals

- Reproducing provider sampling bit-for-bit against a live model.
- Uploading traces to InsForge or another hosted service by default.
- Replacing existing session JSONL persistence.
- General crash recovery of an entire run; that is the next Durable Run slice.
- Making nondeterministic live-model scores a required PR gate.

## Considered Approaches

### 1. Add fields to existing UI events

This is the smallest diff, but it couples a durable protocol to rendering needs. UI events omit important inputs and are allowed to evolve for presentation. Replay would inherit those gaps and compatibility constraints.

### 2. Reconstruct traces from session JSONL and extension telemetry

This avoids loop changes, but neither source owns the full execution boundary. Policy decisions, request fingerprints, partial failures, and exact tool scheduling order would be inferred rather than recorded.

### 3. Add a canonical trace port at agent-core boundaries — selected

Agent-core emits a separate versioned protocol through an injected sink. The standard and structured loops call shared trace helpers at the same semantic boundaries. UI events remain unchanged initially. Runtime supplies memory or JSONL sinks and an explicit redactor. Replay and eval depend only on the protocol, not on the live Agent class.

This creates one trustworthy source without forcing persistence or telemetry dependencies into agent-core.

## Architecture

### Protocol envelope

Every record uses a common envelope:

```ts
interface RunTraceEventV1<TKind extends RunTraceKind, TPayload> {
  version: 1;
  eventId: string;
  sequence: number;
  timestamp: number;
  runId: string;
  sessionId?: string;
  turnId?: string;
  parentEventId?: string;
  kind: TKind;
  payload: TPayload;
}
```

Payloads are a closed discriminated union and use `unknown` plus validation at external boundaries. No trace API introduces `any`.

Initial event kinds:

- `run.started`, `run.completed`
- `turn.started`, `turn.completed`
- `model.requested`, `model.responded`, `model.failed`
- `policy.decided`
- `tool.requested`, `tool.started`, `tool.completed`
- `checkpoint.created`, `checkpoint.resolved`
- `progress.observed`
- `transition.applied`

`model.requested` stores a canonical request fingerprint plus safe metadata by default. Full prompts require an explicit capture option and still pass through redaction. Tool inputs and outputs follow the same rule: canonical fingerprint always, redacted body only when enabled.

### Trace recorder

`RunTraceRecorder` owns identity, monotonic sequence assignment, canonical serialization, and sink delivery. Its injected dependencies are:

- `RunTraceSink.append(event): Promise<void>`
- `RunTraceRedactor.redact(value, context): unknown`
- clock and ID factories for deterministic tests

Sink failures are configurable:

- `best_effort` (default): emit one diagnostic and disable the sink for that run.
- `required`: stop the run before the next external side effect.

The recorder never lets an asynchronous sink reorder records. It serializes appends and bounds its queue. The default no-op recorder has negligible token and network cost.

### Loop integration

Both loop frameworks emit through shared helpers at semantic boundaries, not from UI rendering or provider-specific code. A tool batch records scheduling order before execution, then each tool lifecycle independently. Policy decisions record policy ID, decision code, input/output fingerprints, and checkpoint ID when present.

Trace emission must not change tool concurrency. Sequence reflects observation order; explicit `parentEventId` and tool-call IDs express causality.

### Deterministic replay

Replay consumes a validated V1 trace and runs a pure state-machine driver:

1. Verify the caller's scenario/session fingerprint.
2. Match each model request fingerprint and return the recorded model response.
3. Match each policy/tool request by semantic identity and canonical input fingerprint.
4. Return recorded tool results without executing tools.
5. Compare produced transitions, messages, counters, and terminal result with the trace.
6. Stop at the first mismatch with a structured `ReplayDivergence` containing sequence, expected value, actual value, and category.

Replay never executes a live model, tool, hook, or checkpoint store. A later opt-in diagnostic mode may selectively replace one recorded component, but it is not part of this slice.

### Trace storage

The first runtime adapters are:

- `InMemoryRunTraceSink` for tests and SDK consumers.
- `JsonlRunTraceSink` using atomic append semantics and file mode `0600`.

JSONL begins with a schema header. Readers reject unknown major versions, malformed sequence order, duplicate event IDs, and records over configured size limits. Paths are caller-selected and confined by the runtime adapter; agent-core never opens files.

## Harness Eval

### Scenario manifest

Each deterministic scenario declares:

- stable ID and description
- fixture workspace or in-memory tools
- loop framework(s)
- captured trace or scripted model responses
- tool/policy configuration
- expected terminal result and invariants
- maximum turns, tool calls, duration, and trace size

The runner executes every scenario against both loop frameworks unless explicitly scoped. Workspace fixtures are copied to an isolated temporary directory. Network is disabled for required CI scenarios.

### Initial regression corpus

The first required corpus covers:

1. ordered policy transforms and denial
2. approval pause/resume/replay rejection
3. repeated-failure and identical-success livelock
4. tool exception and sibling result pairing
5. steering and follow-up delivery
6. model error recovery and output-token continuation
7. compaction boundary preservation
8. concurrent safe tools with deterministic causal trace

### Metrics and gates

Deterministic CI reports:

- scenario pass rate (required: 100%)
- replay divergence count (required: 0)
- policy violation count (required: 0)
- unpaired tool-call count (required: 0)
- turn/tool-call and trace-size ceilings
- deterministic cost/token counters when fixtures provide usage

Live-model evaluation remains a scheduled or manual report. It may track completion rate, latency, cost, tool economy, and recovery, but cannot block a PR until sample size and variance rules are documented.

## Security and Privacy

- Redaction happens before sink invocation, not inside individual sinks.
- Default capture excludes prompt bodies, environment variables, secrets, raw headers, and unrestricted tool output.
- Redactors receive semantic context so path, command, URL, and credential fields can use different rules.
- Replay fixtures must contain only reviewed, repository-safe data.
- JSONL readers enforce size and nesting limits before materializing payloads.
- Required tracing fails before the next side effect if trace durability is lost; best-effort tracing never crashes an otherwise valid run.

## Compatibility

- All new options are additive and tracing defaults to disabled.
- Existing `AgentEvent` consumers are unchanged in this slice.
- Existing telemetry remains an adapter/consumer, not the protocol owner.
- V1 readers ignore additive fields but reject unknown event kinds unless configured for inspection-only mode.
- A future V2 requires an explicit migration function and fixture compatibility tests.

## Testing Strategy

Implementation follows test-first slices:

1. Protocol validation and canonical fingerprint fixtures.
2. Recorder ordering, redaction, queue bounds, and sink failure modes.
3. Standard-loop lifecycle trace.
4. Structured-loop causal equivalence under concurrency.
5. Replay success and first-divergence diagnostics.
6. JSONL durability, corruption rejection, permissions, and size limits.
7. Eval manifest validation and isolated runner.
8. Required regression corpus and CI summary output.

Every production API is exercised through behavior tests. Golden files are limited to the stable serialized protocol; high-level assertions remain semantic so harmless field ordering does not create churn.

## Delivery Slices

1. **D1 — Protocol and recorder:** types, validation, canonicalization, sink/redactor ports.
2. **D2 — Loop tracing:** both frameworks and runtime adapters.
3. **D3 — Replay:** pure driver, divergence model, JSONL reader/writer.
4. **E1 — Eval runner:** manifest, isolation, reports, initial corpus.
5. **E2 — CI gate:** deterministic npm command and GitHub workflow step.

Each slice is independently testable and may be reverted without changing existing behavior when tracing is disabled.

## Acceptance Criteria

- A recorded standard-loop run replays with zero live model/tool calls.
- The same semantic fixture passes under both loop frameworks.
- Mutating one recorded tool input produces a divergence at the exact expected sequence.
- Sensitive fixture fields never reach a test sink after redaction.
- Corrupt, oversized, reordered, or unsupported traces fail closed.
- The deterministic eval corpus runs offline and passes in CI.
- Tracing-disabled performance and behavior remain within the existing baseline.
