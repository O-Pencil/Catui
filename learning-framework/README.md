<!--
Portable learning framework + catui course catalog.
- Reusable "learn a codebase" framework for many people; decoupled from the catui runtime.
- Planned to live alongside O-Pencil/skills and oh-my-wiki; can be migrated out as a whole in the future.
- This directory does NOT contain any learner's personal results. Learning results live only in each person's own oh-my-wiki / Obsidian vault (user space, out-of-repo).
-->

# learning-framework — A general "learn a codebase" framework

A **reusable, codebase-agnostic** methodology that turns "reading code" into "learning + long-term retention."
The pedagogy engine reuses catui's `teach` extension (progressive teaching); the knowledge-base substrate reuses `@cunyu666/oh-my-wiki` (a personal Obsidian-compatible knowledge base). This framework is the **glue between them** plus a concrete **catui course catalog**.

## Three-party split

| Role | Who | Responsibility |
|------|-----|----------------|
| Pedagogy engine | catui `teach` extension | Progressive Hook to L1 to L2 to L3 to Bridge to Takeaways; level adaptation; source verification; comprehension checks |
| Knowledge-base substrate | `@cunyu666/oh-my-wiki` | Personal vault directory / backlinks / frontmatter / graph; `/wiki:*` commands |
| Glue + decomposition (this framework) | `learning-framework/` | How to decompose a codebase into learnable concepts, how to teach them, how to deposit understanding into a personal vault |

> **Key boundary**: the framework only reads the codebase being studied as its object; **learning results (your understanding / stuck points / notes) only go into your own personal vault — never into the catui repository.** Each learner keeps their own vault; they don't pollute each other.

## Contents

| File | Audience | Content |
|------|----------|---------|
| `framework.md` | Anyone wanting the overview | Methodology + three-party split + runtime flow |
| `wizard.md` | Teaching agent | Goal-interview wizard (asks goal / prior knowledge / success criterion; trims a personalized path) |
| `teaching-method.md` | Teaching agent | How to run one lesson (progressive teach + `file:line` source + completion criteria) |
| `kb-integration.md` | Teaching agent | How to deposit each lesson's understanding into the learner's oh-my-wiki personal vault |
| `catui-course-pack.md` | Learner / teaching agent | **Catui fundamentals C0–C10** (course catalog: concept / rationale / `file:line` / DIP node / debugging entry / edges) |
| `ecosystem-map.md` | Learner / teaching agent | Core to O-Pencil to Gateway integration + `@pencil-agent` drift (companion to lesson C9) |

## Entry points for the three reader types

- **Learner**: install `npm i -g @cunyu666/oh-my-wiki`; read `catui-course-pack.md` and pick a concept you want; let any `teach`-capable agent follow `wizard.md` to tailor your path and `teaching-method.md` to teach each lesson.
- **Teaching agent**: read `wizard.md` → `teaching-method.md` → `kb-integration.md` in order, using `catui-course-pack.md` as the syllabus.
- **Want to use this framework on a different codebase**: `framework.md` + `teaching-method.md` + `kb-integration.md` are generic; you only need to write a new "course-pack" (fundamentals catalog) for the target codebase.

## Prerequisites

- `@cunyu666/oh-my-wiki` (knowledge-base substrate).
- An agent that can teach using the `teach` method (catui ships with the `teach` extension; other Claudes can also teach by following `teaching-method.md`).
- (Optional) Obsidian for visualizing your personal vault's knowledge graph. The oh-my-wiki output is Obsidian-compatible but does not require the Obsidian app.
