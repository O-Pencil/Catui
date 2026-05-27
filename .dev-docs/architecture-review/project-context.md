# Project Context — nanoPencil-specific anchors

Pointers, not summaries. The Arch Agent uses this file to **locate** project-specific anchors, not to substitute for reading them. Reading the file itself is always required.

If a path or assertion below conflicts with the actual codebase, **the codebase wins** and the Arch Agent should flag the drift in their report (it's a finding).

---

## 1. Identity

- **Product**: terminal-native AI coding agent with persistent memory and evolving personality.
- **User-facing surface**: TUI (interactive mode), `--print` (stdout streaming), RPC (IDE integration).
- **Core pillars** (per root `CLAUDE.md`): terminal-first, privacy-first, extensible, fast.

The product intent is **not** "another coding assistant" — it's "an agent with memory continuity across sessions". This matters when judging refactors: a refactor that simplifies the codebase but breaks memory continuity guarantees is rejected on product grounds, not architecture grounds.

---

## 2. Top-level entry points (P1 chain)

| File | Role |
|------|------|
| `cli.ts` | CLI argument parsing entry |
| `main.ts` | Mode selection + bootstrapping |
| `config.ts` | Config discovery & loading |
| `index.ts` | Package barrel (SDK consumers) |

These are SOP §3.2 hard-core — **do not propose refactors here without strong justification**. They are stable contracts.

---

## 3. Major architectural strata

The codebase has four conceptual strata (per root `CLAUDE.md`):

```
ENTRY POINTS  →  CORE LAYER  →  TOOL LAYER  →  INTERFACE LAYER
```

- **Entry**: `cli.ts`, `main.ts`, `config.ts`, `index.ts`
- **Core**: `core/{runtime,extensions,tools,mcp,session,model,config,prompt,export-html,utils}/`
- **Tools**: `core/tools/{bash,read,edit,write,grep,find,ls,source}.ts`
- **Interface**: `modes/{interactive,print,rpc,acp}/`

Plus orthogonal packages: `packages/{agent-core,ai,tui,mem-core,soul-core}/`. These are "bundled npm packages" — published or publishable separately, with their own P2 documentation.

Plus extensions: `extensions/{defaults,optional}/` — auto-loaded or opt-in feature modules.

---

## 4. Known architectural friction (maintainer's own pre-walk hypotheses)

The maintainer flagged these symptoms before the Arch Agent walks the code. Treat these as **hypotheses to verify or refute**, not as conclusions.

| Symptom | Maintainer note |
|---------|-----------------|
| Directory structure no longer maps to mental model | Files keep accreting in `extensions/defaults/`; the line between "default extension" and "core feature" is fuzzy. |
| Bundle size growing | The published artifact has grown faster than the user-visible feature set; some packages may be heavier than their public surface justifies. |
| Build process is layered and fragile | `npm run build` chains: `bundle-deps.js` → `packages/ai` tsc → `packages/agent-core` tsc → root tsc → copy-assets. Failure modes are non-obvious. |
| Hard to onboard small changes | Adding a single new option to a tool requires touching ≥ 4 files across `core/tools/`, `packages/agent-core/`, type definitions, and registration. |
| `core/runtime/agent-session.ts` size | Known to be very large; possibly a god module. |

The Arch Agent walks the code and **independently** decides which of these is real, which is exaggerated, and what's missing from the list.

---

## 5. Where to look first (Arch Agent's accelerator)

These are highest-yield first inspections based on the symptoms above. The walking order in `inputs.md` §5 still applies — this is just where attention is likely to pay off most.

- `core/runtime/agent-session.ts` — file size + responsibility count
- `extensions/defaults/` member listing in `extensions/defaults/CLAUDE.md` — does the P2 match reality?
- `package.json` + `packages/*/package.json` — production dep footprint, devDeps leak
- `scripts/bundle-deps.js` and `npm run build:deps` order — failure modes
- `core/tools/` + `core/tools/index.ts` — orchestrator depth vs tool depth
- `core/extensions/types.ts` and `loader.ts` — extension contract surface
- `builtin-extensions.ts` (root) + `nanopencil-defaults.ts` (root) — root-level orchestration; their existence outside `core/` or `extensions/` is itself a signal

---

## 6. Constraints baked into the product (do not propose violating)

These are not refactor candidates. The Arch Agent should know them so it doesn't waste a finding suggesting them.

- **No Electron, no browser.** Terminal-first is a product pillar.
- **No telemetry from end users.** All telemetry the Arch Agent sees in InsForge is **maintainer-side R&D** data (sessions from developers who explicitly enabled SAL); users don't auto-upload.
- **Memory persists across sessions.** `~/.pencils/agents/<id>/` is the user-side state root. Refactors that change this format break backward compatibility — high cost, flag prominently if proposed.
- **Multi-provider model support.** `packages/ai/providers/` lists ~12 provider adapters. Reducing this list is a product decision, not an architecture call.
- **Extension system is plugin-shaped.** Removing extension extensibility is off the table.

---

## 7. Adjacencies to know but not own

These exist; the Arch Agent acknowledges them, doesn't deep-dive.

- **SAL** (Structural Anchor Learning) — an experimental subsystem under `extensions/defaults/sal/`. Has its own roadmap at `.dev-docs/sal/roadmap.md`. **The Arch Agent does not propose changes to SAL** unless they're at the boundary with non-SAL code.
- **Self-diagnosis** (this whole `.dev-docs/diagnosis/` + `scripts/self-diagnosis/` thing) — owned by a different agent. The Arch Agent's findings may reference self-diagnosis as adjacent context but never propose changes to its docs or scripts. See `handoff.md`.
- **Soul** (`packages/soul-core/`) — personality evolution. Treat as a "deep module" until proven otherwise; refactor proposals should respect that it has a published-ish API.
- **mem-core** (`packages/mem-core/`) — memory engine. Has its own `CLAUDE.md` and is the most semantically rich subsystem. Refactor proposals here have high blast radius.

---

## 8. Calibration: what scale of refactor is appropriate to recommend

The maintainer is one engineer plus this agent ecosystem. Recommendations should fit that scale.

- **Acceptable**: a refactor that takes the maintainer 1–3 days, touches 5–20 files, has clear before/after.
- **Borderline**: a refactor that requires a 1–2 week dedicated push, touches 50+ files, requires test rewrites.
- **Out of scope**: a refactor that requires a multi-month rewrite. Even if the architectural case is correct, the cost makes it unactionable. If the Arch Agent surfaces such a finding, flag it as `opinionated` with a note saying "deferred indefinitely due to cost".

---

## 9. Quick map of P2 files (where to find module maps)

```bash
# Run this to refresh; do not trust the list below if it's months old.
find . -maxdepth 4 -name "CLAUDE.md" -not -path '*/node_modules/*' | sort
```

As of handbook authoring (2026-05-26), there were ~30 P2 files across `core/`, `packages/`, `modes/`, `extensions/`, and subdirectories. The DIP verifier reports the count: `npx tsx scripts/verify-dip.ts`.
