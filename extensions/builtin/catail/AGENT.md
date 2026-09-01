# AGENT.md

> P2 | CATAIL extension module map

## Purpose

Bundles Catui's evidence-traceable scientific workflow as a passive, default-discovered Skill. CATAIL routes research work through stage-specific playbooks and durable project artifacts without adding a core runtime controller or public protocol.

## Members

| File | Role |
|---|---|
| `index.ts` | Registers `resources_discover` for `SKILL.md` and a bounded `before_agent_start` activation reminder. |
| `SKILL.md` | Main CATAIL selection, safety, routing, workspace, and gate contract. |
| `references/*.md` | Stage-specific playbooks plus artifact contracts, loaded progressively. |
| `templates/` | Shape references for research charter, method policy, searches, claims, studies, runs, analyses, and evidence bindings. |
| `scripts/audit.mjs` | Dependency-free, read-only structural audit for CATAIL artifacts. |
| `README.md` | User-facing overview and example invocation. |
| `THIRD_PARTY_NOTICE.md` | Attribution and adaptation boundary for CATPAW and K-Dense Scientific Agent Skills. |

## Invariants

- Extension runtime is passive: no timer, external process, workspace write, network call, tool, or command registration.
- Research artifacts are authoritative; model output is not evidence.
- Structural audit results never imply scientific merit, truth, ethics approval, or publication readiness.
- CATAIL imports only the stable extension host type surface and does not depend on another extension.
