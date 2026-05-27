# Inputs

What the Arch Agent reads before forming opinions. **Read in this order.** Skipping ahead produces findings that miss context.

---

## 1. Handbook (this directory) — read order

1. `README.md`
2. `methodology.md`
3. `machine-constraints.md`
4. `handoff.md`
5. `inputs.md` (you are here)
6. `project-context.md`
7. `workflow.md`
8. `output-format.md`

---

## 2. Project doctrine (read before walking code)

| File | Why |
|------|-----|
| Root `CLAUDE.md` | P1 — global topology, stack, directory structure, code standards. Read in full. |
| `AGENTS.md` | Claude Code specific guidance. Skim for relevant tool/skill conventions. |
| `.PENCIL.md` | Product personality charter. Read to understand product intent (informs which directions are out of scope). |
| `README.md` (root) | User-facing description. Read to know what users think nanoPencil is. |

---

## 3. Module maps (P2 layer)

Every `CLAUDE.md` or `AGENT.md` under a subdirectory:

```bash
find . -name "CLAUDE.md" -o -name "AGENT.md" 2>/dev/null | grep -v node_modules | sort
```

Read each. They are the maintainer's own assertions about module structure. When the actual code conflicts with the P2, **the conflict is itself a finding**.

---

## 4. The other side's docs (read for separation, not consumption)

To enforce the boundary in `handoff.md`, the Arch Agent reads these **to know they exist** but does not synthesize them into findings:

- `.dev-docs/diagnosis/sop.md` — self-diagnosis territory; skim only.
- `.dev-docs/diagnosis/audit-2026-05-17.md` — data audit; skim only.
- `.dev-docs/self-awareness/charter.md` — pencil self-awareness vision; skim only.
- `.dev-docs/self-awareness/archetypes.md` — reflexive task design; skim only.
- `.dev-docs/sal/*` — SAL experiment line; skim only.
- `.dev-docs/data/*` — table-purpose matrices and cleanup plans; skim only.
- `.dev-docs/diagnosis/runs/**` — daily reports and tickets; **do not read individual tickets**, just confirm the directory exists and serves a parallel program.

If something in these files looks like an architectural problem, log it in the report's "Adjacent observations" section — don't make it a primary finding. The maintainer will route it to the self-diagnosis agent or to themselves.

---

## 5. Code (the terrain)

Read in the order suggested by the P1 directory structure section. Don't randomize.

Recommended walking path:
1. `cli.ts` → `main.ts` → `config.ts` (entry points)
2. `core/runtime/` (session lifecycle)
3. `core/extensions/` (extension loading, lifecycle hooks)
4. `core/tools/` (built-in tools)
5. `core/{session,model,prompt,mcp,export-html,utils}/` (other core)
6. `packages/agent-core/` (Agent class)
7. `packages/ai/` (provider abstractions)
8. `packages/mem-core/` (memory engine)
9. `packages/soul-core/` (personality engine)
10. `packages/tui/` (terminal UI)
11. `modes/` (interactive / print / rpc / acp)
12. `extensions/defaults/` (in alphabetical order)
13. `extensions/optional/`
14. `scripts/` (build & utility scripts)
15. `migrations.ts`, `nanopencil-defaults.ts`, `builtin-extensions.ts` (root-level orchestration)
16. `index.ts` (package barrel)

For each step:
- Count lines (`wc -l`). Note unusually large files.
- Read the P3 header. Note when it lies.
- For files > 500 lines: do a structural scan (function signatures, top-level types) without reading bodies.
- For files > 1000 lines: this is a candidate for "god module" finding — flag immediately, deep dive later.

---

## 6. Quantitative inputs (read-only commands you may run)

All safe under `machine-constraints.md`:

```bash
# Repo size & file count by directory
du -sh */ 2>/dev/null | sort -h

# Lines of code by language (if tokei installed)
tokei --exclude node_modules --exclude dist 2>/dev/null

# File counts per directory (top 3 levels)
find . -type f -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.git/*' | awk -F/ '{print $2"/"$3}' | sort | uniq -c | sort -rn | head -30

# Dependency footprint (production deps)
node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies||{}).length+' prod deps');"

# Detect circular imports if madge is installed
# (do NOT install it — just check if it's available)
command -v madge >/dev/null && madge --circular --extensions ts core/ packages/ extensions/ 2>&1 | head -50

# DIP integrity check (read-only)
npx tsx scripts/verify-dip.ts
```

If any of these commands need a tool not present (`tokei`, `madge`), do not install it. Note the absence in your report.

---

## 7. What you may NOT do during inputs phase

- Spawn the pencil binary (see `machine-constraints.md`).
- Run `npm run build` / `npm run dev` / `npm install` / `npm ci`.
- Edit files outside `.dev-docs/architecture-review/` (your scratch space).
- Read `.dev-docs/diagnosis/runs/<date>/` individual tickets (that's self-diagnosis territory).
- Read `extensions/defaults/sal/eval/insforge-sink.ts` deeply — you may grep for structure, but do not summarize SAL's experimental work; the SAL Agent owns its evolution.

If you find yourself reading a file and aren't sure if it's in scope, check `handoff.md` first.
