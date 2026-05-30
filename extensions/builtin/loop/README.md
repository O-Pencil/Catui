# Loop Extension

`/loop` schedules a recurring prompt or slash command for the current session.
Uses the unified **cron scheduler** architecture per the refactoring plan.

For the autonomous "keep digging until done" runner, see the sibling
[`grub` extension](../grub/README.md).

## Architecture

```
/loop command ──→ addCronTask ──→ unified store ──→ cron scheduler ──→ onFire ──→ dispatch
                     │                                  │
              CronCreate tool                    file watcher (3s reload)
              CronDelete tool                    jitter + lock
              CronList tool                      7-day expiry
```

**Key design decisions**:
- Single scheduler (cron scheduler) for all tasks
- Single storage (`.nanopencil/cron-tasks.json` for durable, memory for session)
- `/loop` command and CronCreate tool both use `addCronTask`
- Enhanced features (--name, --max, --quiet, pause/resume) built on top

## Quick start

```
/loop check the build                       # every 10m (default)
/loop 5m /grub status                       # slash command every 5 minutes
/loop every 10m Review test failures
/loop Drink water every 30m --name hydrate --max 8 --quiet
/loop Check build every 5m --durable        # persists across sessions
```

## Manage

```
/loop list                  # all scheduled loops
/loop status <ref>          # detail one loop (ref = name or id)
/loop pause <ref>
/loop resume <ref>
/loop run <ref>             # fire immediately
/loop cancel <ref>          # remove one
/loop clear                 # remove all
```

`<ref>` can be either the auto-generated id or the `--name` slug.

## Flags

- `--name <slug>` — give the loop a friendly handle so you can `pause hydrate`
  instead of memorising hex ids.
- `--max <n>` — auto-cancel after `n` runs.
- `--quiet` (or `-q`) — suppress per-tick UI messages. Errors and terminal
  events still surface; routine ticks are still recorded via `appendEntry`.
- `--durable` (or `-d`) — persist the loop across sessions. Durable loops are
  saved to `.nanopencil/cron-tasks.json` and will resume when you reopen the
  project.

## Notes

- By default, loops are **session-scoped**: closing the session clears them.
- Use `--durable` to persist loops across sessions.
- Durable loops are stored in `.nanopencil/cron-tasks.json` in your project
  directory.
- **Auto-expiry**: Durable loops automatically expire after 7 days to prevent
  zombie tasks from accumulating.
- Due tasks wait for the agent to be idle; missed intervals collapse to one
  pending run.
- Slash-command payloads are detected at parse time and dispatched through
  `executeCommand`; everything else is delivered through `sendUserMessage` as
  a follow-up turn.
- After each loop tick the last assistant message is captured (truncated to
  120 chars) and shown in `/loop status <ref>` as `Last output`.
- Supports `s/m/h/d` durations and `hourly`/`daily` shortcuts.
- **Jitter**: Tasks have deterministic jitter (based on task ID) to avoid
  traffic spikes at round times.
- **Scheduler lock**: Multiple sessions in the same project use proper-lockfile
  to prevent duplicate task execution.

## Cron Tools

The extension also registers three tools for the model to use directly:

| Tool | Purpose |
|------|---------|
| `CronCreate` | Create a scheduled task with cron expression |
| `CronDelete` | Delete a scheduled task by ID |
| `CronList` | List all active scheduled tasks |

This allows the model to create and manage scheduled tasks through natural
language understanding, following the refactoring plan's architecture.
