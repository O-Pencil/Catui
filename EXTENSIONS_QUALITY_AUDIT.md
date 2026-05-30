# nanoPencil Extensions Quality Audit

Date: 2026-05-26

Scope: `extensions/builtin/*`, `extensions/optional/*`, and the built-in extension registry in `builtin-extensions.ts`. The bundled `packages/mem-core` extension is noted as part of load order, but this audit focuses on extensions under `extensions/`.

## Remediation Status

Updated on 2026-05-26 after the first repair pass and structural follow-up:

- Fixed `presence` locale fallback, macOS realpath normalization, no-API fallback behavior, and slow/flaky timing tests.
- Stopped default-loading `extensions/optional/*`; `simplify` and `export-html` now require explicit opt-in.
- Hardened `simplify` git/test execution to use argument arrays instead of shell strings and added workspace path guards.
- Unified `security-audit` tool gating through `DangerDetector` and switched audit cwd logging to extension context cwd.
- Added direct smoke/hardening tests for lightly covered extensions (`btw`, `debug`, `idle-think`, `recap`, `export-html`, `simplify`) and SAL listener cleanup.
- Added explicit `builtInExtensions` metadata (`defaultEnabled`, `riskLevel`, lifecycle and write/process flags) plus registry policy tests.
- Restored the missing `core/export-html/template.html` runtime asset and added a real export smoke test that writes and decodes standalone HTML output.
- Fixed unresolved timeout handles in fast `btw` and Smart `recap` completions; behavior tests now prove these commands return without waiting for their 30s timeout fallback.
- Added lifecycle coverage for `idle-think` enabled/disabled startup and `session_shutdown` interval cleanup.
- Added behavior coverage for debug credential redaction, `recap` budget-blocked calls, `discipline` skill discovery/prompt injection, and `export-html` custom tool HTML pre-rendering.
- Split AgentTeam UI/rendering/observer helpers from `team/index.ts` into `team-ui.ts`, reducing the entry file from ~1035 lines to 707 lines while preserving focused team tests.
- Split `presence` memory/path/language highlight logic into `presence-memory.ts`, reducing `presence/index.ts` from ~932 lines to 752 lines while preserving focused presence tests.
- Split `interview/index.ts` into an entry module plus `interview-runtime.ts`, reducing the entry file from ~1125 lines to 422 lines while keeping the probe/grill/runtime heuristics in a focused boundary.
- Split `team/team-runtime.ts` by moving prompt construction, harness turn prep, live-event projection, tool selection, path guards, and label helpers into `team-runtime-helpers.ts`; `team-runtime.ts` is now 799 lines.
- Split `sal/index.ts` into `sal-config.ts`, `sal-context.ts`, `sal-runtime.ts`, and `sal-trace.ts`; the entry file is now 799 lines and delegates configuration, context formatting, runtime contracts, and tool_trace analytics.
- Split `idle-think` lifecycle/state handling into `idle-think-runtime.ts`, added diagnostics for failed background exploration, and covered daily budget reset, abort cleanup, insight persistence, and failed-exploration diagnostics.
- Scoped `/debug` full-diagnostic system prompt injection to the pending command-generated prompt and added cleanup coverage proving old/manual `[DEBUG:]` prompts do not keep diagnostic privileges after `agent_end`.
- Added `recap` renderer accounting coverage proving Free recaps suppress token/cost badges while Smart recaps render input/output/cost and extract only text content parts.
- Added `export-html` branch-navigation snapshot coverage against the standalone template's tree/path functions, including active-path ordering and newest-leaf navigation from a fork point.
- Added metadata-level test contracts for lifecycle, external-process, resource-discovery, and write-guard risks, plus resource-discovery contract tests for browser, link-world, MCP, and discipline.
- Fixed a `loop` scheduler start/shutdown race where async enablement could create an interval after `session_shutdown`, and added a lifecycle test proving all created intervals are cleared.
- Added a structural boundary test keeping the split `sal/index.ts` and `team-runtime.ts` files at or below the 800-line guideline.
- Fixed `presence` memory locale detection to include the mem-core `preferences` store rather than only `knowledge`/`lessons`, and aligned the locale fixture with the `MemoryEntry` storage contract.
- Fixed mem-core archive cooldown logic to evaluate `revivedAt` and age against the explicit archive run timestamp instead of the wall clock, making archive maintenance deterministic.
- Fixed related test fragility in SAL batch ordering, Grub persisted-state fixture shape, and TUI viewport cursor movement.

