# diagnosis/runs/ — active daily diagnosis output

> Tracked-in-git output of the agent-driven daily diagnosis SOP (`.dev-docs/diagnosis/sop.md`).
> Each day the agent fires, writes its findings here, commits to a dedicated branch, and opens a PR for the maintainer to review (see SOP §9.3).

## Layout (per day)

```
runs/
├── README.md                    ← this file
├── <YYYY-MM-DD>.md              ← daily index report
└── <YYYY-MM-DD>/                ← per-day subdir (only if there were tickets or auto-fixes)
    ├── <fingerprint-slug>.md    ← BLOCK / REVIEW ticket
    ├── ...
    └── auto-fix-reports/
        └── <fingerprint-slug>.md
```

If a day had zero events and zero AUTO-FIX activity, only the single `<date>.md` file is created (the subdir is omitted).

## Lifecycle of a daily run

1. Cron fires (LA 09:00).
2. Agent rebases `agent/diagnosis-<date>` on `main`.
3. Agent executes SOP §1 → §8.
4. Agent commits artifacts under `runs/` (and any AUTO-FIX commits on separate `auto/issue-*` branches off `main`).
5. Agent pushes; opens PR for the daily-diagnosis branch and any AUTO-FIX branches.
6. Maintainer reviews each PR. Merges or closes per-PR.
7. After merge, branch is auto-deleted by GitHub.

## Rotation to archive

When `runs/` accumulates entries older than ~30 days (or by maintainer judgment), the maintainer moves entire daily folders into `../archive/<YYYY-MM>/`. The archive directory mirrors this layout. The SOP does not auto-archive — see §9.4.

## Templates

The templates that the SOP §4 and §5 reference live one directory up at `../_templates/`:
- `_templates/daily.md` — skeleton for `<date>.md`
- `_templates/issue.md` — skeleton for `<date>/<slug>.md`

The auto-fix-report schema is inlined in SOP §4.2.1 (no separate template — the schema is small and stable).

## Why this directory exists at all

Earlier versions of the SOP wrote to `docs/issues/` which was gitignored under the broad `docs/` rule. That meant daily reports never entered the git history — they were ephemeral local logs invisible to anyone but the machine that ran them. The 2026-05-27 migration moved diagnosis artifacts into `.dev-docs/` (tracked) so the PR/review flow can work.

Old reports from before the migration are at `../archive/2026-05/`.
