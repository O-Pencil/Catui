# Consolidation Acceptance

Local acceptance on 2026-09-08:

- Five repository gates and static/dist package boundaries passed.
- Evolution benchmark, PawBench, CLI, store and promotion suite: 137 passed.
- Native source containment and real baseline/candidate suite: 27 passed.
- Critical harness: 220 passed; standard and weak-model-compatible evals passed.
- Final source/context regressions: 38 passed, including rejection of a release
  tag pointing to another commit before publication starts.
- Built CLI version and unconfigured evolution status smoke passed.
- Public exports and package dependencies unchanged; DIP maps remain consistent.

The final source snapshot resets observation on unconfigured session switches
and rejects conflicting release tags. Consolidation preserves both source repair
and declarative benchmark contracts and updates the historical finding accordingly.

Linux CI exposed a usage-test ordering assumption: two records can share a
timestamp, so their returned order cannot identify success versus error. The test
now selects each record by its asserted outcome before checking feedback linkage.
Product behavior and the required success/error assertions remain unchanged.

Remote CI is the remaining merge gate. No registry publication or background
service activation is performed by this consolidation. Existing dirty worktrees
and historical experiment branches remain available without destructive cleanup.
