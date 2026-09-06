# HF01 - The Harness Needs One Trustworthy Foundation Before More Autonomy

## Evidence

- Built-in eval fixtures manually emit trace events and return a clone of the same
  events as the observation.
- Workspace write confinement uses lexical `path.resolve()` comparison and follows
  symbolic links during the later filesystem write.
- Interactive Bash approval supplies a one-entry `baseToolsOverride`, while
  `AgentSession` treats the override as the entire base registry.
- Every prompt persists a workspace trace with clear tool inputs, no injected redactor,
  and no retention policy.
- Required CI names only a narrow subset of the harness subsystem tests.

## Decision

Repair evidence and safety at their existing narrow owners. Do not introduce a new
workflow kernel in this slice. The eval corpus will use deterministic scripted model
streams, real tools and the production loop implementations; pure replay remains a
trace lifecycle validator after execution.

The write guard will fail closed on symbolic links instead of claiming race-free OS
sandboxing. Full process sandboxing remains a later isolation slice.

Trace inputs remain available for local benchmark adapters, but runtime supplies a
recursive secret redactor and bounded retention before persistence. Agent-core remains
storage-policy agnostic.

## Implemented Evidence

- Eight scripted scenarios execute both production loops and real tools, with
  scenario-specific assertions followed by semantic replay of the captured trace.
- Production tracing now records transitions, paused policy/checkpoint identity, and
  closes failed turns before model-error recovery.
- The workspace write guard rejects both directory and file symbolic-link traversal.
- Bash approval is injected through the one complete default-tool composition path.
- Product trace persistence redacts credential-shaped values, serializes concurrent
  latest/retention commits, and retains at most 100 run files by default.
- Streamed tool calls remain trace-paired and counted when a provider error or abort
  replaces the partial assistant message.
- `test:harness-critical` requires 193 subsystem tests plus the 16-case executable
  corpus in local default tests and CI.

## Reopen Conditions

- A tool needs an intentional symlink traversal capability.
- A benchmark requires unredacted credentials rather than semantic arguments.
- Real scenarios require provider network access in required CI.
- Goal/Grub/Team duplication blocks the next verifier-owned completion slice.