Post-fix verification:

- `npx tsc -p tsconfig.build.json --noEmit`: pass.
- `npm run verify:dip`: pass, `418/418` files with valid P3 headers.
- Node test suite, excluding Vitest-style files: `246/246` pass.
- Vitest-style tests: `48` pass, `43` skipped.
- `packages/mem-core/test/extension-commands.test.ts`: pass.
- `npm run build`: pass.
- Latest structural follow-up focused tests: interview `9/9` pass, team `28/28` pass, SAL `18/18` pass, idle-think focused `19/19` pass, plus TypeScript and DIP gates pass.

## Executive Summary

Overall quality moved from uneven to release-candidate for the audited extension risks. The extension system has strong local contracts, good DIP hygiene, and several mature modules (`token-save`, `diagnostics`, `plan`, `grub`, `team`). The repair work resolved the operational blockers found in the audit: optional/default semantics, `presence` instability, `simplify` shell/write boundaries, duplicated `security-audit` detection, missing smoke tests for lightly covered extensions, and the three largest extension file-size violations.

Quality grade after repair: **B+ overall**.

Remaining risk is now concentrated in lifecycle-sensitive behavior rather than known file-size violations. The former large-file hotspots (`sal/index.ts`, `team-runtime.ts`, and `interview/index.ts`) have been split under DIP-visible module boundaries with focused regression tests, and `idle-think` now has direct runtime tests for budget and cleanup behavior.

Current evidence:

- `npm run verify:dip`: passed, `418/418` files with valid P3 headers and 30 P2 modules checked.
- `npx tsc -p tsconfig.build.json --noEmit`: passed.
- Node test suite excluding Vitest-style files: `246/246` passed.
- Vitest-style tests: `48` passed, `43` skipped.
- `packages/mem-core/test/extension-commands.test.ts`: passed.
- `npm run build`: passed.

## High-Priority Findings

### 1. Optional extensions are loaded by default

Status: **resolved**.

Original evidence:

- `builtin-extensions.ts:71-73` says optional extensions need explicit enablement.
- `builtin-extensions.ts:134-140` pushes `extensions/optional/simplify`.
- `builtin-extensions.ts:272-278` pushes `extensions/optional/export-html`.

Impact: "Optional" is only a directory label, not runtime behavior. This is highest risk for `simplify` because it can rewrite workspace files, run tests, and bind `ctrl+shift+s`.

Resolution:

- `getBuiltinExtensionPaths()` no longer returns `extensions/optional/*`.
- `test/browser-extension-registration.test.ts` now asserts optional extensions are not loaded by default.
- Optional extensions can still be loaded through explicit extension paths/configuration.

### 2. `presence` is not release-stable

Status: **resolved**.

Original evidence:

- `presence` starts timers at `extensions/builtin/presence/index.ts:799-801`.
- It resolves bundled packages through cwd-based candidates at `extensions/builtin/presence/index.ts:109-123`.
- It relies on memory-derived language detection at `extensions/builtin/presence/index.ts:230-240`.
- Test failure: `presence-locale: Chinese greeting when memory has Chinese preference` expected Chinese but got `Any ideas?`.
- Test failure: `presence-runtime: resolves bundled packages from dist/packages` fails on `/private/var/...` vs `/var/...`.

Impact: default-on UI behavior can be linguistically wrong, path-sensitive on macOS, and slow/flaky in test runs. Because it injects recent presence lines into the main system prompt at `extensions/builtin/presence/index.ts:851-875`, incorrect presence output can leak into actual agent behavior.

Resolution:

- Runtime bundled package entries are realpath-normalized.
- Explicit memory language preference now controls fallback locale instead of falling through to process locale.
- No-API-key runtime falls back immediately instead of waiting for a slow completion path.
- Presence tests use a short explicit test delay and polling wait, reducing runtime from ~70s to a few seconds.

