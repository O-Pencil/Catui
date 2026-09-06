# Run Trace, Replay, and Harness Eval

Catui exposes a versioned semantic trace for inspecting and replay-validating agent runs. Agent-core tracing remains opt-in for SDK hosts. The Catui product runtime records each completed prompt to the workspace with owner-only permissions, runtime redaction, and bounded retention.

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

`fingerprintTraceValue()` canonicalizes object key order before SHA-256 hashing. Model requests/responses and tool results are represented by fingerprints. Tool requests may retain redacted semantic arguments so local eval and transcript adapters can verify tool correctness. Hosts that retain bodies must provide a `RunTraceRedactor` and treat trace files as sensitive even after redaction.

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

The Catui product runtime masks credential-shaped keys and text before events reach the sink. `persistWorkspaceRunTrace()` applies the same redactor again before workspace writes as a defense against direct untrusted callers, rejects symbolic-link traversal below the workspace root, serializes `latest` and retention updates across sessions and processes, and retains at most 100 run files by default plus `latest.jsonl`; SDK hosts may choose a smaller positive `maxRunFiles` value.

## Deterministic replay

`replayRunTrace(recorded, observed?)` is pure: it never invokes a model, tool, network client, hook, or checkpoint store. With one trace it reconstructs semantic state and checks lifecycle pairing and declared totals. With a recorded and observed trace it reports the first semantic difference as `ReplayDivergence`, including sequence, event kind, field path, expected value, and actual value. Generated IDs and timestamps are intentionally excluded from semantic comparison.

## Harness eval gate

Run the local regression suite and the built-in corpus with:

```bash
npm run test:harness-eval
npm run eval:harness
npm run eval:harness -- --output .catui/harness-eval-report.json
```

The built-in manifest expands every scenario across the standard and weak-model-compatible frameworks. Each fixture drives a scripted assistant stream through the production loop and real tool execution, asserts the concrete side effect or control result, then replays the captured trace. It covers policy ordering, approval checkpoints, livelock, tool exceptions and pairing, steering/follow-up, output recovery, context recovery after an injected compaction result, and concurrent safe tools. Fixtures receive deterministic clocks/IDs, an isolated temporary workspace, and a network API that fails closed.

`npm run test:harness-critical` also runs checkpoint, Goal, Grub, Team, evolution, trace, and eval regression suites without scanning local worktrees. CI requires this command to finish with 100% scenario pass rate, zero replay divergences, zero policy violations, and zero unpaired tool calls. The JSON report is versioned and suitable for later trend aggregation without changing the required correctness gate.

## Compatibility and operations

- `AgentEvent` remains the UI/event-stream contract; run traces are a separate audit protocol.
- Omitting `runTrace` preserves previous agent-core loop behavior; the Catui product runtime deliberately enables its local workspace recorder.
- Trace protocol changes require a new version and reader support; do not silently reinterpret V1 payloads.
- Treat trace files as sensitive operational records even when they contain fingerprints only. Apply workspace retention and deletion rules.
- Use `required` only where losing the audit record must fail the run; interactive local sessions normally use `best_effort`.
