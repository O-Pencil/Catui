<!-- Goal-interview wizard specification. For use by teaching agents. Does not contain learner results. -->

# wizard — Goal interview (tailoring a personalized path)

Teaching agents use this wizard before opening the first lesson, to turn the learner's goal into a personalized path trimmed from `catui-course-pack.md`. Reuses oh-my-wiki's guided-interaction style; adds "learning a codebase" specific questions.

## Step 1 — Create or pick a personal vault (oh-my-wiki)

```
/wiki init catui            # creates a personal vault at HUB/topics/catui/  (or --local to create at <project>/.wiki/)
```

The wizard confirms the HUB path (`hub_path` in `~/.config/llm-wiki/config.json`, default `~/wiki`). One learner, one vault; everyone creates their own.

## Step 2 — Three-question goal interview

Ask only three things; don't add more:

1. **What do you want to accomplish (mission)** — Why are you learning catui: fix bugs? add features? do an integration (O-Pencil / Gateway)? Or understand the whole thing?
2. **How much do you already know (level)** — gauge the learner's depth and calibrate explanation density:
   - L0 absolute beginner: "I know nothing" / "what is this?" → full analogies, few terms
   - L1 newcomer: knows it's a CLI agent → bridge from what they already know
   - L2 practitioner: has used it, knows the core concepts → go straight to real code
   - L3 proficient: asks details / why → straight into architecture and trade-offs
3. **Success criterion (success)** — after you're done, what should you be able to do? (Recite X's data flow / independently debug Y / add an extension Z)

Write these three lines into the mission area of the personal vault (see `kb-integration.md`); they become the basis for trimming the path and the completion criteria.

## Step 3 — Trim a path from the course pack

The fundamentals in `catui-course-pack.md` are C0–C10 (orientation to core runtime to extensions to expression to ecosystem / meta-layer), with dependency edges. Trim by mission:

| Learner says | Recommended path |
|--------------|------------------|
| "I want to understand the whole thing" | Full C0 to C10 in dependency order |
| "I want to change agent behavior / loop" | C0 (orientation) to C1 (Agent Loop) to C2 (context) to C4 as needed (tools) |
| "I want to add / adjust tools" | C0 to C1 to **C4 tool system** to C5 (extensions contributing tools) |
| "I want to write extensions" | C0 to C5 (extension system) to C4 to C8 (prompt / skills) |
| "I do O-Pencil / Gateway integration" | C0 to C1 to C3 (model / SDK) to **C9 ecosystem integration** |
| "I want to debug some specific issue" | C0 to jump directly to the relevant concept; focus on its "debugging entry" |
| "I only want to learn one specific thing" | Skip the path; teach that one concept directly |

**Trimming principles**:
- Always start with C0 (orientation). Even if the learner is in a hurry — without the DIP map, every later lesson takes twice as long.
- Respect dependency edges: prerequisites are taught first (each lesson lists its "dependency edges" in the course pack).
- The path is a suggestion, not a law: skim fast when you're comfortable, slow down and add analogies when you're stuck.

## Step 4 — Hand off to teaching

Pass "chosen vault + mission + trimmed path (concept id list) + first cursor" to `teaching-method.md` to start the first lesson. After each concept is done, come back here for the next cursor, until the path is walked.
