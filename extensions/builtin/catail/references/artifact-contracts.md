# CATAIL Artifact Contracts

Use these contracts when creating, migrating, or validating a `research/` workspace. Equivalent project-native formats are allowed when they preserve the same information and stable identifiers.

## Stable identifiers

Recommended prefixes:

| Object | Example |
|---|---|
| Search | `Q-001` |
| Source | `SRC-001` |
| Claim | `C-001` |
| Study | `S-001` |
| Run | `R-001` |
| Analysis | `A-001` |
| Evidence | `E-001` |
| Figure | `F-001` |

Never recycle an ID for a different object. Revisions append `-rN` or use an explicit revision field.

## Required files

`RESEARCH.md` headings: Purpose, Accountable Owner, Intended Use, Primary Question, Scope, Out of Scope, Falsification Conditions, Governance and Safety, Current Stage, Open Decisions.

`METHOD.md` headings: Evidence Policy, Literature Search Policy, Claim Lifecycle, Protocol Revision Policy, Analysis Classes, Reproducibility Policy, Confidentiality and External Services, Human Approval Gates.

`literature/search-log.csv` columns: `search_id,source,query,filters,accessed_at,result_count,retained_ids,status,notes`.

`claims/claims.csv` columns: `claim_id,statement,claim_type,status,scope,rival_explanations,prediction,evidence_needed,evidence_ids,source_ids,analysis_class,owner,verified_at`.

`studies/<study-id>/STUDY.md` headings: Study ID and Revision, Status, Research Question, Claim IDs, Hypotheses and Predictions, Units and Population, Conditions and Controls, Variables and Metrics, Allocation and Replication, Data and Code Versions, Planned Analysis, Exclusions and Missingness, Stopping and Failure Rules, Safety and Governance, Amendments.

`runs/<run-id>/manifest.json` fields: `runId`, `studyId`, `protocolRevision`, `status`, `operator`, `startedAt`, `completedAt`, `codeRevision`, `dataIds`, `environment`, `configuration`, `command`, `outputs`, `deviations`, `parentRunId`.

`analysis/analysis-register.csv` columns: `analysis_id,study_id,run_ids,analysis_class,plan_reference,status,artifact_path,deviations,created_at,owner`.

`evidence/claim-evidence.csv` columns: `evidence_id,claim_id,evidence_type,artifact_path,source_ids,direction,scope,uncertainty,verification_status,verified_by,verified_at,limitations`.

## Fail-closed states

Use explicit empty, `unresolved`, `not_applicable`, `not_started`, `blocked`, `failed`, or `unverified` values as appropriate. Do not use placeholder prose that resembles a completed fact. Templates contain markers that should remain visibly incomplete until a human or verified artifact supplies the value.

The bundled audit checks shapes and bindings only. It does not validate the truth of field contents.
