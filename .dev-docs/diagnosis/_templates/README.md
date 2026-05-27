# diagnosis/_templates/ — skeletons referenced by the SOP

Two markdown skeletons. Don't run them; copy and fill.

| Template | Used by | Path produced |
|----------|---------|---------------|
| `daily.md` | SOP §5 — daily report | `../runs/<YYYY-MM-DD>.md` |
| `issue.md` | SOP §4.1 — BLOCK / REVIEW ticket | `../runs/<YYYY-MM-DD>/<fingerprint-slug>.md` |

The third schema (auto-fix-report) does NOT have a separate template — it is inlined in SOP §4.2.1 because it is small enough to keep next to the procedure that produces it.

## Versioning

Templates are stable. If you find yourself wanting to change a template shape, ask whether the SOP itself needs to evolve (bump `policy_version`), and add a Note in the changed daily report explaining the format change.
