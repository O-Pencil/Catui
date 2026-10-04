# Feature Development Workflow

> **Must-read before any development.** This codifies the architecture-review mindset (how to design at the top level, how to review feature quality) into **the same judgment flow every feature walks through**.
> Entry link from root P1 [`AGENTS.md`](../AGENTS.md). Refactor-outcome conclusions live in [architecture-review/REFACTOR-LEDGER.md §1b](./architecture-review/REFACTOR-LEDGER.md).

```yaml
doc: feature-workflow
status: canonical
applies_to: All new features / refactors / bugfixes (tiered by blast radius, see §3)
supersedes: REFACTOR-LEDGER §1c (graduated into this document)
```

---

## 0. Why this document exists

The refactors (P0–P6) layered the project, established owners, and added gatekeeper rules. But **layering is only valuable if everyday development keeps respecting it** — otherwise in a few months you grow new god files, reverse dependencies, and duplicate rules all over again.

This document = turning architecture review from a "one-off refactor handbook" into **the same set of judgments every feature walks through**. Goal: when developing a new feature you can **feel the architecture**, instead of re-reading the directory structure from scratch every time just to figure out where to write.

---

## 1. Core principles

> Architecture review is **not** writing more docs before writing code. It's asking the same set of questions clearly before writing code:

1. **Owner**: does the capability this change touches have a clear owner today? (core / mode / extension / package / platform / build)
2. **Layer fit**: does the change respect existing layers — no cross-layer, no reverse import, no duplicated rule in two places?
3. **Reward vs abstraction**: does the new abstraction's payoff exceed its understanding / maintenance cost? (branches that can be deleted > branches that can be written correctly)
4. **Acceptable**: does the feature behave as expected (or unchanged), and **can it be reproduced automatically or manually**?

---

## 2. The four-step loop (every feature walks it)

| Step | Question | Must-read material | Output |
|------|----------|--------------------|--------|
| **1. Feature intake** | What capability is changing? Which layer does it land in? | **§2b Layer-ownership decision** (core), the target-state notes (in git history under `architecture-review/target-architecture.md`), the relevant module's P2 `AGENT.md` | One-sentence intent + blast-radius list + **directory placement** |
| **2. Feasibility & boundary** | Does the current architecture already have an owner? Risk of cross-layer / reverse import / duplicate rules? | Relevant P2/P3, [`evolution/dev-conventions.md`](./architecture-review/evolution/dev-conventions.md), historical review/finding | Placement judgment: **pure move / local edit / hybrid / needs dedicated review** (§3) |
| **3. Architecture-fit design** | How to implement within existing layers without adding new coupling? | §4 implementation principles | Design draft: owner, ports, dependency direction, compatibility, token / perf impact |
| **4. Acceptance review** | Does the feature work? Docs in sync? Gates green? | §5 acceptance gates | Verdict: **pass / need more tests / need ADR for trade-off** |

> Steps 1–2 usually take a few minutes; only when Step 2 judges "needs dedicated review" do you walk the heavier §3 flow. **Most small changes stop at this table.**

---

## 2b. Layer-ownership decision (Step 1's core: where does this feature live?)

> This is the easiest step to get wrong, with the deepest impact. Remember one sentence: **two orthogonal axes — don't mix them.**

### Two orthogonal axes

| Axis | What | Values | Answers |
|------|------|--------|---------|
| **Concept axis** (product cognition) | What **kind** of capability | 🧠 Cognition ·  Tool · 🎨 Interface | Helps you think through dependencies and surface |
| **Structure axis** (code ownership) | Where the code **lives** + dependency rules | `packages/` · `core/` (including `lib/` `platform/`) · `modes/` · `extensions/` | **Determines file placement** |

> **Warning:** **The two axes are completely orthogonal** (conclusion from top-level review candidate D): a feature has both a concept layer **and** a directory home; they are **not 1:1**.
> Example: `teach` is conceptually 🧠 Cognition, but structurally lives in `extensions/`. **Don't stuff it into `core/` just because it is "a cognitive capability."**

### Structure-axis decision tree (determines file placement)

Ask in order; the first "yes" is the answer:

1. Is it an **independently publishable library** (own version, consumers outside the host, resolvable via npm semver)? → **`packages/`**
2. Is it a **zero-business cross-cutting primitive** (config / i18n / telemetry / exec / utils, no business knowledge at all)? → **`core/platform/`**
3. Is it a **runtime primitive reused by multiple modes / extensions** (session / tools / model / mcp / prompt / runtime)? → **`core/`** corresponding subdomain
4. Is it a **new I/O paradigm** (like interactive / print / rpc / acp), or mode-specific adaptation / rendering? → **`modes/`**
5. Is it a **user-perceivable capability / behavior** (slash commands + tools + behavior hooks + renderer)? → **`extensions/`** (default landing)

