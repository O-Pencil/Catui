# diagnosis/archive/ — historical daily diagnosis output

> Older daily reports rotated out of `../runs/` for retention.
> The archive mirrors `runs/`'s layout but partitioned by year-month.

## Layout

```
archive/
├── README.md                    ← this file
└── <YYYY-MM>/
    ├── <YYYY-MM-DD>.md
    └── <YYYY-MM-DD>/
        ├── <slug>.md
        └── auto-fix-reports/
            └── <slug>.md
```

## Rotation policy

Manual. The SOP does not auto-archive. When the maintainer judges that `runs/` is cluttered (typically: > 30 active reports, or end-of-quarter cleanup), they:

1. Identify the month boundary to roll out (e.g., everything dated 2026-04-xx).
2. `git mv .dev-docs/diagnosis/runs/2026-04-* .dev-docs/diagnosis/archive/2026-04/` (creating the month dir if needed).
3. Commit with `chore(diagnosis): rotate <YYYY-MM> into archive`.

This is a manual step on purpose — it makes the maintainer think about whether old findings still matter.

## What's currently in archive

- **2026-05/** — bootstrapped during the 2026-05-27 layout migration. Contains 5 daily reports (5-13 through 5-17) from the SOP v1 era when artifacts lived in the gitignored `docs/issues/`. These were the bootstrap dry-run + four real-but-quiet days and the architecture-relevant 5-17 retrospective. Preserved here for historical context.

## Why archive instead of delete

Daily reports are evidence. The audit at `.dev-docs/diagnosis/audit-2026-05-17.md` cites several of these reports as source material. Future audits will too. Archiving keeps the trail without bloating the working `runs/` view.

Delete is reserved for: tests, fake data, drafts. Real diagnosis output stays.
