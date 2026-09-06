# Harness Foundation Gates

## Behavioral Gates

- [x] Built-in eval scenarios invoke `agentLoop` or `structuredAdaptiveAgentLoop` and do
  not return `observed: structuredClone(recorded)`.
- [x] Scenario-specific assertions fail the case before trace replay can pass invalid
  scripted behavior.
- [x] Directory and file symlink escape attempts are rejected before write/edit.
- [x] Approved Bash runtime tools contain the same base tool names as the default runtime.
- [x] Trace redaction preserves ordinary cron/path fields and masks credentials recursively.
- [x] Trace persistence keeps at most the configured number of run files plus `latest`.
- [x] Concurrent trace writers serialize `latest` and retention updates within and across processes.
- [x] Streamed tools remain paired and counted when error/abort replaces the partial assistant message.
- [x] Critical harness subsystem tests run from one required npm command.

Executed evidence on 2026-08-25:

- `npm run test:harness-critical`: 193/193 subsystem tests passed; 16/16 executable
  scenarios passed with zero replay divergences, policy violations, or unpaired calls.
- Agent-core trace regression: both loop implementations close failed recovery turns
  and emit the applied recovery transition; structured streaming also pairs tools when
  provider error or abort replaces the partial assistant message.
- `npm test`: the complete default repository chain passed and invoked the critical
  harness gate after release-build verification.

## Repository Gates

| Gate | Result | Evidence |
|---|---|---|
| `npm run verify:dip` | pass | 3194/3194 P3 headers; 130 P2 modules |
| `npm run verify:quality` | pass | 700 TypeScript files scanned |
| `npm run verify:package-boundary` | pass | static checks |
| `npm run build` | pass | 675 files built/minified; internal packages compiled |
| `npx tsc --noEmit` | pass | zero diagnostics |
| `npm run verify:package-boundary:dist` | pass | static and built-dist checks |
| `git diff --check` | pass | no whitespace errors |

The first DIP run found the user's untracked `web/server/index-test.ts` without a P3
contract. Only its P3 header and the existing `web/AGENT.md` member row were added;
the rerun passed. The first build also found strict type errors in the new fixture and
two existing Web changes. Generic fixture types were erased only at the heterogeneous
tool collection boundary; Web mode narrowing and `ImageContent[]` protocol typing were
fixed without changing behavior. Build and standalone typecheck then passed.

## Review Checklist

- No new published protocol type.
- No extension business rule moved into core.
- P3 headers and P2 member lists remain aligned.
- Existing user Web/PawBench/trusted-skill changes remain intact.

## Manual Review

- Public API: root `index.ts` and public subpath export files are unchanged. The
  approval identity addition is internal to the private `@catui/agent-core` workspace
  package and does not change `catui-protocol`.
- Token/performance: no LLM call, prompt, provider, or network path was added. Runtime
  cost is bounded local trace events, retention pruning, and filesystem path checks on
  writes.
- UX: the approval-enabled tool registry and denial-before-spawn path are covered by
  `test:tools`; no TUI rendering behavior changed.
- Dirty worktree: Web, PawBench, trusted-skill, lockfile, and existing trace changes
  were preserved. The Web-only edits made here are limited to build/DIP correctness.
