# AGENT.md

> P2 | CATAIL extension module map

## Purpose

Bundles CATAIL — Professional Research-to-Publication Skill as a passive, default-discovered Skill. CATAIL routes explicitly named work, plus scientific intent under the Vera persona, through a shared inquiry lifecycle, composable research methods, progressively loaded playbooks, optional durable project memory, and human-gated submission preparation without adding a core runtime controller or public protocol.

## Members

| File | Role |
|---|---|
| `index.ts` | Registers `resources_discover` for `SKILL.md` and a bounded explicit-activation reminder. |
| `SKILL.md` | Main CATAIL activation, capability, method, lifecycle, publication, language, safety, and routing contract. |
| `references/foundations/*.md` | Scientific method catalog, epistemic and language discipline, lifecycle, decision gates, and task routing. |
| `references/*.md` | Operational playbooks for framing, prior-art positioning, design, investigation, inference, iteration, writing, review, venue verification, submission, rebuttal, audit, and artifact contracts, loaded progressively. |
| `templates/` | Shape references for research charter, position and venue decisions, source/hypothesis/claim registers, studies, runs, analyses, iterations, evidence bindings, submission readiness, and review responses. |
| `scripts/audit.mjs` | Dependency-free, read-only structural audit for CATAIL artifacts. |
| `README.md` | User-facing overview and example invocation. |
| `THIRD_PARTY_NOTICE.md` | Attribution and adaptation boundary for CATPAW and K-Dense Scientific Agent Skills. |

## Invariants

- Extension runtime is passive: no timer, external process, workspace write, network call, tool, or command registration.
- CATAIL activates when the user invokes `/skill:catail`, explicitly names CATAIL, or selects Vera and provides scientific intent; scientific vocabulary alone never activates it outside Vera.
- CATAIL is a professional research-to-publication Skill, not a persona, audit product, paper generator, or mandatory experiment pipeline.
- Scientific methods compose selectively; papers are outputs and experiments are optional investigation strategies.
- Research artifacts are authoritative; model output is not evidence.
- Study design is blocked until source-level positioning records an `advance` or `pilot-only` decision.
- Refuting, null, inconclusive, and failed outcomes remain visible and cannot be converted into confirmation by repeated testing.
- Structural audit results never imply scientific merit, truth, ethics approval, or publication readiness.
- Current CCF classification, venue instructions, deadlines, and policies resolve to dated primary sources; the external submission action remains human-owned.
- Dialogue, artifact, source, and terminology languages are independent scopes; translation never strengthens a claim.
- CATAIL imports only the stable extension host type surface and does not depend on another extension.
