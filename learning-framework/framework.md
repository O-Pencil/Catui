<!-- Portable learning framework methodology. Does not contain learner results. -->

# framework — "Learn a codebase" methodology

## Why this framework is needed

When reading a codebase you didn't write and many people maintain, the common trap is: **you know what capabilities exist, but not how they're implemented, why they're written that way, or where to look when something breaks.** Two existing tools each solve half the problem:

- `teach` (pedagogy engine) can walk you through a concept step by step, but its output is dumped flat into `.catui/teach/`: no backlinks, no graph, no system.
- `oh-my-wiki` (knowledge base) can organize knowledge into an Obsidian-style personal wiki, but it doesn't *teach* — reading a wiki is not the same as being taught.

This framework wires the two together and fills the missing middle: **how to systematically decompose a codebase into "learnable concepts", teach them in dependency order, and deposit each step's understanding into your own, networked personal knowledge base.**

## Core ideas

1. **Concepts cross-cut, not by directory.** The unit of learning is a question a maintainer would ask ("how is this thing structured?" / "how does a turn run?" / "how are tools registered?"). One concept can span many files and modules. Directory structure is how you look up the map, not the unit of learning.
2. **Wayfinding first.** Learn "how to find your own way" (read the DIP code map: P1 / P2 / P3) before diving into any specific subsystem. Teach a person to fish.
3. **Sources are verifiable.** Every claim carries a `file:line`, so the learner can open it and check. This also trains the "where do I look when something breaks" muscle.
4. **Understanding is the debugging map.** Every concept carries an entry point for "broken first, look here". Finishing a lesson leaves you with a triage ability.
5. **Results belong to the person.** The output of learning is **your understanding of this project**; it belongs to you and lives in your vault. The repo stays clean; each learner keeps their own.

## Runtime flow

```
Learner                Teaching agent               oh-my-wiki (personal vault)
  |                       |                              |
  |-- I want to learn ---->|                              |
  |                       |-- /wiki init catui ---------->|  create / pick personal topic vault
  |<-- goal interview ----|                              |
  |-- goal / prior / std->|                              |
  |                       |  trim path from course-pack  |
  |<== run lesson =======|  progressive + file:line src |
  |-- my Q's / thoughts ->|                              |
  |                       |-- write concept note ------->|  wiki/concepts/<Cx>.md (backlinks + frontmatter)
  |                       |-- /wiki:ll extract lessons ->|  log.md / stuck points
  |<-- next cursor ------|                              |
```

Per-concept loop: **interview to tailor path → run lesson → deposit into personal vault → take next concept.** Progress lives only in the personal vault (each person is independent). The framework itself is stateless and reads only the studied object.

## Boundaries with the three parties

- Reuses `teach`'s **method** (does not modify its code; see [[teaching-method]] `teaching-method.md`).
- Reuses `oh-my-wiki`'s **storage and commands** (`/wiki:init`, `/wiki:ll`, `/wiki:query`; see [[kb-integration]] `kb-integration.md`).
- This framework only produces **method conventions + a course catalog** (`catui-course-pack.md`). None of the three contain learner results.

## Applying to another codebase

`framework.md` / `wizard.md` / `teaching-method.md` / `kb-integration.md` are **project-agnostic**. For a different codebase, you only need to write a "fundamentals catalog" for that codebase, following the field format of `catui-course-pack.md` (ideally derivable from that repo's code map / wiki); the rest is reused as-is.
