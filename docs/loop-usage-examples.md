# Loop Extension Usage Examples

## Basic Usage

### Session-Scoped Loops (Default)

Session-scoped loops are cleared when you close the session.

```bash
# Check the build every 10 minutes (default)
/loop check the build

# Run a command every 5 minutes
/loop 5m /grub status

# Check PR reviews every 20 minutes
/loop every 20m Review test failures

# Remind to drink water every 30 minutes
/loop Drink water every 30m --name hydrate --max 8 --quiet
```

### Durable Loops (Persistent Across Sessions)

Durable loops are saved to `.nanopencil/loop-tasks.json` and resume when you reopen the project.

```bash
# Monitor build status every 5 minutes, persists across sessions
/loop Check build status every 5m --durable

# Check for new commits every hour
/loop 1h Check for new commits --durable

# Daily status check at 9 AM
/loop Daily status check --durable --name daily-check
```

## Managing Loops

### List All Loops

```bash
/loop list
```

Output:
```
[Loop] 3 scheduled tasks:
- build-monitor (abc123) every 5m next in 3m [durable] Check build status
- hydrate (def456) every 30m next in 15m [quiet, max 2/8] Drink water every 30m
- ghi789 every 10m next in 8m /grub status
```

### Get Loop Status

```bash
/loop status build-monitor
```

Output:
```
[Loop] build-monitor (abc123) — scheduled
Every: 5m
Kind: prompt (durable)
Next run: Sat Apr 18 2025 01:05:00 GMT+0800 (in 3m)
Last run: Sat Apr 18 2025 01:00:00 GMT+0800
Run count: 5
Input: Check build status
Last output: Build is green
```

### Pause and Resume

```bash
/loop pause build-monitor
/loop resume build-monitor
```

### Run Immediately

```bash
/loop run build-monitor
```

### Cancel a Loop

```bash
/loop cancel build-monitor
# or by ID
/loop cancel abc123
```

### Clear All Loops

```bash
/loop clear
```

## Advanced Features

### Named Loops

```bash
/loop Check build every 5m --name build-monitor
/loop pause build-monitor
```

### Maximum Runs

```bash
/loop Drink water every 30m --name hydrate --max 8 --quiet
```

### Quiet Mode

Suppresses per-tick UI messages (errors and terminal events still surface):

```bash
/loop 5m Check system status --quiet
```

### Combining Flags

```bash
/loop Check build every 5m --name build-monitor --durable --quiet
```

## Durable vs Session-Scoped Loops

| Feature | Session-Scoped | Durable |
|---------|---------------|---------|
| Persistence | Lost when session closes | Saved to disk |
| Multi-process safety | N/A (per-process) | Protected by lock |
| Use case | Temporary tasks | Long-running monitoring |
| Storage | In-memory | `.nanopencil/loop-tasks.json` |

## Real-World Examples

### Development Workflow

```bash
# Monitor build status while developing
/loop npm run build --name build-check

# Run tests every time you save
/loop npm test --name test-checker --quiet

# Check for linting errors
/loop npm run lint --name linter --durable
```

### Project Monitoring

```bash
# Check for new git commits
/loop git pull --name git-update --durable

# Monitor dependencies
/loop npm outdated --name deps-check --durable

# Check server health
/loop curl http://localhost:3000/health --name health-check --durable
```

### Productivity

```bash
# Take breaks
/loop Take a break every hour --name break-reminder --max 4

# Daily standup reminder
/loop Daily standup every 24h --name standup --durable

# Code review reminder
/loop Review pending PRs every 2h --name pr-review --durable
```

## Troubleshooting

### Loop Not Running

1. Check if loop is paused: `/loop status <name>`
2. Check if max runs reached: look at run count in status
3. Check if session is idle: loops only run when agent is idle

### Durable Loop Not Persisting

1. Check if `.nanopencil/loop-tasks.json` exists
2. Verify you used `--durable` flag
3. Check file permissions on project directory

### Multiple Instances Triggering Same Loop

The scheduler lock prevents this. If you see multiple triggers:
1. Check if lock file exists: `.nanopencil/loop-scheduler.lock`
2. Manually remove lock file if necessary
3. Restart nanoPencil

## File Locations

```
<nanopencil>
├── .nanopencil/
│   ├── loop-tasks.json          # Durable loop storage
│   └── loop-scheduler.lock      # Scheduler lock file
```

## Best Practices

1. **Use meaningful names**: `--name` makes it easier to manage loops
2. **Set appropriate intervals**: Don't poll too frequently (minimum 1m)
3. **Use durable for long-running tasks**: `--durable` for tasks that should survive session restarts
4. **Use max runs for finite tasks**: `--max` for tasks that should auto-cancel
5. **Use quiet for frequent tasks**: `--quiet` reduces UI noise
6. **Monitor loops**: Regularly check `/loop list` to ensure loops are working as expected