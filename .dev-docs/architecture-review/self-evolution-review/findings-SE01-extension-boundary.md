# SE01 Extension Boundary

severity: blocking

## Finding

Self-evolution is a user-visible harness capability and must live in
`extensions/optional/evolution/`, not in `core/runtime/agent-session.ts`.

## Decision

Use existing extension ports: `/refine` command registration, `before_agent_start`
prompt append, `sessionManager` reads, `agentDir`, and one-shot completion.

## Verification

Implementation must not modify `core/runtime/agent-session.ts`.

