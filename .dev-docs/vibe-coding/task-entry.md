# CATUI Vibe Coding Task Entry

Use this entry protocol when a coding agent starts work on the CATUI/nanoPencil repository. The executing agent may be Claude Code, Codex/Cursor, CATUI, or another shell-capable agent.

## Start

1. Read the root `AGENTS.md` and `.dev-docs/feature-workflow.md`.
2. Read the relevant P2 `AGENT.md` before touching a module.
3. Read this dev-loop command map:

```bash
npm run dev-loop:plan
```

4. Classify the task:

- `feature`: user-visible behavior, new workflow, CLI/TUI change, or default extension behavior.
- `bugfix`: failing command, regression, test failure, CI failure, or runtime defect.
- `refactor`: structure change with intended behavior preservation.
- `docs`: documentation-only change.

5. For feature/refactor work, apply the feature workflow owner decision before editing. New repo-development automation defaults to `.dev-docs/` plus `scripts/`, not CATUI runtime.

## Repair Loop

Run the smallest meaningful verification command before broad gates:

```bash
npm run dev-loop:verify -- --only <command-id> --run-id <run-id>
```

Read:

- `.catui/dev-loop/<run-id>/state.json`
- `.catui/dev-loop/<run-id>/issues.json`
- `.catui/dev-loop/<run-id>/compact/<command-id>.log`

Repair the current issue, rerun the same focused command, then widen to the relevant gates from `verification-plan.json`.

## Handoff

Before handing work to another agent or ending an incomplete repair session, write a handoff:

```bash
npm run dev-loop:handoff -- --artifact-dir .catui/dev-loop/<run-id>
```

The next agent should start with:

- `.catui/dev-loop/<run-id>/handoff.md`
- `.catui/dev-loop/<run-id>/autonomy-state.json`
- the current issue's `lastFailureLogRef`

## Stop Conditions

Stop as `complete` only when required verification is green and any relevant PR checks are green or not in scope.

Stop as `blocked` when:

- the same issue exhausts its attempt budget,
- credentials or permissions are missing,
- the user requirement is ambiguous,
- a failure is flaky or external,
- continuing would require commit/push/PR mutation not explicitly requested by the user.

## Safety

- Do not commit, push, force-push, or mutate PR state unless the user explicitly asks.
- Do not treat optional command failures as required blockers, but keep them as evidence.
- Do not claim full repository green from partial verification.
- Do not hide raw logs; compact summaries must point back to raw logs.
