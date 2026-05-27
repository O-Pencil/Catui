# Architecture Review Handbook

> ⚠ **Audience: a dedicated Architecture Review Agent.** Not for the self-diagnosis agent, not for users.
>
> **Purpose**: this handbook is the operations manual for a separate Claude Code agent (henceforth "the **Arch Agent**") that performs a one-time, systematic architectural review of the nanoPencil codebase. The Arch Agent runs in **a different session** from the self-diagnosis agent. Context separation is the point — daily diagnosis carries one set of priors (issue triage, fingerprint clusters), architectural review carries another (module depth, deletion tests, refactor backlogs). Mixing them would pollute both.
>
> **Source methodology**: this handbook synthesizes the mattpocock "Improve Codebase Architecture" skill (SKILL.md) with nanoPencil's own DIP protocol (P1 / P2 / P3 doctrine). The merger is documented in `methodology.md`.

---

## Why a separate handbook

The maintainer noticed in 2026-05 that nanoPencil's organic growth had outpaced its structural plan: the directory layout, packaging boundaries, and build pipeline had each accreted suboptimally over ~20 release cycles. Symptoms reported:

- Directory structure no longer maps to mental model
- Bundle size growing
- Build process is layered, fragile, and slow
- Hard to onboard onto changes that should be small

Self-diagnosis (the `daily-pencil-review` cron) catches **defects** — fingerprinted issues with explicit error signals. Architectural drift is a **non-defect** signal: nothing throws an error, the tests pass, the user sees no warning, but the *change cost per feature* has climbed. The Arch Agent's job is to surface this drift, prioritize it, and propose deepening refactors.

This is a one-shot exercise. After the maintainer has acted on the Arch Agent's findings, the codebase shape changes, and **future** architectural concerns should be folded back into self-diagnosis (with updated method) — not perpetuated as a separate program.

---

## Directory map

```
.dev-docs/architecture-review/
├── README.md                ← this file: entry point + intent
├── methodology.md           ← depth/seam/leverage/deletion-test, fused with DIP P1/P2/P3
├── inputs.md                ← what the Arch Agent reads before forming opinions
├── workflow.md              ← three phases: Explore → Report → Grilling
├── output-format.md         ← finding-card schema, refactor-plan schema
├── project-context.md       ← nanoPencil-specific anchors (key files, modules, history)
├── machine-constraints.md   ← hard limits (no build, no dev, RAM/disk guardrails)
└── handoff.md               ← boundary contract between the Arch Agent and the self-diagnosis agent
```

**Read order for the Arch Agent** (this is also `inputs.md` §1):

1. `README.md` (you are here)
2. `methodology.md` — internalize the vocabulary
3. `machine-constraints.md` — know what you cannot do
4. `handoff.md` — know what you must not touch
5. `inputs.md` — know what to read from the codebase
6. `project-context.md` — nanoPencil-specific orientation
7. `workflow.md` — the procedure
8. `output-format.md` — how to deliver

Skipping any step risks producing findings that miss the methodology, violate the boundary, or duplicate self-diagnosis's territory.

---

## Status

| Aspect | State |
|--------|-------|
| Handbook drafted | 2026-05-26 |
| Arch Agent first run | not yet — handbook ships before execution so the maintainer can review the methodology in isolation |
| Self-diagnosis cron alive in same session? | The Arch Agent runs in a **different session**; the daily diagnosis cron does not fire in the Arch Agent's session |
| Findings produced? | None yet |

---

## What this handbook is NOT

- **Not architectural findings.** No conclusions about the codebase live here. Findings go under `findings/` (a directory the Arch Agent creates the first time it runs).
- **Not a roadmap.** The roadmap is a Phase 3 output of the Arch Agent, lives at `refactor-plan.md` (created by Arch Agent).
- **Not the self-diagnosis SOP.** That lives at `.dev-docs/diagnosis/sop.md` and operates independently — see `handoff.md`.
- **Not modifiable by the self-diagnosis agent.** SOP §7 has been updated to enforce this.

---

## Provenance

- 2026-05-17: self-diagnosis Leg 1 (data audit) bootstrapped; maintainer noted architectural drift as a parallel concern but deferred.
- 2026-05-26: maintainer decided the two programs must be **parallel**, executed by **different agents**, in **different sessions**. This handbook is the first artifact for the architectural side.
- Source methodology: https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/SKILL.md — depth/seam/leverage/deletion-test vocabulary.
- DIP protocol: see root `CLAUDE.md` §"DIP Dual-phase Isomorphic Documentation Protocol".
