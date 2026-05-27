# Methodology

The Arch Agent's reasoning runs on two reinforcing lenses:

| Lens | Source | Asks |
|------|--------|------|
| **Depth / Seam / Leverage** | mattpocock SKILL.md | "Does this module carry weight proportional to its interface?" |
| **DIP P1 / P2 / P3** | root `CLAUDE.md` doctrine | "Is the map (docs) still isomorphic to the terrain (code)?" |

Use both for every finding. The lenses catch different failures: a module can be DIP-compliant (P3 header correct, P2 lists it, P1 navigable) but architecturally shallow (interface as fat as implementation). A module can be deep and well-leveraged but the P2 doesn't list it — a doc drift, not an architecture problem. Don't conflate the two — but report when one symptom exposes the other.

---

## 1. Vocabulary (mattpocock)

Every finding card in `output-format.md` uses these terms verbatim. Don't invent synonyms.

### 1.1 Module

Anything with **an interface and an implementation**. A file. A function. A package. A directory. A symbol exported across a boundary.

In nanoPencil terms:
- `core/runtime/agent-session.ts` is a module (interface = `AgentSession` class; implementation = ~3000 lines of orchestration).
- `extensions/defaults/diagnostics/` is a module (interface = the registered extension surface; implementation = the four files).
- A single function inside a file is a module if it's exported.

### 1.2 Depth

**Depth = high leverage behind a small interface**.

- A **deep** module: small surface (few methods, few flags, narrow types) hiding substantial behavior.
- A **shallow** module: interface complexity ≈ implementation complexity. Callers must understand internals to use it.

Litmus test: read only the exported names. Can you predict the cost of using this module? If yes (and the cost is well-bounded), the module is deep. If reading the names tells you nothing — shallow.

### 1.3 Seam

A **seam** is the point where the interface lives. It's where you can substitute behavior without editing the implementation.

- Good seams: interface boundaries (`extensions/defaults/sal/eval/types.ts:EvalSink`), DI hooks, plugin contracts.
- Missing seams: a module that *should* have a substitution point but the call site hardcodes the concrete implementation.

When you propose a refactor, name the seam: "introduce a seam at <line> so <X> can vary independently of <Y>".

### 1.4 Leverage and locality

**Leverage**: what callers gain from depth. Many callers, one place to change.
**Locality**: what maintainers gain. Edit one file to change one behavior; don't touch ten files in three directories.

A refactor recommendation must claim a leverage gain *or* a locality gain, ideally both. If neither — the refactor is taste, not architecture.

### 1.5 Deletion test (the most important signal)

For any module you suspect is shallow:

> **"If I delete this module, does the complexity it claims to manage now concentrate in callers, or does it just vanish?"**

- **Concentrates** → the module earned its keep. Its existence is doing work.
- **Vanishes** → the module is shallow scaffolding. It was hiding nothing.

Apply the deletion test to every finding. The card schema in `output-format.md` requires it.

---

## 2. Vocabulary (DIP — nanoPencil's own protocol)

### 2.1 P1 / P2 / P3 layering

| Level | File | Scope |
|-------|------|-------|
| **P1** | root `CLAUDE.md` | global topology, stack overview |
| **P2** | `<module>/CLAUDE.md` or `<module>/AGENT.md` | member list with one-line responsibilities |
| **P3** | each `.ts` file header | `[WHO] / [FROM] / [TO] / [HERE]` four-question contract |

### 2.2 Map–terrain isomorphism

The DIP protocol asserts that code (terrain) and docs (map) must be structurally consistent and mutually verifiable. Drift here is **not** an architecture problem per se — it's a maintenance debt. But severe drift often *masks* an architecture problem (the P2 listed a module that nobody owns; the P3 says `[FROM]: x` but x doesn't import this file anymore).

Run `npx tsx scripts/verify-dip.ts` early (read-only; safe under §machine-constraints). Note FATAL or SEVERE violations in your findings as supporting evidence — but don't make them the *main* finding.

### 2.3 The Four Questions (P3)

For each file you inspect deeply, mentally answer:

- **WHO** — what does this file export?
- **FROM** — what does it depend on?
- **TO** — who consumes its exports?
- **HERE** — where does it sit relative to its neighbors?

When the P3 header gets these wrong, the *answer the file actually gives* (vs. what the header claims) is itself architectural information.

---

## 3. How the two lenses combine

Some example failure modes and which lens catches each:

| Failure mode | Caught by | Example in nanoPencil |
|--------------|-----------|------------------------|
| Shallow module: interface ≈ impl | depth | A helper file with one function that's called once, used inline elsewhere |
| Missing seam: hardcoded coupling | seam | Tool registry tightly coupled to extension loader (hypothetical — verify) |
| DIP P3 lies: header says X imports, code says Y | DIP | A file whose `[FROM]:` lists `core/extensions/types` but actually imports from a deeper path |
| Right impl, wrong locality: change requires 5 files | leverage | (look in `extensions/defaults/` for one) |
| Module passes deletion test but P2 doesn't list it | DIP only | An untracked utility |
| Module fails deletion test AND P3 contract drifted | both | (the most actionable findings) |

**Findings that fail both lenses are the highest-value findings.** Highlight them first in the report.

---

## 4. What this methodology DOES NOT cover

- **Performance** (CPU, I/O, latency) — not in scope. The Arch Agent does not benchmark.
- **Security** (auth, injection, secrets handling) — out of scope. Self-diagnosis catches concrete security incidents via `pencil_issue_events`.
- **Code style** (formatting, naming nits) — out of scope. ESLint / Prettier territory.
- **Test coverage** — adjacent but not primary. The Arch Agent may note when a critical seam has no test, but does not pursue coverage as the main thread.
- **Feature requests** — out of scope. Architecture work serves features, doesn't replace them.

---

## 5. Calibration: severity vocabulary

When you write a finding, label its recommendation strength:

| Badge | Meaning | Used when |
|-------|---------|-----------|
| 🟥 **load-bearing** | If this finding goes unaddressed, future work will trip over it within weeks | Repeatedly observed friction; multiple symptoms point to it; deletion test fails decisively |
| 🟧 **structural** | Worth refactoring but not blocking; future work will be slower, not impossible | Friction observed once; deletion test inconclusive; depth borderline |
| 🟨 **opinionated** | Subjective improvement; reasonable engineers might disagree | Style/locality preference; depth genuinely ambiguous |

If you find yourself wanting a fourth badge, you're overthinking. Three buckets are enough.
