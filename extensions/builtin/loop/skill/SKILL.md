---
name: loop
description: Schedule a prompt or slash command to run on a recurring interval. Use CronCreate to set up scheduled tasks, CronList to view them, and CronDelete to cancel them.
disable-model-invocation: false
---

# /loop - Scheduled Task Skill

Schedule prompts or commands to run on a recurring interval.

## Quick Start

When the user wants to schedule a recurring task, use the **CronCreate** tool.

### Interval to Cron Conversion

| Interval | Cron Expression | Description |
|----------|----------------|-------------|
| `5m` | `*/5 * * * *` | Every 5 minutes |
| `30m` | `*/30 * * * *` | Every 30 minutes |
| `1h` | `0 */1 * * *` | Every hour |
| `2h` | `0 */2 * * *` | Every 2 hours |
| `1d` | `0 0 */1 * *` | Daily at midnight |
| `30s` | `*/1 * * * *` | Every minute (seconds round up to 1m minimum) |

### Parsing Rules

1. **Leading interval**: If the first token matches `^\d+[smhd]$`, it is the interval.
   - Example: `5m check deploy` → interval=5m, prompt="check deploy"

2. **Trailing "every" clause**: If input ends with `every <N><unit>` or `every <N> <unit-word>`, extract as interval.
   - Example: `check deploy every 20m` → interval=20m, prompt="check deploy"
   - Example: `check every PR` → No interval (not a duration), entire input is prompt

3. **Default**: If no interval found, use `10m` (every 10 minutes).
   - Example: `check deploy` → interval=10m, prompt="check deploy"

### CronCreate Usage

```
CronCreate({
  cron: "*/5 * * * *",     // Converted from interval
  prompt: "check deploy",   // The prompt/command to run
  recurring: true,          // Always true for /loop
  durable: false            // false = session-only, true = persists across sessions
})
```

### Important Rules

1. **Always execute immediately after creating**: After calling CronCreate, immediately execute the prompt as if the user typed it.
2. **Inform the user**: Tell the user the task ID, schedule, and that it will run immediately.
3. **Default interval**: If no time specified, default to every 10 minutes.
4. **Durable tasks**: Only set `durable: true` if the user explicitly asks for persistence across sessions.
5. **Maximum tasks**: 50 tasks per project.

### Examples

User says: `/loop 5m check deploy`
→ Call CronCreate with cron="*/5 * * * *", prompt="check deploy", recurring=true
→ Then execute "check deploy" immediately

User says: `/loop check deploy every 20m`
→ Call CronCreate with cron="*/20 * * * *", prompt="check deploy", recurring=true
→ Then execute "check deploy" immediately

User says: `/loop check every PR`
→ Call CronCreate with cron="*/10 * * * *" (default), prompt="check every PR", recurring=true
→ Then execute "check every PR" immediately

User says: `/loop 1h /standup 1`
→ Call CronCreate with cron="0 */1 * * *", prompt="/standup 1", recurring=true
→ Then execute "/standup 1" immediately

### Managing Tasks

- **View tasks**: Use **CronList** tool to see all scheduled tasks
- **Cancel a task**: Use **CronDelete** tool with the task ID
- **Recurring expiry**: Durable recurring tasks expire after 7 days automatically
