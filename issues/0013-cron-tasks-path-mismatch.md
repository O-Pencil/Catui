# Issue: cron-tasks.json storage path differs from TUI cwd, so scheduled tasks never fire

## ID
`issue:cron-tasks-path-mismatch`

## Status
`closed — fixed`

## Date
`2026-05-22`

## Closed
`2026-06-20`

---

> **Note**: this issue was fixed in a subsequent refactor. The current code uses `api.agentDir` / `ctx.agentDir` as the base path for cron-task storage instead of `api.cwd`. The cron file path has been changed to `.claude/scheduled_tasks.json` (relative to `agentDir`). This document is kept for historical reference.

## Problem

After a user creates a durable cron task via the TUI `/loop create` command, the task config file is written to `~/.catui/cron-tasks.json`, but the catui TUI's cron scheduler actually reads from `{api.cwd}/.catui/cron-tasks.json` — the two paths differ, so the scheduler reads the old file and the scheduled task never fires.

### Reproduction path

1. In TUI run `/loop create "0 9 * * *" <prompt>` to create a daily-9-am GitHub digest task
2. After creation, the file is written to `~/.catui/cron-tasks.json` (task ID `5cb66040`, containing the full Rem-toned digest prompt)
3. catui TUI launches from `/home/minghuazzz/Pencil` (`process.cwd()`), so `api.cwd = /home/minghuazzz/Pencil`
4. The cron scheduler (`createCronScheduler({ dir: api.cwd })`) reads `/home/minghuazzz/Pencil/.catui/cron-tasks.json` (the old file, task ID `5b725adf`, containing the old-version prompt)
5. At 9 am every day the scheduler checks the old file's task; the task exists but its send command is openclaw (already invalid), so the digest never goes out

### Impact

- All durable cron tasks created via TUI fail to fire in multi-project workspaces
- User-visible as "the task says it was created successfully but never executes", hard to diagnose (the two path-files have different content, not obviously related)

---

## Root-cause analysis

### Path divergence

```
~/.catui/cron-tasks.json      ← where tasks are actually written
/home/minghuazzz/Pencil/.catui/cron-tasks.json  ← where the scheduler reads
```

### Code-level reasons

1. **Task write used a fallback cwd**: in `cron-tasks.ts`, `addCronTask()` takes a `projectRoot` parameter. When the call path doesn't pass `projectRoot` explicitly, some tools (e.g. `CronCreateTool`) use `ctx.cwd` (= `api.cwd` = TUI process cwd), but historically there may have been a different code path that used `~` or `~/.catui` as the default.

2. **Scheduler reads use `api.cwd`**: `loop/index.ts` line 298:
   ```typescript
   createCronScheduler({ dir: api.cwd })
   ```
   `api.cwd` comes from `ExtensionContext.cwd`; in TUI mode it is the process launch directory (when TUI launches from `/home/minghuazzz/Pencil`, then `/home/minghuazzz/Pencil`).

3. **The two paths don't point to the same file**: when TUI cwd ≠ `~` (most cases), `~/.catui/` and `{cwd}/.catui/` are two separate directories, and the scheduler cannot see the task the user actually created.

### Key code locations

| File | Line | Notes |
|------|------|-------|
| `extensions/builtin/loop/cron-tools/cron-create-tool.ts` | 51 | `addCronTask(ctx.cwd, {...})` — passes `ctx.cwd` |
| `extensions/builtin/loop/cron/cron-scheduler.ts` | 298 | `createCronScheduler({ dir: api.cwd })` — uses `api.cwd` |
| `extensions/builtin/loop/cron/cron-tasks.ts` | 72 | `CRON_FILE_REL = ".catui/cron-tasks.json"` |
| `core/runtime/agent-session.ts` | 396 | `this._cwd = config.cwd` — from `CreateAgentSessionOptions` |
| `core/runtime/sdk.ts` | 283 | `const cwd = options.cwd ?? process.cwd()` |

---

## Recommended fix

### Option A (recommended) — unify storage at `agentDir`, aligned with issue-0012

> Problem: cron-task storage is fragmented (`~/.catui` vs `{cwd}/.catui`), in line with the Issue 0012 "unify Pencils data directory" direction.

**Change points:**

1. `cron-tasks.ts`: change `CRON_FILE_REL` to be relative to `agentDir` instead of `projectRoot`
   ```typescript
   // from
   const CRON_FILE_REL = ".catui/cron-tasks.json";
   // to (assuming agentDir is ~/.pencils/agents/<id>)
   const CRON_FILE_REL = ".catui/cron-tasks.json";
   // and pass agentDir instead of cwd in addCronTask / readCronTasks
   ```

2. `cron-create-tool.ts`: pass `ctx.agentDir` (needs to be added to `ExtensionContext`)
   ```typescript
   await addCronTask(ctx.agentDir, { ... })  // agentDir comes from agentDirContext.path
   ```

3. `loop/index.ts`: `createCronScheduler({ dir: agentDir })`

**Pros**:
- Aligns with the storage principles from issue 0012
- Each agent's cron tasks live in one place; cwd changes don't break them
- Solves the cross-project-workspace problem

**Cons**:
- Needs an `agentDir` field added to `ExtensionContext` (an API extension)

---

### Option B (simple fix) — validate and warn when creating tasks

> Problem: the user doesn't know which path the task was written to, and the scheduler doesn't check whether the file exists.

**Change points:**

1. After `addCronTask()` writes, validate readability — read once to confirm successful write
2. If the read fails (path missing or permission issue), throw an explicit error to the user
3. If the cron file doesn't exist when the scheduler starts, create an empty `{ tasks: [] }` and log it

**Pros**:
- Doesn't change storage layout, only adds validation and warnings
- Small change, low risk

**Cons**:
- Doesn't fix the root cause, just makes the problem easier to spot

---

### Option C (no change) — scheduler checks both paths

> Problem: smallest migration cost, but adds scheduler complexity.

**Change points:**

On scheduler startup, check both paths and merge task lists:
- `{cwd}/.catui/cron-tasks.json`
- `~/.catui/cron-tasks.json` (or `~/.pencils/agents/<id>/.catui/cron-tasks.json`)

**Pros**:
- Users don't need to re-create tasks; existing tasks take effect automatically

**Cons**:
- The two files may be inconsistent in version, causing ambiguity
- Increases maintenance complexity

---

## Recommendation

**Option A (unify at `agentDir`)**: solves the problem at the architecture level, aligns with issue 0012, and has the lowest long-term maintenance cost. Requires adding an `agentDir` field to `ExtensionContext`.

---

## Verification

1. Launch TUI from a non-home directory (e.g. `cd /project && catui`)
2. Create a durable cron task
3. Check that `~/.pencils/agents/<id>/.catui/cron-tasks.json` has the task written
4. Check that the scheduler reads from the same path it writes to
5. Manually `forceDue` or wait for the cron trigger; the task should execute normally

---

## Related issues

- Issue 0012: Gateway data-storage alignment with system directories (within the Catui project)
- REQ-001-proactive-send: Pencil-Agent-Gateway DingTalk proactive-send (already implemented)
