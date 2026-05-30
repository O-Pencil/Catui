# Grub Extension

`/grub` runs one autonomous long-running task until the agent reports it
complete, reports it is blocked, the user stops it, or a safety limit is
reached. The harness design follows the pattern described in Anthropic's
[Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):
a structured on-disk state lets coding agents pick up where they left off
even across fresh context windows and full process restarts.

## Commands

- `/grub <goal> [--max-iter N] [--max-fail N]` — start one autonomous task
- `/grub status [--json]` — show the active or last finished grub task
- `/grub resume` — resume dispatch for an adopted/persisted task
- `/grub stop` — stop the active grub task

## Harness artifacts

Each task owns a directory at `.grub/<task-id>/`:

| File | Purpose | Who may write |
|------|---------|---------------|
| `feature-list.json` | Structured list of end-to-end features | Initializer writes the whole file once; coding agents may only flip `passes` and set `evidence` |
| `progress-log.md` | Dated notes describing each iteration | Agent, append-only |
| `init.sh` | Get-bearings + project smoke script run at the start of every iteration | Initializer; later agents may add project-specific smoke commands |
| `state.json` | Durable `GrubTaskState` snapshot for cross-session resume | Controller, atomic writes |

`feature-list.json` schema (version 1):

```json
{
  "version": 1,
  "goal": "<user goal>",
  "features": [
    {
      "id": "kebab-slug",
      "category": "functional|verification|polish",
      "description": "observable behavior",
      "steps": ["actionable", "verification", "steps"],
      "passes": false,
      "evidence": "optional git sha or short proof"
    }
  ]
}
```

The controller validates every mutation: changing `description`, `steps`,
`category`, `id`, list length, or reordering counts as a violation. Agents
are told up front that the only permitted edits are toggling `passes` and
setting `evidence`.

## How it works

- Each grub iteration is tagged with a `[GRUB:<id>:<n>]` prompt prefix so
  the extension can recognise its own injected turns.
- On start, grub creates the harness directory and writes the initial
  artifacts without creating a git commit. The harness keeps durable state on
  disk and leaves source changes visible in the working tree, avoiding noisy
  `grub(...)` commits unless the user explicitly asks for them.
- Two phase-specialized system prompts are injected via
  `before_agent_start`:
  - **Initializer prompt** (first successful turn): expand
    `feature-list.json` into 15-40 concrete features, harden `init.sh`,
    seed `progress-log.md`. No broad implementation yet.
  - **Coding prompt** (remaining turns): run `init.sh`, pick exactly one
    pending feature, implement + verify end-to-end, flip `passes` +
    `evidence`, and append to `progress-log.md`.
- At the end of every grub turn the assistant must emit a single
  `<loop-state>{"status":"continue|complete|blocked", "summary":"...", "nextStep":"..."}</loop-state>`
  block. The extension parses it and dispatches the next iteration or
  stops with a terminal status.
- **Mutation guard**: after the initializer creates the first real
  `feature-list.json`, each subsequent turn is diffed against the persisted
  baseline. Rewriting feature ids, descriptions, categories, steps, count, or
  order is rejected and retried; only `passes` and `evidence` may change.
- **Completion guard**: if the decision says `complete` but
  `feature-list.json` still has `passes:false` entries, the controller
  rewrites the decision to `continue` with a synthetic `nextStep`
  pointing at the first pending feature. The harness will not allow
  premature "done".
- **Cross-session resume**: `GrubTaskState` is written atomically to
  `state.json` on every transition. On the next session, `session_start`
  calls `discoverActiveTasks()` and adopts the most recent running task
  without auto-dispatching — the user types `/grub resume` to continue.
- **Safety limits**: 25 iterations and 3 consecutive failures by default;
  override with `--max-iter` / `--max-fail`.
- **Stale harness cleanup**: on extension load, terminal harnesses older
  than 30 days are pruned from `.grub/`.

## Legacy migration

Earlier versions wrote `feature-checklist.md` (markdown checkboxes). When a
new iteration starts and `feature-list.json` is missing but the legacy file
exists, its checkbox items are migrated into the JSON format (category
defaults to `functional`; `steps` start empty so the initializer can refine
later).

## Related

For the recurring scheduler that runs prompts or slash commands on an
interval, see the sibling [`loop` extension](../loop/README.md).