### 3. `simplify` has unsafe write and shell boundaries

Status: **resolved**.

Original evidence:

- Shell string interpolation: `execSync(\`git diff HEAD -- "${file}"\`)` at `extensions/optional/simplify/index.ts:57-60`.
- Test command is selected and executed as a shell command at `extensions/optional/simplify/index.ts:123-130`.
- It writes model-generated content directly to workspace files at `extensions/optional/simplify/index.ts:445-451`.
- It registers `ctrl+shift+s` at `extensions/optional/simplify/index.ts:529-535`.
- No direct tests found for `simplify`.

Impact: filenames with quotes or shell metacharacters can break the command boundary. More importantly, default-loading a model-driven rewrite command increases accidental modification risk.

Resolution:

- Git and test execution now use `execFileSync` with argument arrays.
- Workspace path guards reject writes outside `ctx.cwd`.
- `simplify` is no longer default-loaded.
- `test/simplify-extension.test.ts` covers shell-metacharacter filenames, outside-workspace rejection, and test command detection.

### 4. Registry and P2 documentation drift

Status: **resolved for audited drift**.

Original evidence:

- `extensions/AGENT.md:21` describes default extensions but the detailed list starts with a subset and older contracts.
- `extensions/AGENT.md:120-129` still references `linkworld.ts`, but the current implementation is `link-world/index.ts`.
- `extensions/AGENT.md:167-170` references `team-controller.ts`, while the actual module has `team-runtime.ts`, `team-orchestrator.ts`, stores, mailbox, permissions, dashboard, and harness.
- The accurate list exists in `extensions/builtin/AGENT.md`, but the parent map is stale.

Impact: DIP verification passes structurally, but the human navigation map is partially stale. This weakens the intended P1/P2/P3 evidence chain.

Resolution:

- `extensions/AGENT.md` now lists current default extension directories.
- Stale `linkworld.ts` and `team-controller.ts` references were replaced with current `index.ts`, `team-runtime.ts`, and `team-orchestrator.ts` boundaries.
- `npm run verify:dip` passes after the documentation update.

### 5. `security-audit` has duplicated detection paths

Status: **resolved**.

Original evidence:

- `security-audit/index.ts:91-113` defines inline command detection.
- `security-audit/engine/detector.ts` defines `DangerDetector`, and `security-audit/engine/interceptor.ts` depends on it, but the extension entry does not use that interceptor path.
- Audit logs use `process.cwd()` at `security-audit/index.ts:181-185` and `security-audit/index.ts:216-220` instead of event/session cwd.

Impact: policy changes can be applied to the engine but not the active extension path. Logging cwd can be wrong in multi-workspace or embedded sessions.

Resolution:

- `security-audit/index.ts` now gates tool calls through `DangerDetector`.
- Audit events use `ctx.cwd` rather than `process.cwd()`.
- `test/security-audit.test.ts` now proves dangerous blocks, safe allows, sensitive write blocks, and warning patterns are logged without blocking.

## Per-Extension Assessment

