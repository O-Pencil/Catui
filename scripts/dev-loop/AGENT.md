# Dev Loop Scripts

> P2 | Repo-level development loop scripts for maintaining CATUI/nanoPencil with any coding agent.

## Responsibility

`scripts/dev-loop/` owns the agent-agnostic local and PR verification loop for this repository. It does not depend on CATUI runtime, modes, extensions, or tools. Its contract is shell-first: read the verification plan, run commands, parse failures, write artifacts, and stop with `continue`, `complete`, or `blocked`.

## Member List

- `types.ts`: Shared verification, issue, artifact, and watch-state contracts.
- `verification-plan.ts`: Loads `.dev-docs/vibe-coding/verification-plan.json` and prints it for agents.
- `bootstrap-length-probe.ts`: Read-only probe reporting the resolved built-in registry and the five default bootstrap prompt lengths, for prompt-budget evidence.
- `failure-parser.ts`: Parses verification logs into stable `IssueRecord` fingerprints and merges repeated evidence.
- `run-verification.ts`: Runs local verification commands and writes run artifacts.
- `github-provider.ts`: Reads this repository's PR checks through `gh` and converts failed checks to issue records.
- `handoff.ts`: Assesses autonomy readiness and writes handoff summaries for the next agent.
- `watch-state.ts`: Pure stop-condition logic for babysit/watch mode.
- `watch.ts`: CLI loop that repeats local verification and optional PR checks until green or blocked.

## Boundaries

MUST:

- Keep commands executable by Claude Code, Codex/Cursor, CATUI, or a plain shell.
- Keep artifacts under a caller-selected directory, defaulting to `.catui/dev-loop`.
- Keep parser/state helpers pure enough for focused tests.
- Use `gh` for GitHub reads and avoid remote mutation.
- Write resumable handoff artifacts before transferring work to another agent.
- Treat `required: false` verification commands as non-blocking evidence: failures still produce issue records, but only required command failures keep the run in `continue`.
- Keep parser priority specific-before-generic: TypeScript diagnostics, node-test failures, and DIP findings are emitted before the generic quality/package boundary fallback, even if a diagnostic line also contains boundary words.

MUST NOT:

- Import CATUI runtime/session/mode/extension internals.
- Commit, push, or change PR state.
- Treat partial verification as full repository green.
- Hide raw logs; compact logs must point back to raw recovery files.

## Validation

```bash
npm run test:dev-loop
npm run dev-loop:plan
npm run dev-loop:handoff -- --artifact-dir .catui/dev-loop/<run-id>
```
