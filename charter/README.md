# Catui Ecosystem Charter — Navigation Map

> **Status**: active (restructured 2026-05-23, split from single file into a directory)
> **Role**: the **single source of truth for the development roadmap** across all Catui-ecosystem projects
> **Host**: `charter/` directory in the Catui repository

<!--
[WHO]  Maintainers of all Catui-ecosystem projects and AI coding agents
[FROM] Three previously-scattered overviews: PROJECT_OVERVIEW.md, agent-projects-relations.md, docs/catui-platform-charter.md
[TO]   Implementation documents inside each project (each repo's docs/, issues/, tasks/)
[HERE] Catui/charter/ — the only source-of-truth directory for cross-project topology, terminology, phases, decisions, milestones
-->

---

## What this Charter is

The core problem the Charter solves: **a participant (human or AI) joining any repository needs to read only two things to get up to speed:**

1. **This Charter** (ecosystem-level)
2. **The current repo's README / AGENTS.md** (project-level)

Before the Charter, ecosystem-level facts lived in three separate places and covered only 4 projects. Now they are merged into the `charter/` directory, covering all 10+ projects.

### What the Charter does NOT contain

The Charter does **not** carry:
- API contract details → Gateway `docs/02`
- Protocol wire formats → Gateway `docs/18`
- Internal architecture → individual project repos
- Implementation task sheets → each project's `tasks/`
- Project-internal terminology → each project's README

**Rule of thumb**: a fact meaningful in only one project → does not belong in the charter; affects ≥ 2 projects → belongs in the charter.

---

## File index

| File | Content | What it answers |
|------|---------|-----------------|
| [01-ecosystem.md](./01-ecosystem.md) | Panorama | Which projects exist, how they layer, how data flows |
| [02-boundaries.md](./02-boundaries.md) | Boundaries | What each project is — and is not |
| [03-relations.md](./03-relations.md) | Relations | How projects call each other, how they collaborate |
| [04-glossary.md](./04-glossary.md) | Glossary | Canonical definitions of terms like Catui / CatuiAgent / ACP |
| [05-protocols.md](./05-protocols.md) | Protocols | HTTP/SSE, ACP, PCP, Channel — each one's positioning |
| [06-roadmap.md](./06-roadmap.md) | Roadmap | Phase 1→4 progress, work-line status A–F |
| [07-decisions.md](./07-decisions.md) | Decisions | Cross-repo significant decisions log |
| [08-pointers.md](./08-pointers.md) | Pointers | Jump links into each repo's documentation |

---

## Modification workflow

1. Any change to the charter is a **cross-repo impact** change and must go through a Catui repository PR
2. The PR description must state: (a) which file/section is changed, (b) which application repos must follow up
3. After merge, CI automatically opens `[charter-sync]` issues in the 5 core repos

## Avoiding duplication

When application-repo docs encounter any of the following content, they should **include only a short summary plus a charter link** — never copy the full text:

- Project topology / call-chain topology
- Terminology definitions (CatuiAgent / catui-agent and other common terms)
- Overall phase descriptions
- Cross-repo milestone progress
- Cross-project decisions

Application repos **can and should** contain:

- Internal architecture (modules, classes, file paths)
- API contracts / protocol wire formats
- Implementation plans
- Project-internal business terminology

## Sync detection

**Automatic layer** — was `.github/workflows/charter-sync-notify.yml`; the workflow was removed in this cleanup because it pointed at a non-existent file. Sync detection now relies on the manual layer below.

push to main with `charter/` directory changes: target repos are listed in [`08-pointers.md`](./08-pointers.md).

**Opt-out**: a commit message containing `[skip-charter-sync]` does not trigger.

**Manual layer**: when an application-repo PR contains large passages of content that "belong in the charter" → file a charter PR first.

---

## What content this Charter absorbs

| Source material | Action taken |
|-----------------|--------------|
| `PROJECT_OVERVIEW.md` (Catui root) | 10+ project panorama → 01-ecosystem; architecture layers → 01-ecosystem; per-project details → 02-boundaries |
| `agent-projects-relations.md` (Catui root) | Relations matrix → 03-relations; collaboration modes → 03-relations |
| `docs/catui-platform-charter.md` (Catui) | Glossary → 04-glossary; protocols → 05-protocols; phases/milestones → 06-roadmap; decisions → 07-decisions; pointers → 08-pointers |

---

## Maintainer documentation

> ⚠ This section is for **Catui maintainers**. Ecosystem participants do not need to read it.

Maintainer-internal runbooks, SAL experiments, diagnosis SOPs, architecture reviews, etc. all live under `.dev-docs/`, with this charter as their single entry point.

| Document | Content |
|----------|---------|
| [.dev-docs/README.md](../.dev-docs/README.md) | Maintainer-manual entry (what to read, where to start) |
| [.dev-docs/sal/roadmap.md](../.dev-docs/sal/roadmap.md) | SAL cognitive-graph experiment plan |
| [.dev-docs/diagnosis/sop.md](../.dev-docs/diagnosis/sop.md) | Daily issue-triage flow |
| [.dev-docs/self-awareness/charter.md](../.dev-docs/self-awareness/charter.md) | Self-diagnosis governance and roadmap |
| [.dev-docs/architecture-review/README.md](../.dev-docs/architecture-review/README.md) | Architecture Review Agent flow |

**Maintainer boundary contract**:
- No cron / no auto-scheduling; all runs are manually dispatched
- Do not write into user state (`~/.catui/agents/<id>/`)
- Do not inject internal tools into user sessions (outside `extensions/builtin/`)

---

**Covenant**: this directory is the single source of truth at the ecosystem level. Maintaining charter ↔ per-repo pointer isomorphism is equivalent to maintaining the credibility of the whole ecosystem documentation system.
