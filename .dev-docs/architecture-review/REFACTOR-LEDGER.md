# Refactor Ledger

> Living document. One-stop view of **what this refactor designed / solved / found / still has open**.
> Update the relevant table on each completion or finding. Detailed WHY: see the finding cards and §Resolution in each dedicated-review directory.

```yaml
doc: REFACTOR-LEDGER
branch: main                             # cutover 2026-06-09: main = refactored content; old main preserved as v1.0
baseline_main: 0eea985 (frozen → v1.0)
signoff: signed 2026-06-09 (scope = behavior-preserving structural refactor P0–P6; P7-code / P8 explicitly deferred)
refactor_complete: complete              # P0–P8 all complete (P7 size line closed; P8 SDK narrowing implemented)
updated_at: 2026-10-02
```

---

## 1. Scope and Phase Status

~~Execution branch `refactor/arch-candidate-d`, never merged to main~~ → **merged to main (cutover 2026-06-09)**:
`origin/main` reset to refactor tip (cb8c78d, force-push); old main (0eea985) preserved as `origin/v1.0`.
Subsequent development is on main.

> **Refactor completeness (honest framing)**: **Structural refactor (P0–P6) + behavior preservation is done and merged to main** (public API 296=296).
> **Current status**: P7 size work is closed and P8 SDK narrowing is implemented; see O8b/O9. Earlier deferrals describe the June 9 sign-off scope.
> Current builds use tsc plus per-file esbuild minification. Browser separation is an optional reopening, not incomplete P7 work.

| Phase | Content | Status | Dedicated review |
|-------|---------|--------|-------------------|
| P0 baseline | baseline numbers + characterization | [x] done (sign-off Sets A/D verified; symbols 296=296) | — |
| P1 skeleton move | D pure move + R blob + workspace wiring + DIP | [x] done (gate group A passed sign-off runbook) | — |
| P2 cycles + gates | F03/F04 cycle fixes, F08 gates, telemetry | [x] done (verify-quality 0 cycles) | — |
| P3 extension SDK | extension-sdk (N) + 4-tier loader + S3 dependency inversion | [x] done | — |
| P4 runtime split | `agent-session.ts` split into 7 submodules + S2 | [x] done | runtime-session-review (AS01–AS12) |
| P5 UI split | `interactive-mode.ts` split into controllers / state / mount | [x] structure complete (scope C) | interactive-ui-review (F02 + UI01–UI08) |
| P6 entry volume | lazy entry / browser opt-in / AI lazy provider | [x] done (EV02/03-reg/04/05 landed; DoD tested; cold start −49% vs main) | entry-volume-review (EV01–EV05) |
| P7 startup + build line | MCP async non-blocking startup / build:deps parallel + incremental | [x] **executed (2026-06-10)**: critical-path MCP init moved out (default config ~56s→1.9s); no-op build:deps 109s→41.7s (−62%) | startup-async-review |
| P7 size | browser assets / metadata / esbuild | Closed: minification and declaration stripping shipped; other options evaluated by measured value | O8b / bundle-redesign-review/closure.md |
| P8 SDK narrowing | root barrel → stable SDK surface | [x] **done (2026-06-13)**: root narrowed to ~20 symbols (Bucket A); protocol package complete (Bucket B); subpath exports generated (Bucket C); non-SDK symbols removed from root (Bucket D) | sdk-surface-review (SK01–SK03) |
| Sign-off | S-1..S-6 + sign | [x] **signed** (2026-06-09, scope = behavior-preserving structural refactor; P7/P8 explicitly deferred) | execution-plan/sign-off-main.md |

---

## 1b. Outcome Conclusion (current framing)

The realized value of this refactor is not "rename directories", but breaking the highest-maintenance-cost coupling centers into a structure with owners, ports, and enforceable gate rules. External framing:

> **P0–P6 behavior-preserving structural refactor complete**: directory layering, runtime/UI god-file splits, extension-package boundary, entry lazy-loading, DIP/quality gates are all landed; public API preserved 296=296; cold start measurably lower vs old main.
> P7/P8 implementation status is recorded in O8b/O9; both are closed. The original sign-off excluded them at that time.

