# Runtime Session Gates

```yaml
gate_set: runtime-session
inherits:
  - ../execution-plan/gates.md#门组-b
applies_to:
  - core/runtime/agent-session.ts
  - core/runtime/*-controller.ts
  - core/runtime/*-runner.ts
  - core/runtime/*-coordinator.ts
  - core/runtime/*-bridge.ts
```

## Hard Gates

| Gate | Rule | Validation |
|------|------|------------|
| RS-1 No reverse runtime import | Runtime collaborators must not import `./agent-session.ts` | `rg 'from "./agent-session' core/runtime` must only find public facade consumers outside collaborators |
| RS-2 No service locator context | Controller context must expose capabilities, not whole composition-root objects, unless temporarily justified in a finding | code review |
| RS-3 Single owner | Each mutable side effect has exactly one owning collaborator | finding card + code review |
| RS-4 Facade stability | `modes/**`, `core/index.ts`, and root `index.ts` continue to use `AgentSession` facade unless an API change is explicitly approved | public API diff + grep |
| RS-5 No fake extraction | A new collaborator must hide real behavior or own real state; placeholder methods are not acceptable as completed splits | deletion test |
| RS-6 DIP isomorphism | New runtime files have P3 headers and are listed in `core/runtime/AGENT.md` / `CLAUDE.md` | P2/P3 review |

## Single-Owner Table

| Concern | Owner | Non-owner rule |
|---------|-------|----------------|
| model set/cycle/restore | `ModelController` | `AgentSession` only delegates |
| thinking level set/cycle/restore | `ModelController` | `AgentSession` only delegates |
| bash execution state | `BashRunner` | `AgentSession` only delegates |
| tool activation/wrapping/refresh | future `ToolRuntimeController` + `ToolOrchestrator` | no ad hoc tool list assembly in `AgentSession` |
| compaction state | future real compaction controller/coordinator | no placeholder coordinator claimed as done |
| event facade and turn lifecycle | `AgentSession`; future event bridge may map/fan out extension events only | no bridge owns persistence/retry/compaction/Soul ordering without a lifecycle finding |
| session identity-change flow | narrow `SessionLifecycleController` (`newSession`/`switchSession`/`fork`) | model/thinking restore remains model-owned; reload/tree/teardown do not move |

## Review Questions

For each proposed split, answer:

1. What mutable state moves?
2. Which public `AgentSession` methods remain as facade methods?
3. Which code becomes directly unit-testable without constructing full `AgentSession`?
4. Which imports disappear from `agent-session.ts`?
5. Which imports are newly introduced, and do they obey GB-1?
6. Is behavior still reachable through the same public API?

## Low-Performance Machine Policy

Allowed here:

- `git diff --check`
- `npm run verify:quality`
- targeted `rg`/`sed`/`git diff`

Avoid unless maintainer approves machine capacity:

- `npm install`
- `npm run build`
- full vitest suites
- CLI smoke runs
