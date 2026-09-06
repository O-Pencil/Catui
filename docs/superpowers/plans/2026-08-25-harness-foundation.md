# Harness Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Catui's required harness evidence execute real loops while closing the filesystem, tool-composition, trace-retention, and critical-test gaps that undermine autonomous reliability.

**Architecture:** Keep each repair at its current narrow owner. `core/harness-eval` runs scripted offline model streams through production loops; `core/tools` owns canonical write rejection; `core/runtime` owns default tool composition and trace storage policy; root scripts and CI own regression orchestration. No new published protocol or cross-extension workflow abstraction is introduced.

**Tech Stack:** TypeScript, Node.js test runner, Vitest package tests, TypeBox, agent-core EventStream, GitHub Actions.

---

### Task 1: Close Workspace Symlink Escapes

**Files:**
- Modify: `core/tools/write-guard.ts`
- Modify: `test/workspace-write-guard.test.ts`
- Modify: `core/tools/AGENT.md`

- [x] Make the guard asynchronous, retain the lexical prefix check, walk existing path components with `lstat`, and reject every symbolic link below the workspace root.
- [x] Add directory-link and file-link integration cases that call the real write tool and prove the outside targets stay unchanged.
- [x] Run `node --test --import tsx test/workspace-write-guard.test.ts` and expect all cases to pass.

### Task 2: Preserve Default Tools Under Bash Approval

**Files:**
- Modify: `core/runtime/default-tools.ts`
- Modify: `main.ts`
- Create: `test/default-runtime-tools.test.ts`
- Modify: `core/runtime/AGENT.md`

- [x] Extend `createDefaultRuntimeTools()` with an optional injected Bash approval client while keeping one authoritative default registry construction path.
- [x] Replace the one-entry CLI override with the complete configured default tool map.
- [x] Assert that normal and approval-enabled registries expose identical names and that dangerous Bash reaches the injected client before spawn.
- [x] Run the focused runtime-tool test and existing Bash approval tests.

### Task 3: Redact and Bound Workspace Traces

**Files:**
- Modify: `core/runtime/run-trace-jsonl.ts`
- Modify: `core/runtime/agent-session.ts`
- Modify: `test/run-trace-jsonl.test.ts`
- Modify: `core/runtime/AGENT.md`
- Modify: `docs/run-trace-and-replay.md`

- [x] Add a runtime trace redactor that recursively masks sensitive keys and common credential text without removing normal semantic tool arguments.
- [x] Inject the redactor into every `AgentSession` recorder.
- [x] Add configurable run-file retention with a conservative default and deterministic oldest-first pruning.
- [x] Serialize concurrent latest/retention writes within and across processes.
- [x] Cover nested and command-string secrets, ordinary benchmark fields, retention, symlink rejection, and concurrent writes with focused tests.

### Task 4: Execute Real Built-in Harness Scenarios

**Files:**
- Create: `core/harness-eval/agent-fixtures.ts`
- Modify: `core/harness-eval/scenarios.ts`
- Modify: `test/harness-eval.test.ts`
- Modify: `core/AGENT.md`
- Modify: `docs/run-trace-and-replay.md`

- [x] Build deterministic scripted assistant streams, mock models, real tools, and a shared runner that selects the production standard or weak-model-compatible loop.
- [x] Implement policy ordering, approval pause, livelock, tool exception pairing, steering, output recovery, context recovery, and safe-tool concurrency as executable scenarios.
- [x] Assert scenario-specific effects before returning the actual captured trace for semantic replay validation.
- [x] Keep the existing fail-closed replay-divergence regression and make scenario assertions fail before replay when executable behavior changes.
- [x] Run `npm run test:harness-eval` and `npm run eval:harness`.

### Task 5: Require Critical Harness Tests

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [x] Add one `test:harness-critical` command covering checkpoint, goal, grub, team, evolution, trace, and harness eval suites with their correct runners.
- [x] Add the command to default tests and CI without scanning `.worktrees`.
- [x] Run the command locally and record its result.

### Task 6: Close Documentation and Repository Gates

**Files:**
- Modify: `.dev-docs/architecture-review/harness-foundation-review/README.md`
- Modify: `.dev-docs/architecture-review/harness-foundation-review/gates.md`
- Modify: `.dev-docs/architecture-review/README.md`

- [x] Mark behavioral gates with executed evidence.
- [x] Run the five mandatory repository gates and report dirty-worktree failures separately from implementation failures.
- [x] Review `git diff` for accidental changes to the user's Web, PawBench, trusted-skill, lockfile, and trace work.
