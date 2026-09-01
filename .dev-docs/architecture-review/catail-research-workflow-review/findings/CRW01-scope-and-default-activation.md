# CRW01 — Keep Default Activation Passive and Bounded

## Finding

A scientific workflow can easily become a second runtime harness: persistent state, autonomous loops, network retrieval, reviewer agents, and experiment execution. Making that entire surface default-on would add prompt cost, side effects, and unclear ownership before the artifact model has been validated across real projects.

## Decision

V1 is a passive default-discovered Skill bundle. Its extension runtime only exposes `SKILL.md` and appends a short matching rule. The Skill may direct normal agent tools to create user-authorized project artifacts, but the extension itself starts no timer, launches no process, writes no workspace file, and registers no broad research tool.

The deterministic audit is an explicit local script invoked by the workflow or a human. It checks structural completeness only. It must not score hypotheses, infer novelty, approve ethics, or declare a manuscript publishable.

## Consequences

- Default prompt overhead remains bounded to the bootstrap reminder.
- The research artifact vocabulary can evolve locally without public protocol churn.
- CATAIL is immediately useful through Catui's existing Skill tool and ordinary file/network tools.
- Native orchestration, reviewer dispatch, and durable runtime state remain deferred until usage evidence justifies them.

## Reopen conditions

Reopen this decision only after at least two materially different research projects demonstrate a repeated need for the same runtime state transition or deterministic gate that cannot be expressed safely through artifacts and the existing Skill/tool surface.
