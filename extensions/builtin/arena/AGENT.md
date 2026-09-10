# Arena Extension

Parallel subagent racing — spawn multiple subagents competing to solve the same problem with different strategies.

## Members

| File | WHO | FROM | TO |
|------|-----|------|----|
| `index.ts` | Arena extension entry, commands, message renderer | @catui/tui, core/extensions-host/types, ./arena-runner | builtin-extensions.ts |
| `arena-runner.ts` | ArenaRunner class, parallel spawn orchestration | core/sub-agent, core/workspace, core/tools | ./index.ts |
| `arena-types.ts` | ArenaContestant, ArenaReport, ArenaRunOptions types | core/sub-agent types | ./arena-runner, ./index |

## Key Parameters

- Max contestants: 4
- Default timeout: 5 minutes per contestant
- Each contestant gets isolated git worktree
- Winner = fastest successful completion

## Commands

- `/arena:run <problem> --strategies "s1|s2|..."` — Start race
- `/arena:stop` — Cancel running race
- `/arena:status` — Show current status
- `/arena:results` — Show latest results
- `/arena:cleanup` — Remove worktrees
- `/arena:help` — Show help