| Achieved | Evidence | Meaning |
|----------|----------|---------|
| Runtime decomposition | Existing controllers plus queue, event, trace, query and resource owners | See runtime-skills-cleanup-review; AgentSession keeps composition and the compatible public facade. |
| 0 cycles | `verify-quality` SCC = 0 | Dependency direction goes from "works" to a structural constraint we can gate |
| public API unchanged | public symbols 296=296 | P0–P6 is a behavior-preserving structural refactor; doesn't force external consumers to migrate |
| Cold-start decrease | §6 cold-start: HEAD vs main measurably lower | P6 lazy import / provider lazy gives user-visible benefit |
| DIP isomorphism enforced | P2/P3 + `verify-dip` | New files / new modules are no longer described only by verbal convention |
| Packaging bugs exposed and fixed | D1 / D2 / D5 | Refactor surfaces hidden release issues, improves release verifiability |
| **root SDK surface narrowed** | index.ts narrowed to ~20 symbols; protocol package complete; subpath exports generated | External consumers depend only on the stable SDK surface; internals can evolve freely |

| Retained trade-off | Reason | Evidence |
|--------------------|-------|----------|
| Browser assets remain bundled | Install/enable UX and graceful fallback outweighed the measured saving | O8b / BR02 |
| tsc plus minification, without metadata chunking | Per-file esbuild shipped; metadata chunking had negligible measured benefit | O8b / BR03–BR04 |

**Consistency conclusion**: the current directory structure matches the P0–P8 target state in `target-architecture.md`; P7 size line is closed, P8 SDK narrowing is implemented. So the accurate boundary of this sign-off is: **structural layering, behavior preservation, and SDK narrowing all done; build-size line closed.**

---

## 1c. Review-Cognition Update: from one-off architecture review to daily-feature workflow

`.dev-docs/architecture-review/` started as a one-off Arch Agent handbook (Explore → Report → Grilling → refactor plan). After the refactor wraps up it can't just sit as a historical review directory — the review mindset (how to design top-down, how to review feature quality) has **graduated into the daily development flow**:

➡️ **Canonical workflow: [`.dev-docs/feature-workflow.md`](../feature-workflow.md)** (four-step loop + dedicated-review triggers + 5 acceptance gates + templates), linked from root P1 [`AGENTS.md`](../../AGENTS.md).

**Cognition update (one sentence)**: architecture review is **not** "write more docs before writing code"; it's folding every feature into the same set of judgments — **does the requirement have a clear owner / does the change respect existing layers / does the new abstraction's payoff exceed its cost / can acceptance be reproduced automatically or manually**.

---

## 2. What we designed / what we solved

### P4 runtime split (agent-session god)
- **Problem**: `agent-session.ts` was a runtime god, mixing session lifecycle / model / tool / reload / events.
- **Design**: split out `model-controller`, `tool-runtime-controller`, `session-tree-controller`, etc.; `AgentSession` degraded to a facade (public surface stable, RS-4). capability-context pattern (narrow capability closure, RS-2).
- **Solution**: dangerous coupling pushed down to a single owner (RS-3); unit-testable; 12 finding cards all reached final state.

### P5 interactive split (interactive-mode god, 7960 → …)
- **Problem**: `interactive-mode.ts` was the repo's largest non-generated file, mixing render / submit / overlay / interrupt / model / auth / tree / settings / slash dispatch + ~80 state fields.
- **Design**: 12 controllers (image-pipeline / self-update / extension-ui × 4 hosts / state consolidation / model-overlay / auth-provider-config / tree-overlay / settings-overlay / slash-dispatcher / input-submit / interrupt / stream-render), all capability-context, no reverse imports, single owner.
- **Solution**: **dangerous coupling all leaves mount** (render loop / submit pipeline / overlay-escape seam / each dispatch); token-neutrality verified slice by slice; unit-testable.
- **Key judgment**: the mount `<500` line goal **was unattainable and a misleading target** (mount = composition root + port surface for ~12 controllers; floor ~1500–1700) → target corrected; the god has been split, S-3 "no redundancy" already satisfied.

