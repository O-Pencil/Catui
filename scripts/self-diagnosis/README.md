# scripts/self-diagnosis/

> ⚠ **Maintainer tooling — not for users.** These scripts read the developer-owned insforge backend and write to it with `variant='self-diagnosis'`. They are invoked manually. They are not auto-loaded into any pencil session and do not consume user tokens.

## Purpose

Run reflexive self-study tasks against pencil's own historical `eval_*` data. Each run:
1. Loads a task archetype prompt
2. Invokes pencil (`cli.ts --print`) with that prompt
3. Captures both pencil's natural-language output and the new `eval_*` rows produced as a side effect
4. Writes a structured metric row to `eval_metric_results` (the self-diagnosis sink — see `.dev-docs/data/field-purpose-matrix.md`)

## Status

Skeleton only — none of these scripts are runnable yet. Implementation tracked in `.dev-docs/data/writer-todos.md` and `.dev-docs/self-awareness/charter.md`.

## Layout

```
scripts/self-diagnosis/
├── README.md            ← this file
├── run.ts               ← CLI entrypoint
├── archetypes/
│   └── A-self-trace.ts  ← Archetype A: longest-tool-sequence post-mortem
└── lib/
    └── eval-sink.ts     ← writes to insforge with variant='self-diagnosis'
runs/                    ← per-run artifacts (task + output + analysis), gitignored
```

## Planned usage (when implementation lands)

```bash
# From repo root, single run of Archetype A:
node --import tsx scripts/self-diagnosis/run.ts --archetype=A

# Reads .memory-experiments/credentials.json (or NANOPENCIL_ISSUE_*) for insforge creds.
# Writes: scripts/self-diagnosis/runs/<date>/{task.md,output.md,analysis.json}
# Writes: one eval_metric_results row, variant='self-diagnosis'
```

## Why not in `extensions/defaults/`

Default extensions auto-load in every user session. Self-diagnosis would (a) consume user tokens, (b) probe a backend whose credentials are developer-only, (c) write data the user has no consent to. Keeping it in `scripts/` enforces the manual-only contract.

## Why not a cron / scheduled routine

Same reason. Auto-scheduling implies production behavior; self-diagnosis is R&D. Manual dispatch keeps the maintainer in the loop on token cost, model choice, and observation cycle.
