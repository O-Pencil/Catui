# Baseline snapshots — pre-refactor (main)

Frozen artifacts the refactor is verified against. Recorded on `main`.

| File | What | Recorded |
|------|------|----------|
| `public-api-symbols-main.txt` | 296 public exports of root `index.ts` (TS compiler API) | main@0eea985, 2026-05-31 |

P4/P5 verification: regenerate the symbol table on the refactor branch and diff
against `public-api-symbols-main.txt` — it must stay identical unless a domain
review explicitly declares an API change (GB-2).

Numeric baseline (cycles / tsc-time / dist size) lives in
`../execution-plan/P0-prepare.md` Baseline Record.