### P6 entry volume
- **EV02 mode lazy dispatch**: `main.ts` no longer eagerly imports the modes barrel; rpc / interactive / print are imported on demand via `await import` (ACP was already doing this). **Cold start** improves (non-dist).
- **EV03 browser opt-in (registration slice)**: browser exits default loading (`category: optional`, removed from `getBuiltinExtensionPaths()`); added lightweight `/browser` fallback hint for opt-in.
- **EV04 provider runtime lazy**: import provider runtime on first use of `model.api`; `stream()` stays synchronously returning, events forwarded one by one (token-neutral); load failure converts to `stopReason:error`.
- **EV05 AI subpath exports + internal migration**: added additive `@pencil-agent/ai/*` subpaths (root not narrowed, EV-G4); internal common code migrated to explicit subpaths (type-only, behavior-neutral).

---

## 3. Problems found (surfaced during refactor)

| # | Problem | Severity | Status | Record |
|---|---------|----------|--------|--------|
| D1 | **builtin↔defaults naming split**: after P1 skeleton move, `copy-assets.js` / multiple tests / `idle-think` / `types.ts` referenced non-existent `extensions/defaults/`; the actual directory was `extensions/builtin/` | high | [x] fixed (`06f54fb`) | see §5 D1 |
| D2 | **browser assets never made it into dist**: because of D1, `copy-assets` was copying a dead path `defaults/` (no-op); browser's 1.6M `agent-workspace` **was never packaged** → the published package was missing browser-harness assets (latent packaging bug) | high | [x] fixed along with D1 (dist +1.6M is "finally correct", not a regression) | see §6 |
| D3 | **custom-overlay-host missed commit**: new file in P5 slice not `git add`'d → maintainer checkout failed to compile | medium | [x] fixed | — |
| D4 | **mount `<500` unattainable**: after god split, mount is still composition root + port surface, floor ~1500–1700 | medium | [x] target corrected (scope C) | mount-shell-evaluation.md |
| D5 | **beta install 404**: new first-party workspace packages added by refactor (`@pencil-agent/extension-sdk` + `@pencil-agent/soul-core`) were listed in host `dependencies` but **never published to npm**; `npm i` would look for them on the registry → 404 (mem-core@1.1.0 is already published so not an issue there). main(1.14.6) didn't include these deps, so this was a refactor regression | high | [x] fixed (beta.2 `c15bc57`): **publish these two packages** (no first-party transitive deps, has build/files, clean standalone packages — same shape as already-published mem-core), restore all three as host `dependencies` (without changing import paths). soul runtime is optional (null-degrade if not found); 404 is install-time only. ⚠ maintenance cost: first-party package changes need coordinated version bump + re-publish | — |
| D6 | **stale workspace symlink (clone not synced, O10① materialized)**: a clone installed before cutover still had `node_modules/@pencil-agent/{ai,agent-core}` pointing to old paths `packages/ai` (no longer exists) → subpath resolution like `@pencil-agent/ai/types` failed → `build:deps` flooded with TS2307. It's an environment / clone mismatch, not a code bug | medium | [x] fixed: `npm install` relinks to `core/lib/*`. **Lesson**: after a cutover / large move, every clone must `npm install` to relink (not just `git pull`) | — |

---

## 4. Unresolved / todo (priority order)

> [x] Completed: O1 gate group A (sign-off Sets A/C/D passed) · O2 P6 DoD (cold start −49% / dist accepted) · O6 sign-off (2026-06-09 signed) · cutover (main=refactor, v1.0=old).
> This table includes completed work and remaining follow-ups. O8b/O9 are closed, not open backlog.

