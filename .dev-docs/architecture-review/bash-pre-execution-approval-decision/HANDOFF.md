# Handoff: bash pre-execution approval gate

```yaml
handoff_id: bash-pre-execution-approval-handoff
status: not-started   # this session never started actual code work; goal exceeded budget and was interrupted
created_at: 2026-07-05
session_ended_at: 2026-07-05
goal_token_budget: 50K
goal_token_used: 177K   # way over; session budget_limited
```

## TL;DR — read this first when picking up in the next session

**Background**: the user originally reported that interactive commands like `npx create-x` and `npm init` "look forever stuck in the TUI, no idea what they're doing inside". This session did three things:

1. **Layer 1** (landed on main, commit `1f1b2b5`): in `core/tools/bash.ts`, changed `stdio[0]` from `'ignore'` to `'pipe'` and added a 30s stdin grace timer. **This fixed "hangs forever", but did NOT fix "can't see the prompt" or "can't answer y/N".**
2. **Post-mortem + ADR reopen** (landed on main): `.dev-docs/architecture-review/bash-stdin-pipe-decision/ADR.md` status changed to `implemented-but-reopened`, with reopen reason and reference to hermes-agent.
3. **This ADR (Layer 2 + 3)**: not started in this session — an empty directory was created, the goal was set, 5 tasks were created, but **not a single line of code was written**.

**What the next session picks up**: create a new ADR `bash-pre-execution-approval-decision` + implement DANGEROUS_PATTERNS + TUI selector (hermes-agent style).

---

## Knowledge preservation (must not be lost when handing off)

### 1. Diagnostic lock

**Pre-fix stdio config at `core/tools/bash.ts:130`**: `["ignore", "pipe", "pipe"]`

- **Before fix**: `read -p` immediately gets EOF + errors
- **After Layer 1 fix**: `read -p` waits 30s, then `stdin.end()` + exit=1 (**verified 30087ms via `test-real-bash-debug.mjs`**)
- **What the user actually sees**: the model infers "immediate EOF" from the output, but actually waits 30s silently — bad UX
- **What we need to do next**: **don't make the user wait 30s** — intercept before spawn (hermes path)

### 2. hermes-agent key references

Reference template at `D:/Projects/Pencil/Template-github/hermes-agent`:

| File | Lines | What | What nanoPencil should adopt |
|------|-------|------|-------------------------------|
| `hermes_cli/callbacks.py:186-241` | `approval_callback(cli, command, description) -> str` | TUI selector + 60s timeout → default deny | [x] 5 options + view |
| `tools/approval.py:498+` | `DANGEROUS_PATTERNS` list (~60 regexes) | dangerous-command categorization (rm -rf / sudo / dd / SQL DROP / curl\|sh / etc.) | [x] adopt a subset (npx / npm install -g / ssh / Git-Bash specific) |
| `hermes_cli/cli_commands_mixin.py:1629` | `set_approval_callback(self._approval_callback)` | register callback with the agent | [x] add `setApprovalDecision` via ExtensionContext |
| Failure handling `callbacks.py:239-241` | no callback → `return "deny"` | default deny (fail-closed) | [x] strict |

**Key design principles (hermes)**:

- **Not a stdin-time bridge** — it's a **pre-execution gate**.
- **Fail-closed** (default deny).
- **Session persistence** (`"always"` option writes to config).
- **Serialization** (`_approval_lock` prevents concurrent sub-agents from popping selectors at the same time).
- **Long-command `view` option** (>70 chars gets a `view`).

### 3. nanoPencil surfaces already available (avoid creating new APIs)

Per ADR `../bash-stdin-pipe-decision/ADR.md`:

| API | Where | What it can do |
|-----|-------|-----------------|
| `ExtensionUIContext.confirm(title, message, opts)` | `core/extensions-host/types.ts:131` | Already supports a "y/N" two-option popup |
| `ExtensionUIContext.select(title, options, opts)` | `core/extensions-host/types.ts:128` | Multi-option popup, **this is the TUI selector prototype** |
| `ExtensionUIContext.notify(message, type)` | `core/extensions-host/types.ts:139` | Display info (could host "command blocked" notice) |
| `ctx.api.on('tool_execution_start', handler)` | runner hooks | Hook before tool execution — **this is the interception point** |

**Key insight**: `tool_execution_start` is a pre-execution event, but **the tool has already been spawned by then** — we need to intercept at an earlier layer. nanoPencil's current bash tool has no "execute approval" event, so we must **create a new `tool_execution_approval` event** or intercept inside `bash.ts`.

### 4. nanoPencil's missing dangerous-pattern baseline

Extract from hermes' DANGEROUS_PATTERNS the subset nanoPencil needs:

```
1. Delete class: rm -r / rm -rf / rm -f / cmd del / PowerShell Remove-Item
2. Permission class: chmod 777 / chmod -R 777 / chown -R root
3. Disk class: dd if= / mkfs / > /dev/sd
4. System class: systemctl stop/restart / kill -9 -1 / pkill -9 / killall -KILL
5. SQL class: SQL DROP / SQL DELETE FROM without WHERE / SQL TRUNCATE
6. Network class: curl | bash / wget | sh / eval $(curl ...) / shell -c
7. shell injection: python -e / perl -e / ruby -e / node -e
8. fork bomb: :(){ :|:& };:
9. Hardened npm/npx (user's pain point): npm install -g / npx create-* / npm uninstall -g
10. git dangerous push: git push -f origin main / git push --force-with-lease
```

