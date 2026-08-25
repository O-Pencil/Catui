# Durable Approval Resume Harness Design

**Status:** Approved design; awaiting written-spec review  
**Scope:** A durable, exactly-once approval-resume workflow with complete semantic run traces and executable harness coverage.

## Context

Catui can pause both production loops on a tool policy, persist an `AgentRunCheckpoint`,
and resume it through `Agent.resumeCheckpoint()`. The first harness-foundation slice
proved checkpoint creation and pause behavior, but it deliberately stopped before
resolution. Three evidence gaps remain:

1. The built-in eval corpus proves that a tool pauses, but never reconstructs an Agent
   and consumes the persisted checkpoint.
2. `checkpoint.resolved` exists in the V1 trace protocol but no production path emits
   it. Resumed tools execute outside the loop and therefore do not appear in the next
   run's tool count or lifecycle trace.
3. Reusing the recorder from the paused run can append a second `run.started` after
   `run.completed`, producing a sequence that validates structurally but is not one
   replayable run.

The durable recovery mechanism already has the right narrow owners: agent-core owns
checkpoint consumption and loop continuation, while `core/runtime/checkpoint-store.ts`
owns cross-process filesystem claiming. The missing work is lifecycle composition and
executable proof, not a new workflow engine.

## Goals

1. Represent every resume attempt as one independent, replayable semantic run.
2. Emit checkpoint resolution and resumed tool lifecycle events before the continuation
   model turn.
3. Carry resumed tool counts and permission denials into the terminal `agent_result`
   and `run.completed` totals for both loop frameworks.
4. Prove filesystem checkpoint reconstruction, concurrent exactly-once claim,
   duplicate-consumption rejection, human denial, and resumed tool exceptions.
5. Keep tracing optional and preserve existing behavior when no recorder is injected.
6. Keep the slice offline, deterministic, and required by `test:harness-critical`.

## Non-goals

- Adding a CLI, TUI dialog, slash command, or `AgentSession` resume facade.
- General crash recovery for an in-flight model or tool process.
- OS-level tool sandboxing or network namespace isolation.
- Changing `catui-protocol`, root public subpath exports, or provider message formats.
- Supporting one approval resume that immediately pauses on a second approval policy;
  the existing error remains explicit and a later slice can make chained approval a
  first-class user flow.
- Combining the original pause and later resume into one trace file. They are distinct
  runs linked by checkpoint identity.

## Considered Approaches

### 1. Eval-only assertions around the existing Agent API

This would reconstruct an Agent and prove that the tool executes once, but the resume
trace would still report zero tool calls and never emit `checkpoint.resolved`. It tests
behavior while preserving misleading evidence, so it is insufficient.

### 2. Merge pause and resume events into one long-lived recorder

This appears convenient, but the paused loop has already emitted `run.completed`.
Appending another `run.started` creates two lifecycle roots under one `runId`; replay
returns at the first completion and silently ignores the resume. It also makes trace
retention and run-level metrics ambiguous.

### 3. Start a fresh resume run and seed the continuation loop — selected

`Agent.resumeCheckpoint()` starts a fresh trace before claiming the checkpoint, records
the resolution and resumed tool lifecycle, then continues through the selected loop
with a narrow continuation seed. The seed tells the loop that `run.started` is already
present and supplies the tool/denial totals already accumulated by the resume prelude.
The loop remains the sole owner of model turns and terminal run completion.

This preserves one root and one completion per trace, makes required tracing fail before
checkpoint consumption, and keeps standard and weak-model-compatible behavior aligned.

## Architecture

### Ownership and placement

| Capability | Owner | Change |
|---|---|---|
| checkpoint claim and resumed tool execution | `core/lib/agent-core/src/agent.ts` | compose the resume run prelude and continuation |
| shared continuation totals | `core/lib/agent-core/src/types.ts` | narrow `AgentLoopContinuationState` contract |
| standard loop continuation | `core/lib/agent-core/src/agent-loop.ts` | accept seeded trace/count/denial state |
| structured continuation | `core/lib/agent-core/src/structured-adaptive-agent-loop.ts` | apply the same seed semantics |
| trace helpers | `core/lib/agent-core/src/run-trace-context.ts` | emit checkpoint resolution and guard fresh run start |
| recorder freshness evidence | `core/lib/agent-core/src/run-trace-recorder.ts` | expose read-only recorded event count |
| filesystem durability | `core/runtime/checkpoint-store.ts` | reuse unchanged atomic rename claim |
| deterministic fixtures | `core/harness-eval/` | reconstruct Agents and execute approve/deny/error cases |

This changes a load-bearing agent-core path and therefore requires a dedicated
`.dev-docs/architecture-review/durable-approval-resume-review/` before implementation.
No type crosses a publish boundary, so no contract belongs in `catui-protocol`.

### Resume run lifecycle

A valid approval resume uses this order:

1. Require a fresh recorder when tracing is enabled.
2. Emit `run.started` with the configured loop framework and current conversation
   fingerprint.
3. Atomically consume the checkpoint using its session and conversation-boundary
   validator.
4. Emit `checkpoint.resolved` as `approved` or `denied`.
5. Evaluate remaining policies, validate input, and execute or deny the resumed tool.
6. Emit one paired `tool.requested` → optional `tool.started` → `tool.completed`
   lifecycle. Approved execution can end in success or error; human denial ends in
   `denied` without `tool.started`.
7. Append the resumed tool result and deterministic skipped-sibling results to the
   reconstructed conversation.
