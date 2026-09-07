# RE01: Candidate-specific evidence is required

status: addressed for source evolution; legacy declarative gate unchanged
severity: load-bearing design constraint

`extensions/optional/evolution/evolution-gate.ts:runEvolutionGate()` currently
accepts `_candidate` without executing that candidate. Project/evolved fixture
adapters return recorded data. `evolution-fixture.ts:evalFixtureContent()` creates
observed events by cloning recorded events.

These mechanisms support record validation and existing harness health checks.
They do not establish that a proposed source patch improves task execution.

Before source PR automation, run baseline and candidate artifacts in independent
workspaces against a frozen reproduction and regression set. Bind reports to
source commits and evaluation contract hashes. Preserve uncertainty for noisy
model behavior. A negative-control unchanged or deliberately broken candidate
must not pass the improvement gate.

Acceptance: a real Catui defect fails before the patch, passes after the patch,
and remains covered by an executable regression test through version adoption.

Implemented in source/delivery/repair.ts and release.ts: freeze the test hash,
require baseline assertion failure and candidate success, recheck merged source
and test before packaging. Native Git/Node integration tests cover the transition.
Live naturally occurring product defects remain subject to the same acceptance.
