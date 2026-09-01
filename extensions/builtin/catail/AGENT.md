# AGENT.md

> P2 | CATAIL extension module map

## Purpose

Bundles CATAIL — Professional Scientific Agent as a passive, default-discovered but explicit-use Skill. CATAIL routes explicitly named scientific work through a shared inquiry lifecycle, composable research methods, progressively loaded playbooks, and optional durable project memory without adding a core runtime controller or public protocol.

## Members

| File | Role |
|---|---|
| `index.ts` | Registers `resources_discover` for `SKILL.md` and a bounded explicit-activation reminder. |
| `SKILL.md` | Main CATAIL identity, explicit activation, capability, method, lifecycle, language, safety, and routing contract. |
| `references/foundations/*.md` | Scientific method catalog, epistemic and language discipline, lifecycle, decision gates, and task routing. |
| `references/*.md` | Operational playbooks for framing, prior-art positioning, design, investigation, inference, iteration, writing, review, audit, and artifact contracts, loaded progressively. |
| `templates/` | Shape references for research charter, position record, source/hypothesis/claim registers, studies, runs, analyses, iterations, and evidence bindings. |
| `scripts/audit.mjs` | Dependency-free, read-only structural audit for CATAIL artifacts. |
| `README.md` | User-facing overview and example invocation. |
| `THIRD_PARTY_NOTICE.md` | Attribution and adaptation boundary for CATPAW and K-Dense Scientific Agent Skills. |

## Invariants

- Extension runtime is passive: no timer, external process, workspace write, network call, tool, or command registration.
- CATAIL activates only when the user invokes `/skill:catail` or explicitly names CATAIL; scientific vocabulary alone never activates it.
- CATAIL is a professional scientific agent, not an audit product, paper generator, or mandatory experiment pipeline.
- Scientific methods compose selectively; papers are outputs and experiments are optional investigation strategies.
- Research artifacts are authoritative; model output is not evidence.
- Study design is blocked until source-level positioning records an `advance` or `pilot-only` decision.
- Refuting, null, inconclusive, and failed outcomes remain visible and cannot be converted into confirmation by repeated testing.
- Structural audit results never imply scientific merit, truth, ethics approval, or publication readiness.
- Dialogue, artifact, source, and terminology languages are independent scopes; translation never strengthens a claim.
- CATAIL imports only the stable extension host type surface and does not depend on another extension.
