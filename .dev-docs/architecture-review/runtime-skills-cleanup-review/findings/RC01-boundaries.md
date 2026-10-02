# RC01 — Cohesive owners rather than file-size shuffling

AgentSession currently mixes composition, queued input, trace persistence,
statistics, extension resource metadata, and Soul side effects. Prior reviews
already extracted model/lifecycle/compaction owners; reuse those seams.

Extraction must transfer owned state with its operations. Pure queries take
snapshots. The event owner needs eleven named capabilities because it joins
journaling, presentation, and recovery. This reviewed exception preserves their
ordering without passing the whole session, introducing another registry, or
duplicating retry policy. Event-order regression tests cover the boundary.
Runtime collaborators must not import the session facade. Keep facade
methods as delegation rather than introducing inheritance or a broad host object.
Larger remaining orchestration is an explicit trade-off: do not split by line
count at the cost of hidden coupling. Test event ordering and recovery boundaries.

TypeSafe upstream is an API integration skill, usable by general agents. Bundling
it alone does not implement an execution loop. Catui's companion guidance connects
decision, tool, and evaluation stages using existing hooks and existing tools;
runtime permission checks remain authoritative. No claim of measured model-quality
improvement is justified without a provider-backed evaluation.