| Extension | Grade | Evidence-based assessment | Main recommendation |
|---|---:|---|---|
| `diagnostics` | A- | Good bus boundary and dedupe; subscribes to canonical diagnostics at `diagnostics/index.ts:37-43`; covered by buffer/reporter/runtime tests. Silent auto-upload from `agent_end` is intentional but sensitive. | Document consent/config behavior clearly and keep uploads warning/error only. |
| `token-save` | A- | Strong pure helpers and recovery path; handles `tool_call`, `user_bash`, and `tool_result` at `token-save/index.ts:64-99`; broad direct tests pass. | Add failure-mode tests for bad user config regex and async config load race. |
| `plan` | A- | Cohesive permission model, validation, tools, and commands; direct tests pass. | Keep plan-file write boundaries exact; avoid expanding allowlist without tests. |
| `grub` | B+ | Durable state, feature-list gating, parser/controller tests pass; implementation is large but well decomposed. | Continue splitting entry orchestration from UI rendering as features grow. |
| `team` | B+ | Rich persistence, mailbox, permissions, worktree controls, and strong tests. `team/index.ts` is 707 lines after moving rendering/dashboard/observer helpers to `team-ui.ts`; `team-runtime.ts` is now 799 lines after helper extraction. | Keep runtime helper contracts covered when changing permission, tool selection, or teammate prompt behavior. |
| `sal` | B+ | Ambitious and mostly isolated; has eval adapter tests, DIP coverage command, listener cleanup coverage, and now explicit config/context/runtime/trace boundaries. `sal/index.ts` is 799 lines after extraction. | Keep eval lifecycle and zero-I/O hook behavior covered as SAL evolves. |
| `browser` | B | Good subprocess timeout/abort cleanup at `browser/index.ts:170-213`; resource discovery is explicit at `browser/index.ts:459-470`; registration tests pass. | Add tests for install/doctor failure formatting and workspace seeding. |
| `link-world` | B | Uses `execFile` for agent-reach execution at `link-world/index.ts:165-177`; capability-gated tools at `link-world/index.ts:405-413`; registration tests pass. | Cache capability probing or make it async to avoid startup sync command cost. |
| `mcp` | B | Useful Figma setup workflow and resource discovery; command is long and provider-specific. Resource-discovery contract coverage now proves advertised skill paths exist. | Split Figma auth/setup into a dedicated helper module with tests. |
| `loop` | B | Cron tools and scheduler are useful; parser/scheduler structure is reasonable. Lifecycle coverage now proves session shutdown clears owned timers and guards the async start/shutdown race. | Make scheduler test output quieter and keep interval ownership covered when changing scheduling. |
| `subagent` | B | Parser covered; runner isolates write mode via worktree flow. | Add integration tests for apply/cancel paths and failure cleanup. |
| `recap` | A- | Small command and deterministic extractor; Free and Smart command paths are now covered, including usage emission, budget-blocked preflight, timeout cleanup, and renderer accounting for free versus smart usage badges. | Keep renderer tests aligned if recap content supports new non-text parts. |
| `debug` | A- | Good operational intent; collectors are separated; command/renderer registration, no-model quick diagnostic behavior, nested credential redaction, and full diagnostic pending-prompt cleanup are covered by tests. | Keep full-turn prompt injection scoped to command-generated prompts. |
| `interview` | B | Important behavior fixed: before-agent hook is lightweight, and `interview/index.ts` is now 422 lines after moving probe/grill/runtime heuristics to `interview-runtime.ts`. | Add more UI command-path tests if the interview renderer or schema surface changes. |
| `presence` | B+ | Default-on user-visible extension now has deterministic locale/path behavior, fast tests, and memory/language helpers isolated in `presence-memory.ts`; entry file is 752 lines. It remains a background/UI subsystem, so lifecycle changes need targeted tests. | Keep timer and language behavior covered whenever changing memory or i18n integration. |
| `idle-think` | B | Default-loaded but default-disabled; guards budget and idle state; tests prove disabled startup does not create timers, enabled startup clears its interval on shutdown, daily budget resets at the day boundary, active runs abort on cleanup, insights persist with curiosity updates, and failed exploration emits diagnostics instead of being silently swallowed. | Keep runtime tests updated when changing idle scheduling, budgets, or insight persistence. |
| `security-audit` | B | Active gate now uses `DangerDetector`, logs `ctx.cwd`, and has tests for dangerous/safe/warning/sensitive file paths. | Move config loading into the extension when user-facing policy configuration is introduced. |
| `btw` | B | Small command, low blast radius; command/renderer registration, no-argument validation, no-tool prompt constraint, response emission, and timeout cleanup are covered. | Add explicit slow-timeout notification test with fake timers if the test harness gains timer control. |
| `soul` | B | Thin compatibility shim; real implementation lives in `packages/soul-core`. | Keep it thin; audit `soul-core` separately. |
| `export-html` | A- | Useful command; now optional-only, ships the required HTML template asset, writes standalone HTML with decodable session data, pre-renders custom tool call/result HTML, and has branch-navigation snapshot coverage for active-path ordering and newest-leaf navigation. File still has cleanup opportunities around import grouping and export adapter boundaries. | Keep template navigation tests updated if sidebar filtering or deep-link semantics change. |
| `simplify` | C+ | Write-capable LLM refactor command is now optional-only, uses argument-array process execution, and rejects paths outside the workspace. | Add rollback/no-UI integration tests before considering broader promotion. |
| `discipline` | B+ | Passive default extension that discovers bundled engineering workflow skills and appends a bootstrap prompt only when its skills directory exists; metadata/path and direct resources_discover/before_agent_start behavior are covered. | Keep skill asset packaging covered by build/copy-assets checks. |

