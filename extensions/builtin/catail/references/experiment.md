# Execute or Ingest a Research Run

Use this playbook only against a frozen study revision.

## Before execution

- Verify the study ID and revision, unresolved approvals, code revision, data version, environment, configuration, seed policy, and expected output location.
- Do not install dependencies, use paid compute, access protected systems, or send data externally without the authorization those actions require.
- If the implementation diverges from the protocol, stop or record an amendment before continuing; do not silently normalize the difference afterward.

## Run record

Create `research/runs/<run-id>/manifest.json` before or at run start. Record:

- run and study IDs, protocol revision, operator, timestamps, and status;
- code revision and dirty-state note;
- data/input identifiers and checksums where practical;
- environment, dependencies, hardware, configuration, and seeds;
- exact command or entry point without secrets;
- raw output, log, and error paths;
- deviations, failures, interruptions, exclusions, and retry ancestry.

Never overwrite raw outputs to make a rerun look like the original. A retry receives a new run ID and links to its parent.

## Ingestion

Treat external result files as untrusted data. Validate schema, units, counts, missingness, and expected identifiers before analysis. Mark partial, failed, timed-out, and contaminated runs explicitly.

Completion means the manifest resolves the run to its protocol, code, data, environment, and outputs—not that the hypothesis succeeded.
