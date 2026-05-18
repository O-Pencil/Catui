# .dev-docs/ — Pencil Maintainer Handbook

> ⚠ **Audience: pencil maintainers only.** Documents below describe internal R&D tooling, the developer-owned insforge backend, and exploratory features. None of this is a user-facing surface. Code referenced here that lives under `scripts/` is invoked **manually by maintainers**, not auto-loaded into user sessions, not bundled into default extensions, not consuming user tokens.
>
> If you are a pencil **user**, you do not need to read this directory. The product surface lives in `README.md`, `CLAUDE.md`, `AGENTS.md`, `.PENCIL.md`, and `docs/` (the operational/scratch directory).

---

## Why this exists

Three lines of work share the same developer-owned insforge backend and the same code substrate. Without a handbook they become tribal knowledge and rot.

| Line | What it explores | Where its docs live |
|------|------------------|---------------------|
| **SAL** (Structural Anchor Learning) | how pencil builds an experience-driven cognitive map of its workspace | `sal/` |
| **Diagnosis** | how maintainers triage explicit `pencil_issue_events` defects | `diagnosis/` |
| **Self-Awareness** | how pencil reads its own runtime traces and surfaces implicit problems | `self-awareness/` |

All three read overlapping fields out of the same tables. The shared substrate is documented under `data/`.

---

## Directory map

```
.dev-docs/
├── README.md                  ← this file (entry point)
├── data/                      ← the developer insforge backend; what's in it, how it's used
│   └── field-purpose-matrix.md  (forthcoming — A in the GSA rollout)
├── sal/                       ← SAL experiments
│   ├── roadmap.md              (forthcoming — migrated from docs/SAL总体路线...)
│   ├── cognitive-map.md        (forthcoming — migrated from docs/认知地图架构草案.md)
│   └── eval-method.md          (forthcoming — migrated from docs/SAL实验评估方式...)
├── diagnosis/                 ← explicit issue triage
│   ├── sop.md                  (forthcoming — migrated from docs/daily-issue-sop.md, rewritten)
│   └── audit-2026-05-17.md     (forthcoming — migrated from docs/insforge-audit-2026-05-17.md)
└── self-awareness/            ← implicit self-observation
    └── charter.md              (here; governance + roadmap)
```

Empty subdirectories above will fill in during step D of the GSA rollout (document migration). The matrix at `data/field-purpose-matrix.md` is step A.

---

## Boundary contract (do not violate)

1. **No code in `extensions/defaults/`** as part of self-diagnosis or maintainer tooling. Default extensions auto-load in user sessions and consume user tokens.
2. **No writes to user-side persistent state** (`~/.pencils/agents/<id>/mem-core/`, `~/.pencils/agents/<id>/soul/`) from anything in this directory's scope. Self-diagnosis observes; it does not mutate user behavior.
3. **No insforge credentials in pencil source.** The backend is developer-owned; credentials live in `.memory-experiments/credentials.json` (gitignored) or `NANOPENCIL_*` env vars supplied by the maintainer.
4. **No cron / no schedule routines for self-diagnosis.** All runs are manual maintainer dispatch from `scripts/`.
5. **`variant` field discipline.** Runs originating from `scripts/self-diagnosis/` must write `eval_runs.variant='self-diagnosis'` (not `'sal'`), so SAL experiment data and self-diagnosis data do not pollute each other.

---

## Reading order for a new maintainer

1. `data/field-purpose-matrix.md` — what data exists, which fields are alive, what each is for.
2. The subdirectory matching your goal (`sal/` for cognitive map work, `diagnosis/` for triaging open tickets, `self-awareness/` for reflexive-task R&D).
3. `self-awareness/charter.md` is the long story of how this whole structure came to be — useful once you've seen the data.

---

## Provenance

- 2026-05-17: created during the GSA rollout. SAL and self-diagnosis work prior to that lived in `docs/` (gitignored) and is being migrated in here.
