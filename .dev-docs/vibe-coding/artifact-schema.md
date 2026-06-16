# Dev Loop Artifact Schema

Artifacts default to `.catui/dev-loop/<run-id>/`. Callers may override the root with `--artifact-root`.

## Files

- `state.json`: Current run summary and top-level decision.
- `verification-run.json`: Full local verification run with command timings, exit codes, log refs, and issues.
- `issues.json`: Deduplicated `IssueRecord[]`.
- `attempts.jsonl`: Append-friendly decision/event log for future resumable loops.
- `progress-log.md`: Human-readable run summary.
- `autonomy-state.json`: Computed readiness state for continuing, completing, or blocking the loop.
- `handoff.md`: Short resumable summary for the next agent.
- `raw/<command-id>.log`: Full stdout/stderr for a command.
- `compact/<command-id>.log`: Focused failure summary for quick agent context.
- `github-checks.json`: Raw PR check JSON for `dev-loop:pr` runs.

## IssueRecord

An issue record contains:

- `source`: `local` or `github`.
- `commandId` and `command`: The failing verification source.
- `kind`: Parser classification, such as `typescript`, `node-test`, `dip`, or `quality-boundary`.
- `signature`: Stable fingerprint used for deduplication.
- `summary`: Human-readable failure summary.
- `evidence`: Observations across attempts, including `logRef` and excerpt.
- `status`: `open`, `fixed`, or `blocked`.
- `attemptCount`: Number of matching observations.
- `lastFailureLogRef`: Most recent raw log path.

## Fingerprints

The first implementation uses stable local fingerprints:

- TypeScript: `typescript:<file>:<line>:<column>:<diagnostic-code>`
- Node tests: `node-test:<command-id>:<test-name>`
- DIP: `dip:<message>`
- Quality/package boundary: `quality:<log-hash>`
- Generic command failures: `command:<command-id>:<log-hash>`

Future parsers may add more kinds, but should preserve these existing signatures.

## AutonomyState

An autonomy state contains:

- `readiness`: `green`, `repair-ready`, `blocked`, or `needs-evidence`.
- `decision`: The underlying dev-loop decision.
- `nextAction`: The next concrete action for an agent.
- `nextIssueSignature`: The issue to repair first, when available.
- `requiredFailures` and `optionalFailures`: Failed command IDs split by blocking semantics.
- `handoffMarkdown`: The rendered handoff content written to `handoff.md`.
