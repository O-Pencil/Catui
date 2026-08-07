# Run Trace, Replay, and Harness Eval

Catui exposes an opt-in, versioned semantic trace for inspecting and replay-validating agent runs. Tracing is disabled unless a host supplies a `RunTraceRecorder`, so existing sessions keep their current performance and event-stream behavior.

## Protocol

Every V1 event has a stable envelope:

```ts
type RunTraceEnvelope = {
  version: 1;
  eventId: string;
  sequence: number;
  timestamp: number;
  runId: string;
  sessionId?: string;
  turnId?: string;
  parentEventId?: string;
  kind: RunTraceKindV1;
  payload: unknown;
};
```

The actual exported `RunTraceEventV1` is a closed discriminated union, so every `kind` has a validated payload rather than an unrestricted payload. V1 covers run, turn, model, policy, tool, checkpoint, progress, and transition boundaries.

`fingerprintTraceValue()` canonicalizes object key order before SHA-256 hashing. Model requests/responses and tool inputs/results are represented by fingerprints by default. Hosts that elect to retain bodies should provide a `RunTraceRedactor` and apply their own data-retention policy; secrets and raw credentials must never reach a sink.

## Recording

```ts
import {
  InMemoryRunTraceSink,
  RunTraceRecorder,
} from "@catui/agent-core";

const sink = new InMemoryRunTraceSink();
const recorder = new RunTraceRecorder({
  runId: crypto.randomUUID(),
  sessionId: "optional-session-id",
  sink,
  failureMode: "best_effort",
  maxPending: 1024,
  redactor: async (event) => event,
});

agent.setRunTrace(recorder);
```

The recorder assigns contiguous sequences, serializes concurrent writes, redacts before sink delivery, and enforces a bounded pending queue. `best_effort` records failures for diagnostics without failing a run. `required` propagates failures and makes `flush()` fail closed. The agent loops flush their terminal trace before publishing `agent_end`.

## JSONL persistence

The public runtime subpath exports `JsonlRunTraceSink` and `readRunTraceJsonl`:

```ts
import { JsonlRunTraceSink, readRunTraceJsonl } from "catui-agent/runtime";

const sink = new JsonlRunTraceSink(".catui/traces/run-id.jsonl", {
  maxFileBytes: 64 * 1024 * 1024,
  maxLineBytes: 1024 * 1024,
});

const events = await readRunTraceJsonl(".catui/traces/run-id.jsonl");
```

Files are created and normalized to owner-only mode `0600`. Reads reject invalid JSON, unsupported protocol versions, oversized data, mixed run IDs, duplicate event IDs, invalid parent references, and sequence gaps.

## Deterministic replay

`replayRunTrace(recorded, observed?)` is pure: it never invokes a model, tool, network client, hook, or checkpoint store. With one trace it reconstructs semantic state and checks lifecycle pairing and declared totals. With a recorded and observed trace it reports the first semantic difference as `ReplayDivergence`, including sequence, event kind, field path, expected value, and actual value. Generated IDs and timestamps are intentionally excluded from semantic comparison.

## Harness eval gate

Run the local regression suite and the built-in corpus with:

```bash
npm run test:harness-eval
npm run eval:harness
npm run eval:harness -- --output .catui/harness-eval-report.json
```

The built-in manifest expands every scenario across the standard and weak-model-compatible frameworks. It covers policy ordering, approval checkpoints, livelock, tool exceptions and pairing, steering/follow-up, recovery continuation, compaction boundaries, and concurrent safe tools. Fixtures receive deterministic clocks/IDs, an isolated temporary workspace, and a network API that fails closed.

CI requires 100% scenario pass rate, zero replay divergences, zero policy violations, and zero unpaired tool calls. The JSON report is versioned and suitable for later trend aggregation without changing the required correctness gate.

## Compatibility and operations

- `AgentEvent` remains the UI/event-stream contract; run traces are a separate audit protocol.
- Omitting `runTrace` preserves previous loop behavior.
- Trace protocol changes require a new version and reader support; do not silently reinterpret V1 payloads.
- Treat trace files as sensitive operational records even when they contain fingerprints only. Apply workspace retention and deletion rules.
- Use `required` only where losing the audit record must fail the run; interactive local sessions normally use `best_effort`.
