# World-class agent harness design

**Issue:** HAP-45  
**Status:** Approved for implementation  
**Scope:** A unified tool-policy pipeline, progress-aware livelock detection, and durable human-in-the-loop checkpoints.

## Intent

Catui already has two mature agent loops, cancellation, steering, turn/tool limits,
recovery, concurrency and run telemetry. The remaining reliability gap is not another
loop implementation; it is the lack of one execution contract for policies and one
durable representation for interruptions. This design adds those seams without
changing provider APIs or message wire formats.

## A. Unified tool-policy pipeline

### Ownership

- `core/lib/agent-core` owns the host-only execution pipeline and typed decisions.
- `core/runtime` composes static SDK filters, plan-mode policy and user policy.
- `core/extensions-host` adapts extension `tool_call` / `tool_result` hooks into the
  same structured outcomes. Existing hooks remain source-compatible.
- `packages/protocol` remains limited to published cross-boundary contracts. No
  plan-specific business rule is added there.
- `extensions/builtin/plan` owns interactive plan state and supplies the active plan
  path. The pure plan predicate is shared through a host runtime primitive so the
  rule has one implementation.

### Ordered data flow

1. Validate and normalize the model tool call.
2. Evaluate static allow/disallow filters.
3. Evaluate the active plan policy.
4. Evaluate extension input policies in deterministic load/registration order.
5. Evaluate the SDK caller policy.
6. Execute the tool exactly once.
7. Evaluate extension output policies in deterministic order.
8. Emit a normalized result and policy telemetry.

A denial is data, not a generic thrown error: it carries policy id, reason and tool
call identity and is rendered as a `permission_denied` tool result by both loops.
Legacy extension hooks may still throw internally, but the adapter converts a block
to the structured denial before it crosses the agent-core boundary.

### Plan-mode compatibility

The staged compatibility profile is intentional:

- Existing SDK callers using `permissionMode: "plan"` without `planFilePath` retain
  legacy markdown-write behavior for this release and receive a one-time diagnostic.
- Callers supplying `planFilePath` use the strict profile: only that normalized file
  may be written.
- Interactive mode always supplies the active plan path and therefore stays strict.
- The next major release may change the missing-path default to fail closed after the
  deprecation window.

### Failure behavior

- Policy exceptions fail closed and identify the policy that failed.
- Abort remains abort; it is not rewritten as permission denial.
- Result-policy exceptions preserve the original tool outcome in diagnostics but
  return a safe error result to the model.
- Every policy decision has a stable code suitable for telemetry and tests.

## B. Progress-aware livelock detection

Turn limits bound cost but do not detect a model repeating the same unsuccessful
action. A host-only `LoopProgressTracker` observes normalized turn evidence:

- tool name plus canonicalized input fingerprint;
- success/error/permission outcome;
- normalized assistant intent fingerprint;
- optional caller-supplied progress marker.

The tracker requires a repeated window with no novel successful evidence before it
stops. Denials and identical failures count toward stagnation; changed tool inputs,
new successful output, steering messages and explicit progress markers reset it.
Defaults remain disabled for compatibility. When configured, both loops report a
typed `livelock_detected` stop reason with repeat count and fingerprint, so callers can
distinguish it from `max_turns_reached`.

## C. Durable pause/resume checkpoints

Human approval must survive process/session boundaries. The agent loop emits a
serializable `AgentRunCheckpoint` when a policy returns `pause`:

- version and checkpoint id;
- pending tool call and policy identity;
- minimal loop counters/policy state;
- conversation boundary needed to resume safely;
- creation/expiry timestamps and opaque approval metadata.

The checkpoint never serializes executable closures or credentials. Runtime owns
storage through an injected `CheckpointStore` port. Resume consumes a checkpoint
atomically, validates version/session/tool identity, records the approval decision,
and re-enters immediately before the pending policy/tool boundary. Replay is rejected
after consumption. In-memory storage is the default; durable filesystem/session
storage is opt-in so current SDK callers keep existing behavior.

## Acceptance

- Standard and structured-adaptive loops produce identical policy, livelock and
  checkpoint semantics.
- Legacy plan callers remain functional; strict callers cannot write a second markdown
  file.
- Denials and pauses never execute the guarded tool.
- Resume executes a pending tool at most once and rejects stale/replayed checkpoints.
- Existing public exports remain compatible; additions are additive.
- Focused tests, full tests, TypeScript, build, DIP, quality and package-boundary gates
  pass.