| # | Todo | Type | Nature |
|---|------|------|--------|
| **O8a** | [x] **P7 startup + build line executed (2026-06-10)**: MCP async non-blocking (default-config startup ~56s→1.9s); `build:deps` parallel + incremental (no-op 109s→41.7s). See `startup-async-review.md` | code (done) | startup-async-review |
| **O8b** | [x] **P7 size line closed (2026-06-11)**: BR04 esbuild per-file minify (**tarball −346K/−20%**, no bundle / keep-names) + BR05 inline `.d.ts` stripping (−55K) landed (this round ~−400K gzip); BR03 metrics → ≈0 benefit, not done; BR02 browser domain-skills (359K / ~1% of install footprint) **kept bundled after measurement** (online feature UX first; users don't perceive a second download; missing → graceful fallback). **No more P7 size work open** | code (closed) | bundle-redesign-review/closure.md (P7 size line CLOSED) |
| **O9** | [x] **P8 SDK narrowing done (2026-06-13)**: root barrel narrowed to ~20 symbols (Bucket A); protocol package complete (Bucket B); subpath exports generated (./tools, ./runtime, ./session, ./config, ./models, ./skills) (Bucket C); non-SDK symbols removed from root (Bucket D). TypeScript compiles clean | code (done) | sdk-surface-review |
| O3 | **EV03 browser as a separate package** (Q2①, cuts 1.6M install size): UX-first, requires install/enable UX first (sibling of O8 in P7 size line) | code (optional) | BR02 reopen condition |
| O5 | Post-P5 cleanup inside the interactive domain: resources-display (481) / slash-handlers (981) flat handlers | code (optional backlog) | — |
| O10 | **Wrap-up misc**: ① every clone `reset --hard origin/main` to sync; ② decide whether to keep `refactor/arch-candidate-d` branch; ③ `migration-classification.md` draft → active (GA-6 finalized); ④ npm 2.0 stable waits for beta testing before publishing | misc | — |

---

## 5. Key Findings Detail

### D1 / D2 builtin↔defaults split + browser assets missing (fixed)
- **Root cause**: `332551f refactor(p1b)` skeleton-move changed references to `extensions/defaults/`, but the directory was still called `extensions/builtin/`, so `defaults/` did not exist.
- **Consequence chain**: `scripts/copy-assets.js` tried to copy `extensions/defaults` (not present) → silently copied nothing for builtin assets → browser's 1.6M `agent-workspace`, and every builtin extension's non-`.ts` assets, **never made it into dist**; meanwhile 6+ tests that did `readdirSync(defaults)` would ENOENT (would only be caught by heavy gate validation, which didn't run).
- **Fix**: `06f54fb fix(p1): align builtin extension paths` aligned `copy-assets` + `types.ts` + `idle-think` + 6 tests to all use `builtin/`.
- **Lesson**: skeleton-move-style changes **must** come with heavy validation (build + asset diff), otherwise packaging-layer bugs sit latent until sign-off.

---

## 6. Metrics (continuously updated)

| Metric | main baseline (0eea985) | P5 wrap (1b2da59) | HEAD (P6) | Notes |
|--------|-------------------------|-------------------|----------|-------|
| public symbols | 296 | — | **296** | [x] public API unchanged (EV-G4 / S-1 win) |
| dist `du -sh` | — | 5.2M | **6.8M** | +1.6M = D2 fix finally correctly packaged browser `agent-workspace` (**not a regression**) |
| dist `--build` (collect-baseline) | 3.61 MB | — | 4.89 MB | Same framing; growth = D2 (+1.6M assets) + P5 structural new files (.js / .d.ts) |
| cold-start `--list-models` | **mean 4.136s / min 2.757s** (re-measured 2026-06-05) | mean 2.772s / min 2.149s | **mean 1.028s / min 0.508s** | [x] **V6-1 pass + S-4 hard data**: vs P5 mean −63% / min −76%; **vs main mean −75% / min −82%** (hyperfine -w3 -r10). EV02+EV04 are clear; splitting files' boot cost is more than offset by lazy. `min` is the most trustworthy number (P6 σ is large due to system outliers) |
| provider smoke (EV04) | — | — | **openai-completions (MiMo) [x] real streaming `ok`** | EV04 lazy end-to-end usable; anthropic / google / bedrock etc. not individually smoked (marked pending in beta notes) |
| cycles (verify-quality SCC) | — | 0 | 0 | [x] no cycles |
| **MCP startup blocking (critical path)** | — | — | **default config ~56s → 1.9s; 2 mocks ~3.3s → 0.6s** | [x] P7 startup: MCP init moved off the critical path (`createAgentSession` returns immediately, `deferMcpInit`). Default 3×npx server warm ~20s/cold 24-34s all moved to background warmup. print / acp / rpc stay synchronous (one-shot turn needs tools) |
| **build:deps no-op rebuild** | — | — | **109s → 41.7s (−62%)** | [x] P7 build: parallel (agent-core depends on ai in series) + tsc incremental. Edits only rebuild affected packages |
| **public symbols (post-startup-change recheck)** | 296 | — | **296** | [x] top-level exports unchanged; new `warmupMcpTools()` / `deferMcpInit` / `sdk:mcp_ready` are all member-level additive (GB-2 declared, non-breaking) |
| **release tarball (BR05 .d.ts stripping)** | — | — | **1,805,318 → 1,750,161 B (−55K / −3.05%); files 1075→988; unpacked 7.5 → 6.9M** | [x] P7 size: strip inline runtime library dev-only `.d.ts` (runtime uses `.js` only). Same baseline `npm pack` before/after; BR01:dist green, runtime embedded ai registry resolves normally |
| **release tarball (BR04 minify)** | — | — | **1,733,504 → 1,387,300 B (−346K / −20%); raw .js 4645→2251K (−52%); unpacked 7.1 → 4.6M** | [x] P7 size big win: esbuild per-file transform (keep-names, no bundle), runs at build's last step. Verified: package-boundary:dist green, 25 extensions 0 errors 35 tools, embedded libraries minified still resolve. Untested: real model turn (needs key) / real terminal render |

**Dist growth conclusion (accepted, reason recorded)**: HEAD dist > main baseline, for two reasons and **neither is a performance regression**:
1. **D2 fix**: browser's 1.6M assets went from "not packaged" to "correctly packaged" (as they should have been all along);
2. **P5 structure**: god split into ~12 controllers + new AI subpath barrel, adding `.js`/`.d.ts`.

P6 lazy changes (EV02/04/05) are **basically neutral** on dist (lazy changes *when* code loads, not *whether* it loads). To actually shrink dist further needs O3's contraction slice (EV04 metadata chunking / EV03 browser as separate package) — **a known trade-off, current size accepted per GB-2**.

---

## 7. Cold-start measurement method (V6-1, on the compute box)

Cold start = time from process launch to "selected mode ready"; EV02/EV04 defer imports for **unselected modes + unused providers**, which should show up here.

> ⚠ **Don't use `--version` / `--help`**: `cli.ts` fast-paths these two — they exit **before** `await import("./main.js")` (per the comment in <200ms vs 9-15s full boot) — they **don't load main.js at all**, so they don't measure EV02/EV04.
>
> Correct metric = **`--list-models`**: loads all of main.js + builds the model registry then `process.exit(0)` (main.ts:870–873), **no LLM calls / no TUI / no network**. EV02 removes the **top-level** `import {…} from modes/index` from main.ts; any command that loads main.js is affected → `--list-models` cleanly measures it.

```bash
brew install hyperfine    # optional; without it, use the bash builtin `time` below

# A/B comparison (isolates EV02/EV04 cold-start gain — this is the V6-1 criterion):
git checkout 1b2da59 && npm run build
hyperfine -w3 -r10 'node dist/cli.js --list-models'      # P5 wrap point (pre-EV02: top-level eagerly pulls interactive)
git checkout refactor/arch-candidate-d && npm run build
hyperfine -w3 -r10 'node dist/cli.js --list-models'      # HEAD (interactive no longer loaded) → should be ≤ the former

# Without hyperfine — bash builtin `time`, read the `real` line, 5 runs taking the minimum:
for i in 1 2 3 4 5; do time node dist/cli.js --list-models >/dev/null; done
```

**Interpretation**:
- HEAD `--list-models` ≤ P5 wrap → EV02/EV04 cold-start gain holds → **V6-1 passes, P6 core DoD achieved**.
- Want per-mode EV02 detail: compare `--list-models` (doesn't enter mode dispatch) with actually entering interactive (interactive still has to load TUI).
- Numbers go back into the §6 metrics table + execution-plan/P6-entry-volume.md V6-1.

---

## 8b. Gate-group A acceptance checklist (O1 expanded · sign-off macro-stage-one hard gate)

> Path A chosen (2026-06-05): skip P7/P8, close out + push sign-off prerequisites first. Gate group A = P0/P1 directory-level exit.
> [x] = confirmed · 🖥 = needs the maintainer's compute box · 📝 = needs the maintainer to write it down.

| Gate | Content | Status | How to verify |
|------|---------|--------|---------------|
| GA-1 Structural isomorphism | Directory tree == §4 target tree | 🟡 strong indicator [x] | `core/lib` / `core/platform` / `core/extensions-host` / `core/runtime` in place, `bundle-deps.js` removed ([x] confirmed); full tree-diff vs §4 target tree = manual check |
| GA-2 Behavior preservation (hard) | public API symbols | 🟡 strong indicator [x] | symbol count 296=296 ([x] confirmed, unchanged); **full diff needs 🖥**: `npm run wiki:all` regenerate → `symbols.md` vs `baseline/public-api-symbols-main.txt` diff should be paths-only |
| GA-3 Zero logic changes (hard) | moved file bodies have no logic diff | 🟡 | `git diff` spot-check P1 move commits (`332551f` etc.) to confirm only path/import lines, body unchanged (semi-manual, can sample) |
| GA-4 Compiles and runs | tsc + tests + 4-mode smoke | 🟡 partial | tsc [x] (your build already passed); **🖥 pending**: full `vitest` (note: after D1 fix the 6 ex-defaults tests should no longer ENOENT) + CLI 4-mode smoke (see beta-smoke-checklist §2) |
| GA-5 DIP isomorphism | CLAUDE.md member + P3 + verify-dip | [x] | `verify-dip.ts` exit 0 ([x] confirmed, 550 files) |
| GA-6 R / U digested | R blob placement + split tickets; U landing points | 🟡 📝 | R units (agent-session / interactive-mode etc.) moved whole [x] and split tickets = completed P4/P5 reviews; **📝 pending**: `migration-classification.md` still `draft`; R row 4's disposition still needs to be written down (verbal = moved whole) + U row filled in → flip to `active` |
| Incremental gate | verify-quality only gates incremental | [x] | `verify-quality.ts` green ([x] confirmed) |

**Maintainer compute-box commands (GA-2 + GA-4)**:
```bash
# GA-4 tests + tsc
npm run build && npx tsc --noEmit
npx vitest run                                  # full; watch the 6 ex-defaults tests after the D1 fix
# GA-4 four-mode smoke → see beta-smoke-checklist.md §1 / §2
# GA-2 symbol diff
npm run wiki:all
diff <(grep -oE '^[^ ]+' .baseline-out/public-api-symbols.txt | sort) \
     <(sort .dev-docs/architecture-review/baseline/public-api-symbols-main.txt)   # should be paths-only
```

**After gate group A closes** → gate group B for each domain in P2/P3..P6 (mostly already [x]) → sign-off S-1..S-6 + sign.

---

## 8. Maintenance conventions

- For each O* completed: flip the status to green, add the commit hash, move into §2 if needed.
- For each new finding found: enter §3, detail into §5.
- For each metric run: update §6.
- This file is the "known issues / accepted trade-offs" index for S-1..S-6 at sign-off time.
