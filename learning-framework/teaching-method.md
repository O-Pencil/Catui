<!-- Uniform specification for running one lesson. Used by any teaching agent. Follows catui's teach method, does not modify its code. -->

# teaching-method — How to run one lesson

Any agent that supports the `teach` method follows this spec to teach one concept. Catui ships with the `teach` extension (`/teach <topic>`, progressive state machine); agents that don't have it can still run the same flow manually by following this document.

## Progressive structure (one lesson per concept)

Following the `teach` layer model, from "why does this matter" to "deep into the how":

| Layer | Goal | How |
|-------|------|-----|
| **Hook** (L0) | Why this concept matters | One sentence on what real pain it solves |
| **L1** | One-sentence version + core analogy | Bridge with everyday / already-known concepts |
| **L2** | How it works + one example | Draw the data flow; give a minimal realistic example |
| **L3** | Deep dive + real scenario | Go into real code; discuss "why it's written this way" |
| **Bridge** | What this means for you | Connect back to the learner's mission |
| **Takeaways** | Three core points | Include at least 2 "debugging entry points" |

Adjust depth by the learner's level (L0–L3 from the wizard): L0 gets more analogies and fewer terms; L3 jumps straight into architecture and trade-offs.

## Three hard rules

1. **Every claim carries a source.** When teaching implementation, give a `file:line` (e.g. `core/runtime/agent-session.ts:1117`) so the learner can open it and verify. `catui-course-pack.md` already prepares anchors for every concept; when going deeper, verify and add more live. The source-credibility ladder is below.
2. **Focus on three questions.** Every lesson must answer: **why is it written this way / why does this capability live here / where to look when it breaks.** These three are more important than "what does it do" — the latter you can read from code.
3. **Check understanding, don't lecture.** Pause after each layer and have the learner paraphrase or ask questions. If they can't paraphrase, switch analogy and re-teach the layer — don't push on.

## Source credibility (when teaching code)

| Level | Source |
|-------|--------|
| 5 / 5 | Direct read of source `file:line`, P2 `AGENT.md` member list, P3 file header |
| 4 / 5 | In-repo design docs: `.dev-docs/`, `AGENTS.md`, `llm-wiki/` |
| 3 / 5 | commit message / PR description |
| 2 / 5 | inference (must be marked "inference") |

When teaching an implementation you aren't sure about, **read the source first, then teach** — never go from memory. This is the same principle as "audit before you analyze".

## "Done" criteria for one lesson

Only when these are met can the learner move to the next concept:

- The learner can **paraphrase the concept's data flow in their own words**.
- They can name **at least 2 debugging entry points** (where to look when this capability breaks).
- Connected to the mission (they know what this means for their own goal).

## End of lesson — deposit (required)

At the end of every lesson, deposit the understanding into the learner's personal vault — see `kb-integration.md`. Minimum:

1. Write / update `wiki/concepts/<Cx-concept>.md` (learner-perspective understanding + sources + debugging entries, with backlinks to neighboring concepts).
2. Run `/wiki:ll` to extract this session's stuck points / corrections / discoveries, into the vault's `log/lessons`.
3. In the personal vault's progress area, mark the concept as done and record the next cursor.

> Important: deposit into the **learner's personal vault**, not into the catui repo or `learning-framework/`.
