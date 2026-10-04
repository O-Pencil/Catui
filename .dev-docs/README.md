# .dev-docs/ — Catui Maintainer Handbook

> ⚠ **Audience: catui maintainers only.** Documents below describe internal R&D tooling and exploratory features. None of this is a user-facing surface. Code referenced here that lives under `scripts/` is invoked **manually by maintainers**, not auto-loaded into user sessions, not bundled into default extensions, not consuming user tokens.
>
> If you are a catui **user**, you do not need to read this directory. The product surface lives in `README.md`, `AGENTS.md`, and `docs/`.

---

## Why this exists

This directory holds the canonical development workflow and the post-refactor architecture conventions. The historical per-topic review notes (P0–P8) live in `architecture-review/` and serve as institutional memory; their internal `findings/`, `execution-plan/`, `closure.md` etc. were removed during the 2026-10 docs cleanup because the decisions had landed and the per-card narratives were tribal knowledge that no longer earns its place in a published repository. The retained review notes are the ones actively read by maintainers today.

A few historical subdirectories that have not yet been refilled — `sal/`, `diagnosis/`, `self-awareness/`, `data/` — were intentionally removed during the cleanup; the GSA rollout that was supposed to populate them is on hold. If / when that work resumes, this README and the directory map below will be the place to track it.

---

## Directory map (current)

```
.dev-docs/
├── README.md                  ← this file (entry point)
├── feature-workflow.md        ← canonical development workflow (mandatory reading per AGENTS.md)
├── OPEN-SOURCE-CLEANUP.md     ← working checklist for OSS-readiness (delete when finished)
├── architecture-review/       ← historical per-topic review notes (P0–P8 refactor)
│   ├── REFACTOR-LEDGER.md      ← sign-off / outcome index
│   ├── evolution/              ← post-refactor development conventions
│   ├── bash-{stdin-pipe,pre-execution-approval-decision}/   ← bash-tool ADRs
│   └── interactive-ui-review/  ← P5 UI-split review notes
└── vibe-coding/
    └── verification-plan.json  ← CI verification source of truth
```

The review directories and their internal `findings/` were **historical artifacts**, kept for traceability. Day-to-day development follows `feature-workflow.md`. The `architecture-review/REFACTOR-LEDGER.md` is the index for what each refactor phase did and what trade-offs were accepted.

---

## Boundary contract (do not violate)

1. **No code in `extensions/defaults/`** as part of maintainer tooling. Default extensions auto-load in user sessions and consume user tokens.
2. **No writes to user-side persistent state** (`~/.catui/agents/<id>/`, `~/.catui/agents/<id>/mem-core/`, `~/.catui/agents/<id>/soul/`) from anything in this directory's scope. Maintainer tooling observes; it does not mutate user behavior.
3. **No third-party backend credentials in catui source.** If a maintainer tool needs them, they live in `.memory-experiments/credentials.json` (gitignored) or in `CATUI_*` env vars supplied by the maintainer.
4. **No cron / no schedule routines for maintainer tooling.** All runs are manual maintainer dispatch from `scripts/`.
5. **`variant` field discipline.** Self-diagnosis runs must write `eval_runs.variant='self-diagnosis'` (not `'sal'`), so different tool's data do not pollute each other.

---

## Reading order for a new maintainer

1. `feature-workflow.md` — canonical development workflow (mandatory per AGENTS.md).
2. `architecture-review/REFACTOR-LEDGER.md` — what the refactor did and what trade-offs were accepted.
3. `architecture-review/evolution/dev-conventions.md` — current "where does new code go" rules.
4. The active review file matching your slice (e.g. `interactive-ui-review/handle-event-analysis.md` for a render-layer change, `bash-stdin-pipe-decision/ADR.md` for a bash-tool change).

---

## Provenance

- 2026-05-17: created during an internal "GSA rollout". Process records prior to that lived in `docs/` (gitignored) and were intended to be migrated in here.
- 2026-10: directory pruned during the docs cleanup — internal process records under `architecture-review/{findings,execution-plan,handoff,closure}` were removed (decision records moved to git history); the AGENT.md member list, `dev-conventions`, and `REFACTOR-LEDGER` remain. The `sal/`, `diagnosis/`, `self-awareness/`, and `data/` subdirectories were removed in the same pass; they will be repopulated only if a future initiative explicitly calls for it.
