# CATUI Repo Dev Loop

This directory defines the agent-agnostic development loop for maintaining CATUI/nanoPencil. CATUI is the target repository, not the assumed executing agent.

## Canonical Inputs

- `verification-plan.json` is the machine-readable definition of "green" for this repository.
- `protocol.md` describes how a coding agent should run local repair loops.
- `artifact-schema.md` describes files written under `.catui/dev-loop/<run-id>/`.
- `task-entry.md` describes the standard way an agent should start a new CATUI development task.

## Command Surface

```bash
npm run dev-loop:plan
npm run dev-loop:verify -- --only dev-loop-tests,dip
npm run dev-loop:parse -- .catui/dev-loop/<run-id>/raw/<command>.log
npm run dev-loop:pr -- <number>
npm run dev-loop:handoff -- --artifact-dir .catui/dev-loop/<run-id>
npm run dev-loop:watch -- --only dev-loop-tests --max-rounds 3
```

The commands are intentionally repository-level scripts. They can be used by Claude Code, Codex/Cursor, CATUI, or another agent with shell access.
