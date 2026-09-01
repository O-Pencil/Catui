# CATAIL Artifact Contracts

Use these contracts when creating, migrating, or validating a `research/` workspace. Equivalent project-native formats are allowed when they preserve the same information and stable identifiers.

## Stable identifiers

Recommended prefixes:

| Object | Example |
|---|---|
| Search | `Q-001` |
| Source | `SRC-001` |
| Claim | `C-001` |
| Hypothesis | `H-001` |
| Study | `S-001` |
| Run | `R-001` |
| Analysis | `A-001` |
| Evidence | `E-001` |
| Figure | `F-001` |
| Iteration | `I-001` |

Never recycle an ID for a different object. Revisions append `-rN` or use an explicit revision field.

## Required files

`RESEARCH.md` headings: Purpose, Accountable Owner, Intended Use, Requested Endpoint and Stop Boundary, Language and Terminology, Research Origin, Topic or Observation, Observation Provenance, Candidate Questions, Evidence Boundary, Primary Question, Candidate Contribution, Selected Research Modes, Scope, Out of Scope, Falsification Conditions, Governance and Safety, Current Stage, Open Decisions.

`METHOD.md` headings: Evidence Policy, Literature Search Policy, Research Position Policy, Claim Lifecycle, Protocol Revision Policy, Iteration Policy, Analysis Classes, Reproducibility Policy, Confidentiality and External Services, Human Approval Gates.

`literature/search-log.csv` columns: `search_id,source,query,filters,accessed_at,result_count,retained_ids,status,notes`.

`literature/source-register.csv` columns: `source_id,search_ids,citation,identifier,source_type,publication_status,year,url_or_path,access_status,relevance,supports,challenges,quality_notes,verified_by,verified_at`.

`POSITION.md` headings: Search Scope, State of the Art, Nearest Prior Work, Competition and Saturation, Candidate Contribution, Publication Dimensions, Feasibility, Null and Negative Result Value, Risks and Fatal Flaws, Decision and Rationale, Revisit Triggers. The decision begins with `advance`, `pilot-only`, `reframe`, `search-more`, or `stop`.

`claims/claims.csv` columns: `claim_id,statement,claim_type,status,scope,rival_explanations,prediction,evidence_needed,evidence_ids,source_ids,analysis_class,owner,verified_at`.

`claims/hypothesis-register.csv` columns: `hypothesis_id,claim_id,statement,origin,class,basis,rival_to,discriminating_prediction,disconfirming_result,indeterminate_result,source_ids,status`.

`studies/<study-id>/STUDY.md` headings: Study ID and Revision, Status, Position Decision Reference, Study Role, Research Question, Claim IDs, Hypotheses and Predictions, Units and Population, Conditions and Controls, Variables and Metrics, Allocation and Replication, Data and Code Versions, Planned Analysis, Exclusions and Missingness, Stopping and Failure Rules, Safety and Governance, Amendments.

`runs/<run-id>/manifest.json` fields: `runId`, `studyId`, `protocolRevision`, `status`, `operator`, `startedAt`, `completedAt`, `codeRevision`, `dataIds`, `environment`, `configuration`, `command`, `outputs`, `deviations`, `parentRunId`.

`analysis/analysis-register.csv` columns: `analysis_id,study_id,run_ids,analysis_class,plan_reference,status,artifact_path,deviations,created_at,owner`.

`evidence/claim-evidence.csv` columns: `evidence_id,claim_id,evidence_type,artifact_path,source_ids,direction,scope,uncertainty,verification_status,verified_by,verified_at,limitations`.

`iterations/iteration-log.csv` columns: `iteration_id,trigger,prior_claim_status,diagnosis,decision,new_question_or_hypothesis,study_revision_or_id,analysis_class,next_evidence,status,decided_at,owner`.

## Fail-closed states

Use explicit empty, `unresolved`, `not_applicable`, `not_started`, `blocked`, `failed`, or `unverified` values as appropriate. Do not use placeholder prose that resembles a completed fact. Templates contain markers that should remain visibly incomplete until a human or verified artifact supplies the value.

The bundled audit checks shapes and bindings only. It does not validate the truth of field contents.
