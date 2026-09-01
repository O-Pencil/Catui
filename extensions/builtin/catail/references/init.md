# Initialize a CATAIL Workspace

Use this playbook when the repository has no durable research workspace or when the user asks to establish one.

## Intake

Resolve or mark `unresolved`:

- accountable human owner and intended use;
- topic, target audience or venue, scope, and out-of-scope questions;
- repository and data locations, sensitivity, authorization, retention, and permitted processing;
- ethics, privacy, safety, dual-use, publisher, funder, and institutional gates;
- available literature, code, data, compute, time, and domain expertise;
- working definitions of success, falsification, and stopping.

Do not ask the user to paste restricted material when local paths or metadata are enough.

## Create

Read [artifact-contracts.md](artifact-contracts.md), then create the minimum workspace from the bundled templates:

- `research/RESEARCH.md` for project facts and question boundaries;
- `research/METHOD.md` for evidence, revision, analysis, and governance policy;
- empty search, claim, analysis, and claim-evidence registers with their required headers.

Do not create a study, run, result, claim, citation, or approval that does not exist. Empty registers are valid initial state.

## Acceptance

- All mandatory headings exist.
- Unknowns are explicit rather than replaced by plausible text.
- The project says what requires human approval and what data may leave the machine.
- `audit.mjs --stage frame` passes structurally.

After initialization, route to `frame`; do not start searching or experimenting unless requested.
