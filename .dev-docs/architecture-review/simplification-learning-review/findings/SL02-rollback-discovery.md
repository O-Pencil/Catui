# SL02: Rollback Must Withdraw the Revision From Skill Discovery

Status: implementing on `refactor/simplification-learning-batch1`. Parent: [proposal](../README.md).

## Evidence

`extensions/optional/evolution/index.ts:236` `discoverResources` returns, for every scope root,
the union of two independent scans:

```ts
const skillPaths = roots.flatMap((root) => [
    ...loadActiveEvolutionSkillPaths(root),   // current revision only
    ...discoverLocalSkillPaths(root),         // every revision ever promoted
]);
```

`discoverLocalSkillPaths` (`evolution-store.ts:1098`) walks `<scopeRoot>/revisions/` and
materializes a `SKILL.md` for every `skill_manifest` artifact in every revision directory. Its
own doc comment states the intent: "enabling local-only users to benefit from all their
accumulated skills".

The consequence: `rollbackEvolution` (`evolution-store.ts:1003`) only rewrites the `current`
pointer. It does not touch `revisions/`, so the withdrawn revision's skills are still returned by
the historical scan and still reach the resource loader. A rolled-back skill keeps being offered
to the model. This contradicts the S08 acceptance requirement that "rollback removes the rejected
revision from active discovery".

Verified as a live path, not dead code: `discoverResources` is registered by
`evolutionExtension`, and `loadActiveEvolutionSkillPaths` / `discoverLocalSkillPaths` are both
imported by `index.ts`.

## Product trade-off and recommendation

The existing behavior and the rollback guarantee are in direct conflict. This finding resolves it
without deleting the local-only benefit.

| Option | Behavior | Cost | Verdict |
| --- | --- | --- | --- |
| A. Keep everything (status quo) | Withdrawn skills stay discoverable forever | A rollback cannot actually withdraw anything; the operator's action has no effect | Rejected: makes rollback decorative |
| B. Drop the historical scan entirely | Only the current revision is ever discoverable | Deletes the local-only accumulation feature; unrelated earlier skills vanish | Rejected: over-corrects and loses working skills |
| C. Withdraw only revisions that were actually rolled back | Historical skills stay; a revision that some rollback moved away from is excluded | Requires a durable withdrawal record | **Recommended and implemented** |

Option C is the minimal change that satisfies both: unrelated valid skills are preserved exactly
as before, and a withdrawn revision stops being discovered.

## Design

The withdrawal record already exists durably. `rollbackEvolution` appends a `rolled_back` event
to `<scopeRoot>/history.jsonl` carrying `rollbackOf: <withdrawn revision id>`. Auto-rollback
(`autoEvaluateAndRollback`) routes through the same function, so it emits the same event and is
covered without a second mechanism.

Using history rather than the `current` pointer matters: the pointer's `rollbackOf` only remembers
the most recent rollback, so a second rollback would silently resurrect the first withdrawn
revision. The history log does not have that failure mode.

Two changes, both in the existing owner `evolution-store.ts`:

1. `readWithdrawnRevisionIds(scopeRoot)` reads `history.jsonl` and collects `rollbackOf` from every
   `rolled_back` event. Malformed lines are skipped rather than throwing, matching the existing
   fail-soft treatment of corrupted manifests.
2. `discoverLocalSkillPaths` skips withdrawn revisions and removes any `resources/skills/_local/<rev>`
   directory left behind by an earlier run, so a stale materialized copy cannot re-enter discovery.

`loadActiveEvolutionSkillPaths` is unchanged: the current revision is authoritative by definition
and is never withdrawn while current.

## Invariants

- Unrelated, non-withdrawn historical skills remain discoverable.
- A rolled-back revision's skills are not returned by either scan.
- The materialized directory of a withdrawn revision is removed, not merely unreferenced.
- Auto-rollback and manual rollback both withdraw, via the same event.
- Malformed or missing `history.jsonl` degrades to "nothing withdrawn", the prior behavior.
- No new store, no new persisted schema, no new artifact type. `history.jsonl` already exists and
  already records the event.

## Reopen conditions

If a user needs a withdrawn skill to remain available for reference, that is a separate
reference-only surface, not active discovery, and needs its own finding.