> **Default rule**: **new user-perceivable features go into `extensions/` by default.** Only when something is genuinely "a runtime primitive reused by multiple modes / extensions" does it land in `core/`; only when "an independently publishable library" does it land in `packages/`; only when "a new I/O paradigm" does it land in `modes/`.

### Per-layer constraints (MUST / CAN / MUST-NOT)

| Layer | MUST | CAN | MUST-NOT |
|-------|------|-----|----------|
| **`packages/`** | Independent version + files; npm-semver-resolvable; no host-reverse dependency | Stable protocols (protocol), reusable domain engines (mem-core / soul-core) | [ ] App features; [ ] things only the host uses (that's `core/lib/`); [ ] depends on host-internal symbols |
| **`core/`** | Runtime primitive reused by multiple modes / extensions, with a clear owner | Add a clearly-defined runtime subdomain | [ ] Single-feature business logic; [ ] UI; [ ] logic serving only one extension |
| **`core/lib/`** | Only ai / agent-core / tui — three forked internal libraries | — | [ ] Non-forked new code; [ ] remove `private:true` / publish |
| **`core/platform/`** | Cross-cutting primitives with zero business knowledge | config / i18n / telemetry / exec / utils | [ ] Any business knowledge; [ ] reverse dependencies from business layers |
| **`modes/`** | A new I/O paradigm, or mode-specific adaptation / rendering | Mode-internal controllers (capability-context) | [ ] Cross-mode features (→ core / extension); [ ] business capabilities |
| **`extensions/`** | Consume core via `ExtensionContext` / protocol; `builtin/`=default-loaded, `optional/`=opt-in | Register tools / slash / keybindings / lifecycle hooks / message renderers | [ ] Direct imports of host-internal symbols; [ ] cross-extension dependencies; [ ] default-loaded without GB-2 declaration |

### Walkthrough: `teach` (users learn code etc. with it)

| Step | Judgment |
|------|----------|
| Concept axis | Primarily 🧠 Cognition (learning / cognition) + 🎨 Interface surface (`/teach` UX) + possibly  Tool (read code / run examples) |
| Structure-axis decision tree | ① Independently publishable library? No ② Zero-business primitive? No ③ Runtime primitive reused by multiple modes / extensions? **No** (it is one specific feature) ④ New I/O paradigm? No ⑤ User-perceivable capability? **Yes** → **`extensions/builtin/teach/`** (or `optional/` if you don't want it default-on) |
| Placement | `extensions/builtin/teach/index.ts`: register `/teach` command + teaching state machine + renderer; reuse core's session / tools / model via `ExtensionContext`; if you need new tools, register them as extension tools; UX is rendered naturally by the current mode |
| Constraint self-check | [x] MUST: add P3 header, register in `extensions/AGENT.md` P2; [x] MUST-NOT: no reverse imports of host-internals, **don't stuff teach business into `core/`**, no cross-extension dependencies; **Warning:** If default-loaded → it counts as a "default-enabled extension" = user-perceivable change, **must declare per GB-2** (see browser opt-in EV03) |

> **Counter-example**: writing `teach` logic into `core/runtime/` or creating `core/teach/` — this violates `core/`'s MUST-NOT (no single-feature business) and lets god-coupling grow back into the runtime. Conceptually cognitive ≠ structurally into `core/`.

---

## 3. When to upgrade to "dedicated review" (review first, code second)

If **any** of these hold, do not start writing directly; first create a dedicated review at `.dev-docs/architecture-review/<topic>-review/`:

- Touches **load-bearing area**: runtime / session, interactive mode, extension host, package / public API, build / release.
- Single file expected to exceed **> 400 lines**, or a new controller / context needs **≥ 8 capability ports**.
- Requires a **rewrite** rather than a pure move; or has **token-consumption / compatibility / performance / bundle-size** impact.
- Changes **public API / npm deps / default-enabled extension / CLI · TUI user paths**.
- **No clear owner can be found**, or the same rule has to be implemented in two modules.

Minimum artifacts for a dedicated review (see `runtime-session-review/` / `interactive-ui-review/` for the same shape):

```text
<topic>-review/
  README.md        # scope / status / decision / acceptance
  findings/UIxx-*.md   # one card per finding (boundary disputes / ownership risks)
  closure.md       # wrap-up: what was implemented, what was deferred, re-open conditions
```

> This flow has been validated by P4 (runtime-session-review, 12 cards) / P5 (interactive-ui-review, UI01-08) / P6 (entry-volume-review, EV01-05) / P7 (bundle-redesign-review, BR01-04) — they are the live template for "how to do top-level design + how to review feature quality." New reviews should copy their shape.

---

## 4. Architecture-fit implementation principles (patterns distilled from refactors)

When writing Step 3 design, follow these patterns already locked in by gatekeepers:

| Principle | Meaning | Counter-example |
|-----------|---------|-----------------|
| **capability-context** | Controllers / services only receive a **narrow context of named capability closures** | Passing whole `InteractiveMode` / `AgentSession` (service-locator) |
| **single owner** | Each side effect / overlay / state has exactly one owning module | Same state scattered across multiple `this._` |
| **DIP P1/P2/P3** | Map and terrain stay isomorphic: new files get P3 headers, new modules register in P2, deletes / moves sync P2 | Code change without doc sync |
| **Single dependency direction** | `platform/` is zero-business, not reverse-depended on by business layers; `core/lib/*` are internal libs; `packages/*` are real published packages | Host reverse-imports internal library internals |
| **Token / perf neutrality** | Refactors must not silently increase LLM calls / prompt-context / send volume | Tearing apart UI happens to also change what's sent to the model |

See per-review subdirectories for the WHY (historical decision files): [runtime-session-review](./architecture-review/runtime-session-review/) · [interactive-ui-review](./architecture-review/interactive-ui-review/) · [entry-volume-review](./architecture-review/entry-volume-review/) · [bundle-redesign-review](./architecture-review/bundle-redesign-review/) · [sdk-surface-review](./architecture-review/sdk-surface-review/).

---

## 5. Acceptance gates (automated + manual)

| Gate | Purpose | Command | CI status |
|------|---------|---------|-----------|
| **DIP** | map-terrain isomorphism | `npm run verify:dip` | [x] `ci.yml` |
| **Quality** | No cycles + no boundary pollution | `npm run verify:quality` | [x] `quality.yml` |
| **Build / Type** | Compilable | `npm run build && npx tsc --noEmit` | [x] `ci.yml` |
| **Package boundary** | Public-package vs internal-library boundary (BR01) | `npm run verify:package-boundary` (`:dist` verifies embedded libs resolve) | [x] static→`quality.yml`; `:dist`→`ci.yml` (post-build) |
| **Public API** | Compatibility explicit | Symbol diff against `architecture-review/baseline/public-api-symbols-main.txt` | Manual; **don't break by default; intentional API diffs require an intentional-diff declaration (major window)** |
| **Token / perf** | No silent cost growth | Manual review: LLM call chain / provider laziness / prompt injection neutral? | Manual |
| **UX smoke** | User paths still usable | Per the smoke checklist (in git history under `architecture-review/beta-smoke-checklist.md`) | Manual, focused on default paths + error fallbacks |

> **All 5 automated gates are wired into CI** (DIP / quality / build / tsc / package-boundary). Manual gates (public API diff / token-perf / UX smoke) are walked per PR review and the smoke checklist as needed.

---

## 6. PR self-check list

Walk through this before opening a PR (corresponds to §5):

- [ ] Changed / added files all have P3 headers; new modules / directories registered in P2 `AGENT.md`; deletes / moves synced to P2.
- [ ] `verify:dip` / `verify:quality` / `verify:package-boundary` green locally.
- [ ] `build` + `tsc --noEmit` green.
- [ ] No new reverse imports / service-locator context / duplicated rules.
- [ ] Public API unchanged; if changed, the PR description explicitly declares intentional diff + blast radius.
- [ ] LLM calls / prompt / send-volume is token-neutral, justified.
- [ ] Changes touching user paths went through the relevant UX smoke.
- [ ] §3 trigger conditions hit → dedicated review created and linked.

---

## 7. References (sources for the review mindset)

- `architecture-review/methodology.md` (git history) — Review vocabulary and cognition layers (Phenomenon / Essence / Philosophy).
- `architecture-review/target-architecture.md` (git history) — Target directory + functional-domain mapping.
- [`architecture-review/REFACTOR-LEDGER.md`](./architecture-review/REFACTOR-LEDGER.md) — Refactor-outcome conclusions, found issues, accepted trade-offs, outstanding items (P7 / P8).
- [`architecture-review/evolution/dev-conventions.md`](./architecture-review/evolution/dev-conventions.md) — Post-refactor development conventions.
