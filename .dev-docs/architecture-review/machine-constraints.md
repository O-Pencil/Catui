# Machine Constraints

Hard rules. The Arch Agent must obey these regardless of how convenient a violation would be. Violations risk crashing the host machine and breaking the maintainer's session.

---

## 1. The host machine

The Arch Agent runs on the same kind of machine as the self-diagnosis agent. Capacities observed during 2026-05-26 reality check:

| Resource | Observed | Reserved-for-OS | Working budget |
|----------|----------|-----------------|----------------|
| RAM total | 3.4 GiB | ~3 GiB | ~400 MiB |
| Free RAM | ~420 MiB | — | — |
| Disk (`/`) | 40 GiB total, ~4.2 GiB free | — | <4 GiB |
| CPU | 2 cores | — | — |

The numbers move. The principle doesn't: **this machine has a thin RAM margin and a thin disk margin**. Spawning a heavy process (build, dev server, pencil session) can OOM the host.

---

## 2. Forbidden commands

The Arch Agent **must not** run any of these:

| Command | Why forbidden |
|---------|---------------|
| `npm run dev` | starts pencil TUI; long-running, ~hundreds of MB RAM |
| `npm run build` | tsc + bundling across all packages; transient ~500 MB+ RAM spikes, writes 100s of MB to disk |
| `npm install` | mutates `node_modules/`; downloads; can take GB |
| `npm ci` | same as install |
| `npx tsx cli.ts --print` | spawns a pencil session — out of scope for arch review |
| `node dist/cli.js` | same |
| `npm start` | same |
| `pnpm install` / `yarn install` / any package manager install | same risks |
| Anything that compiles to disk (`tsc -p .`, `tsc --build`, etc.) | disk pressure |

If the Arch Agent finds itself wanting to run one of the above to "verify a hypothesis", **stop**. Write the hypothesis into the finding as "needs verification by maintainer" and move on.

---

## 3. Allowed commands

Read-only, bounded-memory commands the Arch Agent **may** use:

| Command | Purpose | Memory note |
|---------|---------|-------------|
| `find`, `ls`, `wc`, `du` | filesystem inspection | trivial |
| `grep`, `rg` (ripgrep) | text search | trivial |
| `cat`, `head`, `tail` | reading file fragments | trivial |
| `node -e "require('./package.json')..."` | one-shot JSON queries | tens of MB |
| `tokei` if installed | line counting | tens of MB |
| `madge --circular ...` if installed | cycle detection | hundreds of MB — use sparingly, see §5 |
| `npx tsx scripts/verify-dip.ts` | DIP verifier | trivial (this script is bounded by design) |
| `git log`, `git diff`, `git status`, `git show` | git inspection | trivial |
| `git log --stat -- <file>` | per-file history | trivial |

If you want to run something not on this list, treat it as forbidden by default; ask the maintainer.

---

## 4. RAM guardrails

Before any non-trivial step:

```bash
free -h | awk '/^Mem:/ {print $7}'
```

If available RAM is < **150 MiB**, **stop** the current operation. Wait for free RAM to recover (or abort the run with a clear status note).

The Arch Agent's typical RAM footprint per chunk of work:

- Reading files with `Read`: ~tens of MB (Claude side; not host process)
- Running `tokei`: tens of MB host RAM
- Running `madge`: hundreds of MB — gated behind §5

---

## 5. The madge exception

`madge` is the most useful dependency-cycle detection tool. It also has the worst memory profile of any allowed command — on a repo this size it can use 400 MB+ RAM during graph construction, which exceeds this host's typical headroom.

Rules for `madge`:

- Check it's installed first: `command -v madge`. If not installed, **do not install it**. Note the absence in your report.
- Run on **one subtree at a time**, not the whole repo:

  ```bash
  madge --circular --extensions ts core/
  madge --circular --extensions ts packages/
  madge --circular --extensions ts extensions/
  ```

- Capture output to a file (don't hold it in memory across long conversations).
- If `madge` errors with OOM, fall back to grepping import statements manually.

---

## 6. Disk guardrails

Available disk on `/`:

```bash
df -h / | awk 'NR==2 {print $4}'
```

If < **1 GiB available**, **stop**. The Arch Agent does not create large files (typically all writes total < 10 MiB) but the host's OS, other processes, and pencil's existing build artifacts compete for the same space.

Particularly: **do not** generate the HTML report at `$TMPDIR/architecture-review-*.html` if `/tmp` is full. Generate to `.dev-docs/architecture-review/` instead and note the relocation in the report.

---

## 7. Time budget per session

A single Arch Agent session should produce Phase 1 + Phase 2 in **one continuous run**. Estimate: 4–8 hours of agent time (token cost ~50–150K tokens depending on codebase size and finding count).

If the session hits hour 10 without finishing Phase 2, **stop and write a partial report**. Resuming a long arch review session from cold context is harder than producing a partial report and starting fresh next time.

Phase 3 is interactive with the maintainer and happens in a separate session.

---

## 8. Cleanup obligations

At the end of any run (Phase 2 complete or aborted mid-walk):

- Remove any temporary files the agent created outside `.dev-docs/architecture-review/`.
- Do **not** remove anything in `.dev-docs/architecture-review/`. Those are deliverables.
- Do **not** modify the host's `~/.pencils/` (user-side state).
- Do **not** modify `node_modules/`, `dist/`, `.git/`, or any package's compiled artifacts.

---

## 9. Failure modes and recovery

| Failure | Symptom | Recovery |
|---------|---------|----------|
| OOM during madge | process killed, no output | re-run on smaller subtree; fall back to grep |
| Disk full during HTML render | I/O error | relocate output to `.dev-docs/architecture-review/`; note in report |
| MCP unreachable (Arch Agent doesn't use MCP directly, but could read self-diagnosis MCP results) | not applicable; Arch Agent is read-only over filesystem | n/a |
| Token budget exhausted mid-Phase 2 | conversation truncation risk | write a "partial report" status header in `refactor-plan.md`; flush findings to disk in priority order |
| Maintainer's Claude session is shared with other work | context pollution | the Arch Agent runs in a **dedicated session** — see `handoff.md` |
