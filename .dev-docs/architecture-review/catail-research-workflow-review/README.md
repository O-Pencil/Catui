# CATAIL Research Workflow Review

```yaml
status: accepted-for-implementation
owner: extensions/builtin/catail
scope: default-discovered research workflow skill, artifact templates, deterministic local audit
trigger: default extension and user-facing workflow change
```

## Intent

Add CATAIL as Catui's evidence-traceable scientific workflow. The first release must help an agent move from a research question to literature mapping, study design, execution records, analysis, writing, and independent review without treating model output as scientific evidence.

## Placement decision

CATAIL is a user-visible capability, not a reusable runtime primitive or independently published package. It therefore belongs in `extensions/builtin/catail/`. The extension consumes only `ExtensionAPI`, registers resource discovery and a bounded bootstrap prompt, and owns all CATAIL-specific instructions and assets.

No CATAIL type crosses a publish boundary. V1 adds no protocol types, core imports, slash command, controller, background loop, model call, or cross-extension dependency.

## Architecture

| Surface | Owner | Decision |
|---|---|---|
| Skill selection | `SKILL.md` | Route one research task to one playbook; do not preload all stages. |
| Durable research truth | User project `research/` artifacts | Files, not conversation memory, are authoritative. |
| Stage guidance | `references/*.md` | Separate frame, search, claim, design, experiment, analyze, visualize, write, review, and audit playbooks. |
| Artifact contracts | `templates/` and `references/artifact-contracts.md` | Keep claims, studies, runs, and evidence traceable with explicit IDs. |
| Deterministic checks | `scripts/audit.mjs` | Local, bounded, dependency-free checks; never judges novelty or scientific merit. |
| Catui integration | `index.ts` and `builtin-extensions.ts` | Default resource discovery plus a short activation reminder. |

## Safety and evidence invariants

- A hypothesis, model response, search snippet, or draft is never evidence.
- Every factual or numeric manuscript claim must resolve to a claim ID and evidence record.
- Literature searches record query, source, date, scope, and known gaps; an empty search never proves novelty.
- Frozen study protocols are revised by new immutable revisions rather than overwritten silently.
- Confirmatory, exploratory, and post-hoc analyses remain distinguishable.
- Confidential or restricted material stays local unless an accountable human authorizes a named destination and scope.
- Human owners retain ethics, safety, authorship, scientific, and submission decisions.

## Upstream influence

The design adapts patterns rather than copying upstream text or code:

- CATPAW: one routing skill, durable project artifacts, task-specific playbooks, bounded verification.
- K-Dense Scientific Agent Skills: reproducible retrieval, rival hypotheses, pre-data experimental design, effect-size and uncertainty reporting, truthful figures, evidence-bound writing, and confidential peer-review boundaries.

See `findings/CRW01-scope-and-default-activation.md` for the default-load trade-off.

## Acceptance

- CATAIL is present in default extension metadata and paths.
- Resource discovery returns exactly the CATAIL skill entry.
- The bootstrap is short and only instructs the agent to load CATAIL when research work matches.
- Every routed playbook exists and is linked from `SKILL.md`.
- The local audit accepts a complete fixture and rejects missing evidence bindings.
- DIP, quality, package-boundary, build, and `tsc --noEmit` gates pass.