## Cross-Cutting Quality Themes

### What is working

- DIP hygiene is good at the mechanical level: P3 coverage passed for all checked files.
- Mature extensions increasingly use small pure helpers (`token-save`, `recap`, `plan`, `grub`, `team` parsers/stores).
- The extension event surface is capable enough to implement tools, slash commands, resources, renderers, and lifecycle hooks without modifying core for every feature.

### What is breaking

- Runtime category semantics are not encoded. A path under `optional/` can still be default-loaded.
- Default-on extensions can start timers, perform sync capability checks, or attach process hooks. These need stronger lifecycle contracts than ordinary command-only extensions.
- Some modules sit close to the local ~800 line guideline after the split work, so future feature growth should continue extracting lifecycle, rendering, and persistence boundaries early.
- Test coverage is concentrated around parsers and core helpers; command/UI/resource paths are thinner.

### Design direction

Use extension metadata as the invariant, not directory names or comments. The registry now declares these fields for built-in extensions:

- `defaultEnabled`: boolean
- `riskLevel`: `passive | command | tool | background | write-capable`
- `requiresUI`: boolean
- `startsTimers`: boolean
- `writesWorkspace`: boolean
- `externalProcess`: boolean
- `resourceDiscovery`: boolean
- `testContracts`: required lifecycle/process/resource/write coverage by risk level
- `testFiles`: concrete test files that carry those contracts

The current registry tests enforce the policy layer:

- default-on write-capable extensions require explicit approval;
- every `extensions/builtin/*` directory has metadata;
- every default-enabled default extension has a load path;
- optional extensions are metadata-visible but not default-loaded.
- background or timer-owning extensions declare lifecycle coverage and existing test files;
- external-process extensions declare process/failure-mode coverage and existing test files;
- resource-discovery extensions declare discovery coverage and return existing skill paths;
- write-capable extensions declare write-guard coverage;
- split large-file boundaries are kept under the 800-line guideline by tests.

## Remaining Structural Work

The repair pass closed the high-priority defects, the known large-file hotspots, and the listed follow-up coverage gaps. Remaining work is ongoing maintenance rather than an open blocker: keep new extension capabilities mapped to metadata contracts and extract new setup, lifecycle, or persistence behavior before `sal/index.ts` or `team-runtime.ts` approach the 800-line gate.

## Verification Log

Commands run from `/Users/cunyu666/Dev/nanoPencil`:

```bash
npm run verify:dip
npx tsc -p tsconfig.build.json --noEmit
npm run build
node --test --import tsx packages/mem-core/test/archive-maintenance.test.ts test/presence-locale.test.ts
node --test --import tsx packages/mem-core/test/extension-commands.test.ts
node --test --import tsx $(rg --files test packages/mem-core/test core/lib/agent-core/test | rg '\.test\.ts$' | rg -v 'core/lib/agent-core/test/(agent-loop|agent|e2e|bedrock-models)\.test\.ts|test/(settings-agent-loop|model-registry-agent-loop)\.test\.ts')
npx vitest run core/lib/agent-core/test/agent-loop.test.ts core/lib/agent-core/test/agent.test.ts core/lib/agent-core/test/e2e.test.ts core/lib/agent-core/test/bedrock-models.test.ts test/settings-agent-loop.test.ts test/model-registry-agent-loop.test.ts
```

Current final verification is recorded in the remediation status at the top of this report.
