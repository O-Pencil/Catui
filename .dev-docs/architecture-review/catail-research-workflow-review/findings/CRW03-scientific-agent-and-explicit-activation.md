# CRW03 — Reposition CATAIL as an Explicit Scientific Agent Skill

## Evidence

User alignment showed that the workflow-first framing made CATAIL behave like an audit harness and made ordinary scientific requests look like a mandatory paper-production pipeline. It also left an activation ambiguity: Catui is primarily a coding agent, so words such as “discover,” “test,” “experiment,” or “paper” must not silently transfer control to CATAIL.

The desired product analogy is CATPAW: one professional Skill with a concise router, progressively loaded craft knowledge, and durable project context. CATAIL is the scientific counterpart—a professional scientific collaborator that can select and compose methods rather than forcing every task through every stage.

## Decision

- Keep CATAIL registered through Catui's standard Skill system. The canonical TUI invocation is `/skill:catail <request>`; no dedicated `/catail` command or controller is added in this revision.
- Permit natural-language activation only when the user explicitly names CATAIL, such as “use CATAIL” or “使用 CATAIL.” Do not infer activation from scientific vocabulary or from ordinary coding investigation.
- Reposition the product as **CATAIL — Professional Scientific Agent**, not an “auditable research workflow.” Evidence provenance, auditability, and reproducibility remain cross-cutting scientific stewardship rather than the product identity.
- Add a scientific-method catalog that explains when each research mode applies, what evidence it can produce, what it cannot establish, its validity risks, quality floor, common combinations, and exit conditions.
- Route tasks through a shared scientific inquiry lifecycle while selecting the smallest sufficient combination of methods. A paper is an output, not a mode; an experiment is one possible investigation strategy, not the default destination.
- Separate dialogue language, artifact language, source language, and terminology. Explicit scoped language instructions win and translation must not strengthen claims.
- Preserve V2's position-before-design and evidence-state protections, but present durable artifacts and deterministic audit as optional project-memory and stewardship support appropriate to the task.

## Architecture fit

The owner remains `extensions/builtin/catail/`. This is a Skill-content and bounded bootstrap change only: no core import, runtime controller, command registration, tool, dependency, public protocol, timer, network call, or automatic workspace write is introduced.

## Acceptance

- The bootstrap and Skill description say explicit CATAIL naming is required and forbid keyword-based activation.
- `/skill:catail` remains the standard explicit invocation; no `/catail` extension command is registered.
- `SKILL.md` identifies CATAIL as a professional scientific agent and routes by intent, current epistemic state, requested endpoint, stop boundary, and language scope.
- One linked scientific-method catalog covers all nine aligned research modes and supports selective composition.
- Lifecycle, decision-gate, epistemic-state, and language rules are available through progressively loaded foundation references.
- Existing position-before-design, source verification, falsification, negative-result, and claim-evidence invariants remain intact.
- Focused tests, Skill Creator validation, and all repository acceptance gates pass.