8. Continue the selected production loop with `AgentLoopContinuationState`.
9. The loop emits model/turn events and one `run.completed` whose tool count includes
   the resumed tool.

The original pause run remains a separate trace ending in `approval_required`. Both
runs use the same checkpoint ID as their durable correlation key.

### Continuation seed

The optional state is accepted only by `agentLoopContinue()` and
`structuredAdaptiveAgentLoopContinue()`:

```ts
interface AgentLoopContinuationState {
  runTraceAlreadyStarted?: boolean;
  initialToolCallCount?: number;
  initialPermissionDenials?: readonly AgentToolPermissionDenial[];
}
```

Fresh prompts always start from zero and emit their own `run.started`. Resume passes a
seed with `runTraceAlreadyStarted: true`, one initial tool call, and a denial only when
the resolved action produced `permission_denied`. Existing tool and turn limits include
the seeded count.

### Failure semantics

- **Required trace cannot start:** reject before consuming the checkpoint.
- **Unavailable or already-consumed checkpoint:** emit
  `checkpoint.resolved: unavailable`, close a zero-turn/zero-tool run with
  `checkpoint_unavailable`, then reject the API call.
- **Human denial:** consume once, emit a denied tool lifecycle, append a paired denial
  result, and continue so the model can respond to the denial.
- **Validation failure or tool exception:** append and trace an error result, then
  continue normally. The run remains replayable and the tool count is one.
- **Conversation/session mismatch:** the conditional claim restores the checkpoint;
  the attempt is reported as unavailable without destroying recoverable state.
- **Continuation failure:** the production loop owns its existing terminal error and
  closes the already-started trace exactly once.
- **Recorder reuse:** fail before checkpoint consumption with a clear fresh-recorder
  error rather than creating a multi-root trace.

### Fixture organization

`core/harness-eval/agent-fixtures.ts` is already above the project's review threshold.
This slice will extract reusable scripted-model and trace setup into
`core/harness-eval/fixture-runtime.ts`, leaving stateless loop cases in
`agent-fixtures.ts`. Durable approval cases live in
`core/harness-eval/approval-resume-fixtures.ts` and use the real
`FileCheckpointStore` under the fixture workspace.

The required corpus contains:

1. **approval-resume-approve:** pause with safe/approval/sibling calls, reconstruct two
   Agents against one file checkpoint, race both claims, require one success and one
   unavailable result, and prove the deployment executes exactly once with remaining
   policy transforms applied.
2. **approval-resume-deny:** reconstruct and deny, require no tool execution, a paired
   denial result, one permission denial in the terminal result, and a denied trace.
3. **approval-resume-error:** approve a tool that throws, require one execution, a paired
   error result, continued model response, and an error tool trace.

Every case runs under both frameworks. Each pause trace and resume-attempt trace is
replayed inside the fixture; the successful or denied resume trace is returned to the
harness runner for standard divergence and pairing metrics.

## Security and Privacy

- Required trace start precedes destructive checkpoint consumption.
- `FileCheckpointStore.consume()` remains the exactly-once authority; the harness does
  not add a second lock or cache.
- Checkpoint session and conversation boundaries remain mandatory claim validators.
- Fixture inputs contain no credentials and run below isolated temporary workspaces.
- No provider network request is added; scripted streams remain the only model source.
- Trace storage continues to use runtime redaction and sensitive-record handling from
  the first foundation slice.

## Compatibility and Cost

- Existing prompt and continuation callers need no changes; the continuation state is
  optional.
- Existing approval behavior without tracing remains unchanged except for corrected
  terminal tool/denial accounting after resume.
- No LLM call, prompt injection, network dependency, npm dependency, or published API
  is added.
- Runtime overhead is bounded to a few trace events and copying small continuation
  counters. The filesystem checkpoint claim already exists.
- The harness grows from 16 to 20 required framework-expanded scenarios.

## Testing Strategy

Focused agent-core tests will cover:

- fresh recorder enforcement before checkpoint consumption;
- approved, denied, unavailable, and exception trace lifecycles;
- seeded tool counts and permission denials in both loops;
- no duplicate `run.started` and exactly one `run.completed`;
- conversation mismatch restoring the file checkpoint;
- concurrent reconstructed Agents consuming the checkpoint exactly once.

Harness tests will require 20/20 executable cases, zero replay divergences, zero policy
violations, and zero unpaired tool calls. Existing recorder, loop, checkpoint-store,
runtime trace, and default critical suites remain required.

## Acceptance Criteria

- A pause trace and every resume-attempt trace replay independently.
- A successful resume trace starts with `run.started`, contains one approved
  `checkpoint.resolved`, contains one paired resumed tool lifecycle, and completes with
  `toolCallCount: 1` plus any later loop tool calls.
- Two reconstructed Agents racing one file checkpoint execute the approved tool once;
  the loser emits an unavailable resolution trace and cannot delete a restored valid
  checkpoint on boundary mismatch.
- Denial never invokes the tool and is visible in both tool outcome and terminal
  permission-denial telemetry.
- A resumed tool exception produces a paired error result and still reaches the next
  model turn.
- Standard and weak-model-compatible loops produce the same lifecycle invariants.
- `npm test`, all five mandatory repository gates, dist boundary verification, and
  independent code review pass.

## Deferred

- First-class chained approvals when a later policy pauses again.
- `AgentSession`/extension/CLI/TUI surfaces for approving checkpoints.
- Persisting an entire in-flight model/tool execution for crash restart.
- OS-level process, filesystem, and network isolation.
