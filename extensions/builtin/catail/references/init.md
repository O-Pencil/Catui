# Initialize a CATAIL Workspace

Use this playbook when the repository has no durable research workspace or when the user asks to establish one.

## Intake

Establish only the context needed to begin scientific work:

- research origin, topic or observation, provenance, intended knowledge change, scope, and out-of-scope questions;
- requested endpoint and hard stop boundary;
- dialogue, artifact, source, and terminology language scopes;
- available literature, code, data, results, manuscript material, time, and domain expertise;
- repository and data locations, sensitivity, authorization, retention, and permitted processing;
- immediately relevant ethics, privacy, safety, dual-use, legal, or institutional gates.

Record unresolved items explicitly. Do not make accountable owner, authorship, venue, exact sample size, compute budget, or run configuration the opening interview unless it blocks authorization, safety, basic feasibility, or the user's requested endpoint. Resolve each before the action it governs.

Do not ask the user to paste restricted material when local paths or metadata are enough.

## Create

Read [artifact-contracts.md](artifact-contracts.md), then create the minimum workspace from the bundled templates:

- `research/RESEARCH.md` for project facts and question boundaries;
- `research/METHOD.md` for evidence, revision, analysis, and governance policy;
- empty search, source, claim, hypothesis, analysis, iteration, and claim-evidence registers with their required headers;
- `research/POSITION.md` as an explicitly incomplete pre-design gate.

Do not create a study, run, result, claim, citation, or approval that does not exist. Empty registers are valid initial state.

## Acceptance

- All mandatory headings exist.
- Unknowns are explicit rather than replaced by plausible text.
- The project says what requires human approval and what data may leave the machine.
- `audit.mjs --stage frame` passes structurally.

After initialization, route to `frame`; do not create a study or start experimenting until the Position gate passes.