**Note**: hermes has ~60 patterns; nanoPencil can pick ~20-30 — **drop SSH/SQL/PowerShell-specific** (Git Bash is the dominant user environment); **keep the generic items**.

### 5. Code locations scouted in the previous session

| File | Lines | Content |
|------|-------|---------|
| `modes/interactive/interactive-mode.ts:2140` | `createExtensionUIContext().setWorkingMessage` | ExtensionUIContext injection point |
| `modes/interactive/controllers/stream-render-controller.ts:336` | `case "tool_execution_start"` | tool_start event handling |
| `core/tools/bash.ts:130` | `stdio: ["ignore", "pipe", "pipe"]` | **already fixed to `["pipe", "pipe", "pipe"]` + 30s timer** |
| `core/tools/bash.ts:262` | `createBashTool(cwd, options?)` | bash-tool factory |
| `core/extensions-host/types.ts:115-141` | full ExtensionUIContext interface | [x] has `confirm` and `select` |
| `core/extensions-host/runner.ts:189` | `setWorkingMessage` stub (run mode) | Hook for mcp/persistence to use |
| `tests/presence-opening.test.ts:129-246` | mock `setWorkingMessage` usage example | Reference mock pattern for new callbacks |

### 6. Implementation order (5 tasks already created)

```
#19 Create ADR bash-pre-execution-approval-decision
  → produces .dev-docs/architecture-review/bash-pre-execution-approval-decision/ADR.md
#20 Add dangerous-pattern recognition in bash tool
  → edits core/tools/bash.ts: add DANGEROUS_PATTERNS + detection
#21 TUI selector component
  → edits modes/interactive/components/: new approval-selector.ts
  + edits core/extensions-host/types.ts: add setApprovalDecision interface
#22 Wire bash tool spawn pre-hook
  → in bash.ts: check dangerous pattern → pop selector → once/always continue; deny → cancel
#23 Write ADR + regression + 5 gates
  → scripts/_scratch/bash-approval-regression.mjs
  → npm run verify:all
```

### 7. Acceptance gates + complexity budget

| Metric | Limit |
|--------|-------|
| Lines per file | < 800 |
| New files | < 8 |
| ADR files | 1 |
| P2 AGENT.md updates | 2 (`core/tools/`, `modes/interactive/components/`) |
| P3 headers | every new `.ts` |
| 5 gates | `verify:dip` / `verify:quality` / `verify:package-boundary` / `build` / `tsc --noEmit` |
| Real regression | (1) dangerous command pops selector (2) non-dangerous fast-path doesn't pop (3) once → execute immediately (4) deny → don't execute (5) always → write config but not implemented in this session (6) 60s timeout → default deny |

---

## Pickup checklist for the next session

First thing in the next session (**don't redo**):

```bash
# 1. Check whether the previous commit is still on main
cd D:/Projects/Pencil/nanoPencil
git log --oneline -3
# expect to see 1f1b2b5 fix(bash-tool): keep stdin pipe with 30s grace timer

# 2. Check the ADR reopened status
head -15 .dev-docs/architecture-review/bash-stdin-pipe-decision/ADR.md
# expect status: implemented-but-reopened

# 3. Check the empty ADR directory
ls .dev-docs/architecture-review/bash-pre-execution-approval-decision/
# expect to see HANDOFF.md (this file)

# 4. Check the task list (if dispatcher uses the same agent)
# 5 tasks, status pending, because this session never started
```

**Then open a new worktree** (per `using-git-worktrees` skill):

```bash
git worktree add -b feature/bash-approval-gate .worktrees/bash-approval-gate HEAD
cd .worktrees/bash-approval-gate
```

Walk through #19 → #20 → #21 → #22 → #23 in order.

---

## Don't-repeat-the-mistake notes

Don't make these mistakes again:

1. **Don't treat the stdin timer as "done"** — it's a safety net, not a fix.
2. **Don't use grep to find feature matches** — you may misread "string appears" as "feature exists".
3. **Don't claim "done" right after writing code** — per feature-workflow §5, run the five gates plus a real regression.
4. **Don't be over-optimistic** — code change correct ≠ user problem solved (the 30s timer is correctly written, but "you can't see it" ≠ "you fixed it").

---

## Resource index (open these directly when picking up)

- ADR reopened: `.dev-docs/architecture-review/bash-stdin-pipe-decision/ADR.md`
- This handoff: `.dev-docs/architecture-review/bash-pre-execution-approval-decision/HANDOFF.md`
- Layer 1 fix: `core/tools/bash.ts:130-180` (stdio + stdinTimer)
- Layer 1 reproduction script: `scripts/_scratch/interactive-bash-repro/compare.mjs`
- Layer 1 real regression: `scripts/_scratch/test-real-bash-debug.mjs`
- Layer 1 sandbox created: `scripts/_scratch/bash-stdin-regression.mjs`
- hermes-agent reference: `D:/Projects/Pencil/Template-github/hermes-agent/`
  - `hermes_cli/callbacks.py:186-241` (approval_callback)
  - `tools/approval.py:498+` (DANGEROUS_PATTERNS)
  - `hermes_cli/cli_commands_mixin.py:1591-1736` (set_approval_callback registration)

---

*This handoff was recorded by the previous session (which exceeded its goal budget) so the next session has a complete pickup starting point. Any new session need only read this file to restore full context.*
