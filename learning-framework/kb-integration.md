<!-- Conventions for depositing each lesson's understanding into the learner's oh-my-wiki personal vault. Based on oh-my-wiki's measured structure. -->

# kb-integration — Depositing understanding into the personal knowledge base

Learning results (your understanding / stuck points / notes) go into **your own oh-my-wiki vault**, Obsidian-compatible, visualizable as a knowledge graph. This document maps the conventions onto oh-my-wiki's measured structure. **Do not write into the catui repo or `learning-framework/`.**

## Where the vault lives

The oh-my-wiki HUB is determined by `hub_path` in `~/.config/llm-wiki/config.json` (default `~/wiki`). Content lives in a **topic sub-wiki**: `HUB/topics/catui/`. Running `/wiki init catui` creates this structure (no Obsidian app required, but a `.obsidian/` config is included so you can open it in Obsidian directly):

```
HUB/topics/catui/
├── _index.md          # dashboard: stats + concept table + quick nav (= learning progress home)
├── config.md          # frontmatter (title/description) + Scope/Conventions
├── log.md             # activity / learning log (written by /wiki:ll)
├── raw/repos/         # reference to the studied object (catui repo pointer, immutable)
└── wiki/
    ├── concepts/      # ★ one note per concept learned (your unit of understanding)
    ├── topics/        # C0–C10 large sections (optional, groups concepts)
    └── references/    # quick-reference (commands / paths / debug checklists)
```

## One concept = one concept note

After teaching each concept, write `wiki/concepts/<Cx-slug>.md`, **from the learner's perspective** (what I understood), not a copy of source:

```markdown
---
title: "C1 Agent Loop Core"
category: concept
sources:
  - raw/repos/catui.md            # pointer to the studied repo
created: 2026-06-15
updated: 2026-06-15
tags: [catui, agent-loop, runtime]
confidence: medium              # self-rated: low/medium/high
volatility: warm
summary: "How one turn runs: AgentSession.prompt to agent-core Agent to model streaming to tools to refill to stop."
---

# C1 Agent Loop Core

> My understanding (in my own words)… how one conversational turn runs to completion.

## Data flow
AgentSession.prompt() (`core/runtime/agent-session.ts:1117`)
→ this.agent.prompt() (`:1270`) → agent-core while-loop (`core/lib/agent-core/src/agent-loop.ts:303`) …

## Why it's written this way
…(why the loop lives in agent-core, why the session only drives)

## Debugging entry points (broken first, look here)
- turn not stopping / infinite loop → stopping condition at `agent-loop.ts:303` while
- tool not being called → tool orchestration at `core/tools/orchestrator.ts`

## See Also
[[C2-session-context|C2 Context]] (the `C2-session-context.md` page is the next concept you write into your vault, in the same `wiki/concepts/` directory; the wikilink works once you've created it)
```

**Backlink convention** (single line that works in both Obsidian's graph and Claude's navigation):
`[[C2-session-context|C2 Context]]` plus the path-style link to the same file inside your vault. The point is "neighboring concepts link to each other"; Obsidian's graph then grows your "mental map" once you've written the C2 page.

**Frontmatter** must include `title/category/sources/created/updated/tags/summary`; `confidence` is self-rated (mark it `low` if you don't fully understand yet — that reminds you to revisit).

## Stuck points and discoveries to /wiki:ll

After each lesson:

```
/wiki:ll        # scan this session for error→fix, corrections, new discoveries; structure into vault log/lessons
```

This deposits "where I got stuck, why my earlier understanding was wrong" — the future-debugging gold mine.

## Progress and continuing (in the personal vault only)

- The status column of `_index.md`'s concept table + `log.md` = personal progress dashboard.
- cursor = the first concept not yet marked done; next time, any agent `/wiki:query` or reading `_index.md` knows where to continue.
- **Each learner has their own vault; progress is independent**. Neither the framework nor the catui repo tracks anyone's progress.

## Optional — import raw `teach` records

If the learner also used catui's `/teach`, its output lives at `<workspace>/.catui/teach/records/*.md` (already markdown). `/wiki:ingest` can merge these into `raw/notes/` in the personal vault, then you compile them into concept notes. The `teach` source code is unchanged; we just treat its output as one source.
