# CATAIL Scientific Agent Evolution Review

```yaml
status: accepted-v3
owner: extensions/builtin/catail
scope: explicit-use professional scientific agent skill, method knowledge, project memory, deterministic local audit
trigger: default extension and user-facing workflow change
```

## Intent

Evolve CATAIL from an evidence-traceable workflow into Catui's professional scientific agent Skill. V3 keeps V2's position-before-design and evidence protections while adding explicit activation, composable scientific methods, epistemic-state reasoning, task and language routing, and a lifecycle that supports papers, experiments, synthesis, theory, replication, and other scientific outputs without forcing all modes into one pipeline.

## Placement decision

CATAIL is a user-visible capability, not a reusable runtime primitive or independently published package. It therefore belongs in `extensions/builtin/catail/`. The extension consumes only `ExtensionAPI`, registers resource discovery and a bounded bootstrap prompt, and owns all CATAIL-specific instructions and assets.

No CATAIL type crosses a publish boundary. V1 adds no protocol types, core imports, slash command, controller, background loop, model call, or cross-extension dependency.

## Architecture

| Surface | Owner | Decision |
|---|---|---|
| Skill selection | `SKILL.md` | Activate only when CATAIL is explicitly named; route one scientific intent without preloading all methods. |
| Scientific method selection | `references/foundations/scientific-methods.md` | Select and compose the smallest sufficient research-mode set from nine documented modes. |
| Scientific reasoning | `references/foundations/scientific-reasoning.md` | Preserve observation, hypothesis, evidence, claim, conclusion, epistemic state, and language distinctions. |
| Lifecycle and routing | `references/foundations/lifecycle-and-routing.md` | Choose entry, endpoint, stop boundary, decision gates, and justified backtracking. |
| Durable research truth | User project `research/` artifacts | Files, not conversation memory, are authoritative. |
| Stage guidance | `references/*.md` | Separate frame, search, claim, position, design, experiment, analyze, iterate, visualize, write, review, and audit playbooks. |
| Artifact contracts | `templates/` and `references/artifact-contracts.md` | Keep searches, retained sources, hypotheses, position decisions, claims, studies, runs, iterations, and evidence traceable with explicit IDs. |
| Deterministic checks | `scripts/audit.mjs` | Local, bounded, dependency-free checks; never judges novelty or scientific merit. |
| Catui integration | `index.ts` and `builtin-extensions.ts` | Default resource discovery plus a short activation reminder. |

## Safety and evidence invariants

- A hypothesis, model response, search snippet, or draft is never evidence.
- Every factual or numeric manuscript claim must resolve to a claim ID and evidence record.
- Literature searches record query, source, date, scope, and known gaps; an empty search never proves novelty.
- Retained literature resolves to source IDs, and study design fails closed until positioning records `advance` or `pilot-only`.
- Result-driven hypotheses remain exploratory until a new protocol is frozen against new target data.
- Frozen study protocols are revised by new immutable revisions rather than overwritten silently.
- Confirmatory, exploratory, and post-hoc analyses remain distinguishable.
- Confidential or restricted material stays local unless an accountable human authorizes a named destination and scope.
- Human owners retain ethics, safety, authorship, scientific, and submission decisions.

## Upstream influence

The design adapts patterns rather than copying upstream text or code:

- CATPAW: one routing skill, durable project artifacts, task-specific playbooks, bounded verification.
- K-Dense Scientific Agent Skills: independent ideation followed by evidence checking, reproducible literature review, source verification, rival hypotheses, FINER-style question refinement without automatic scoring, critical evidence assessment, pre-data experimental design, effect-size and uncertainty reporting, truthful figures, evidence-bound writing, and confidential peer-review boundaries.

See `findings/CRW01-scope-and-default-activation.md` for the passive runtime boundary, CRW02 for position-before-design, and CRW03 for the professional-scientist positioning and explicit activation decision.

## Acceptance

- CATAIL is present in default extension metadata and paths.
- Resource discovery returns exactly the CATAIL skill entry.
- The bootstrap is short and only permits loading when the user explicitly names CATAIL; scientific keywords alone never activate it.
- The Skill identifies as CATAIL — Professional Scientific Agent and distinguishes research modes from lifecycle stages and output types.
- The scientific-method catalog covers all nine aligned modes and defines selective composition criteria.
- Every routed playbook exists and is linked from `SKILL.md`.
- The local audit accepts a complete fixture, rejects missing positioning before design, rejects confirmatory design under `pilot-only`, and rejects missing evidence bindings.
- DIP, quality, package-boundary, build, and `tsc --noEmit` gates pass.
