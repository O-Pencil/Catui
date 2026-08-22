# extensions/ — Built-in Extensions Module

> P2 | Parent: ../AGENT.md

---

## Overview

The `extensions/` module contains built-in extensions that extend Catui's capabilities. Extensions can register tools, slash commands, keybindings, and hook into agent lifecycle events.

**Extension Categories:**
- `builtin/`: first-party extension source; default-enabled entries are auto-loaded on startup
- `optional/`: high-trust/extra source. Most entries are opt-in via configuration or flags; entries explicitly marked `defaultEnabled` in `builtInExtensions` are product-approved default loads.

---

## Member List

### Built-in Extension Source (`extensions/builtin/`)

First-party extension source. Default-enabled entries are auto-loaded by `getBuiltinExtensionPaths()`; entries marked optional in `builtInExtensions` require explicit configuration/CLI opt-in even if their source directory is still here. Benchmark/CI harnesses may opt into Browser Harness registration with `CATUI_ENABLE_BROWSER_EXTENSION=1` without changing user config.

Current default extension directories:
`btw/`, `debug/`, `diagnostics/`, `discipline/`, `grub/`, `idle-think/`, `link-world/`, `loop/`, `mcp/`, `plan/`, `presence/`, `recap/`, `sal/`, `security-audit/`, `soul/`, `subagent/`, `team/`.

Current opt-in source still physically under `extensions/builtin/` pending Q2 physical/package decision:
`browser/`.

The complete file-level member list for defaults lives in `extensions/builtin/AGENT.md`; this parent map records category boundaries and high-level responsibilities.

#### discipline/ — Engineering Workflow Skills

**P3 Contract:**
`index.ts`: - [WHO]: Extension with `skill` tool, resources_discover registration for built-in workflow skills, and lightweight before_agent_start bootstrap
    - [FROM]: core/extensions-host/types, node path/url/fs
    - [HERE]: discipline extension entry

`skills/`: Default skills for requirement clarification (interview), domain modeling and design principles (domain-modeling), cross-session context transfer (handoff), feedback-loop-driven debugging (systematic-debugging), vertical-slice TDD (test-driven-development), plan writing (writing-plans) and execution (executing-plans), code review (requesting-code-review, receiving-code-review), worktree isolation (using-git-worktrees), and branch finishing (finishing-development-branch)

**Design Principle:**
- Engineering discipline is delivered as default skills plus a short prompt reminder, not hard-coded core behavior.
- Project and user skills remain able to override default skill names through existing resource precedence.

#### diagnostics/ — Extension-Owned Issue Reporting

**P3 Contract:**
`index.ts`: - [WHO]: Extension with diagnostic:event listener and /report-issue command
    - [FROM]: core/extensions-host/types, @catui/tui, diagnostics helpers
    - [HERE]: diagnostics extension entry

`diagnostic-buffer.ts`: Session-local diagnostic dedupe and prompt gating

`reporter.ts`: User-approved InsForge catui_issue_events upload adapter

`redaction.ts`: Secret/path redaction and message normalization

`types.ts`: Diagnostic event/report schema and diagnostic:event channel name

**Design Principle:**
- Diagnostics policy, buffering, UI prompts, and reporting live in the extension layer.
- Core and producer extensions emit only structured observations through the extension event bus.

#### teach/ — Guided Knowledge Teaching

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /teach command, teach tool, teach renderer
    - [FROM]: core/extensions-host/types, teach-runtime.ts, teach-format.ts, teach-i18n.ts
    - [HERE]: teach extension entry

`teach-runtime.ts`: TeachRuntime - core teaching state machine, mission discovery, learning style selection, progressive teaching, progress tracking

`teach-prompts.ts`: Prompt templates for each teaching level (hook, L1, L2, L3, bridge, takeaways)

`teach-format.ts`: Output formatting utilities for teach results

`teach-types.ts`: TypeScript type definitions for teach extension

`teach-i18n.ts`: Internationalization (en/zh) for teach extension

`teach-persistence.ts`: Learning record and mission persistence to .catui/teach/

`references/`: Curated analogies, teaching templates, learning paths, source verification rules

**Design Principle:**
- Progressive teaching: Hook → Level 1 → Level 2 → Level 3 → Bridge → Takeaways
- Source verification: Every factual claim must have a verifiable source with confidence level
- Learner level detection: Adapts to L0-L3 levels automatically
- Session memory: Tracks glossary, depth, coverage, and questions

**Features:**
- `/teach` command: Start guided learning on any topic
- `teach` tool: Agent-triggered teaching with start/respond/status actions
- Teach renderer: Custom message display for teach content
- Learning record persistence: Saves progress to .catui/teach/records/
- Mission persistence: Saves learning goals to .catui/teach/missions/
- Source verification: Integrated source citation with confidence levels

#### grub/ — Autonomous Iterative Task Runner

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /grub command, GRUB_MESSAGE_TYPE renderer, before_agent_start/context/input/agent_end hooks
    - [FROM]: core/extensions-host/types, @catui/tui
    - [HERE]: grub extension entry

`grub-controller.ts`: GrubController - state machine for autonomous iterations, durable GrubTaskState management, feature-list baseline validation

`grub-decision.ts`: Grub assistant protocol parser for validated loop-state decisions

`grub-parser.ts`: Grub command parsing, parseGrubCommand/buildGrubHelp

`grub-prompts.ts`: Grub prompt construction boundary for system prompts and per-task dispatch prompts

`grub-harness.ts`: Grub harness artifact boundary for `.grub/<id>/` files

`grub-format.ts`: Grub user-facing status/result formatter for readable TUI messages

`grub-turn.ts`: Grub turn-end coordinator for parsing assistant output, enforcing checklist gates, and returning user-facing update events

`grub-i18n.ts`: Grub localization helper for prompts and TUI messages

`grub-feature-list.ts`: Structured feature-list.json IO and passes/evidence-only diff validation

`grub-persistence.ts`: Cross-session .grub/<id>/state.json persistence and stale harness cleanup

`grub-types.ts`: Grub-specific type definitions (GrubStatus/GrubDecisionStatus/GrubDecision/GrubTaskState/FeatureList)

`README.md`: Usage documentation for autonomous "keep digging until done" runner

#### loop/ — Recurring Prompt Scheduler

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /loop command, LOOP_MESSAGE_TYPE renderer, session-scoped recurring scheduler with pause/resume/run-now/max-runs/quiet
    - [FROM]: core/extensions-host/types, @catui/tui
    - [HERE]: loop extension entry

`scheduler-controller.ts`: SchedulerController - in-memory recurring task store with pause/resume/run-now, MAX_SCHEDULED_TASKS=50

`scheduler-parser.ts`: Loop command parsing with flags/subcommands, parseSchedulerCommand/parseDurationSpec/buildSchedulerHelp

`scheduler-types.ts`: Scheduled loop types, LoopPayloadKind/ScheduledLoopTask/LoopStartSpec/ParsedSchedulerCommand

`cron/`: Unified cron scheduler (modeled on CC) — durable task store at `<agentDir>/cron/scheduled_tasks.json` with one-shot migration from the legacy `<project>/.claude/scheduled_tasks.json` layout
  `cron-tasks.ts`: CronTask type + add/read/write/remove + getCronFilePath() under `<agentDir>/cron/scheduled_tasks.json`
  `cron-tasks-lock.ts`: Scheduler lease lock at `<agentDir>/cron/scheduled_tasks.lock` (O_EXCL atomic create, PID liveness probe, stale recovery)
  `cron-scheduler.ts`: Non-React scheduler core; chokidar watcher on the cron file, 1s tick loop, jitter, missed-task detection
  `cron-parser.ts`: 5-field cron expression parser and next-fire-time computation
  `index.ts`: barrel for the cron sub-package

`cron-tools/`: CronCreate / CronDelete / CronList tool implementations + prompt builders (model-facing tool descriptions updated to reference the agent-dir layout)

`README.md`: Usage documentation for recurring scheduler

#### link-world/ — Internet Access

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface
    - [FROM]: core/extensions-host/types
    - [HERE]: link-world entry

`index.ts`: Main link-world logic; registers `link_world_admin`, `link_world_exec`, optional `web_search`/`web_fetch`, `/link-world`, and resource discovery

`internet-search/`: Internet search skill resource

#### mcp/ — MCP Protocol Integration

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface for MCP
    - [FROM]: core/extensions-host/types
    - [HERE]: MCP extension entry

`mcp-management.md`: MCP configuration and usage guide

`figma-design.md`: Figma-specific MCP documentation

#### security-audit/ — Security Vulnerability Detection

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface
    - [FROM]: core/extensions-host/types
    - [HERE]: security extension entry

`interface.ts`: Security audit interface definitions

`engine/`: Detection engine components
`engine/detector.ts`: Vulnerability detection logic, including trusted skill-directory install safeguards
`engine/interceptor.ts`: Request/response interception
`engine/logger.ts`: Security event logging

`README.md`: Security audit documentation

#### soul/ — AI Personality Evolution

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface
    - [FROM]: core/extensions-host/types, soul-core
    - [HERE]: soul extension entry

**Note**: Core implementation in `packages/soul-core/`

#### team/ — Multi-Agent Orchestration

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface for team
    - [FROM]: core/extensions-host/types
    - [HERE]: team extension entry

`team-runtime.ts`: Teammate registry, queues, lifecycle, persistence, mailbox, permissions, and sub-agent execution

`team-orchestrator.ts`: Leader planning, mention parsing, utterance formatting, and handoff execution

`team-parser.ts`: Team command parsing

`team-types.ts`: Team-specific types

`team-*store.ts`, `team-mailbox.ts`, `team-permissions.ts`, `team-dashboard.ts`, `team-harness.ts`, `team-presets.ts`, `team-psyche.ts`, `team-transcript.ts`: Durable collaboration support modules

### Optional Extensions (`extensions/optional/`)

High-trust or extra extension source. Most optional entries require explicit extension configuration or CLI paths. `evolution/` is the current exception: it remains physically under `extensions/optional/` but is product-approved for default loading through `getBuiltinExtensionPaths()`.

#### evolution/ — Controlled Self-Evolution

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /refine command, automatic activation, evolution_refine, evolved_tool, evolved_executable_tool, before_agent_start prompt injection, and turn_end observation
    - [FROM]: core/extensions-host/types and local evolution helpers
    - [HERE]: evolution extension entry

`evolution-store.ts`: Scoped global/workspace/session candidate ledger, immutable revision store, current pointer, active eval fixture pointer, prediction manifests, post-hoc attribution records, conservative auto-rollback, validation, bounded global auto-promotion, quarantine, and rollback

`evolution-fixture.ts`: Non-executable trace path discovery/resolution and `eval_fixture` content construction from validated workspace run trace JSONL

`evolution-refiner.ts`: LLM proposal prompt, prediction normalization, and JSON normalization for untrusted model output

`evolution-refine-tool.ts`: Model-callable non-executable artifact creation; session/workspace auto-promotion; low-risk global prompt_note/memory and bounded tool_spec auto-promotion; single-trace and bounded trace-sweep eval_fixture proposal

`evolution-gate.ts`: Deterministic harness eval gate using project JSON corpora, active evolved eval_fixture artifacts, or built-in fixtures; preserves stream summaries on gate reports

`evolution-tool.ts`: Promoted declarative tool_spec reuse through evolved_tool; validates declared inputs and returns structured non-executable plans without executing generated code

`evolution-auto.ts`: Deterministic `turn_end` auto-observer that turns explicit reusable lessons and structured `catui_evolution` JSON proposals into automatically activated artifacts with scope gates

`evolution-format.ts`: Human-readable status/inspection/result text, prediction/attribution summaries, and prompt append formatting

`evolution-types.ts`: Local evolution contracts for artifacts, predictions, attributions, stream-aware gate reports, candidates, revisions, current pointers, active fixture pointers, and quarantines; kept out of protocol until external consumers exist

**Design Principle:**
- Self-evolution is extension-owned default behavior, not core runtime behavior.
- Default loading is idle by default: no model calls, prompt injection, or evolution ledger writes occur until a user/model action creates artifacts; valid low-risk artifacts activate automatically.
- Generated artifacts are untrusted data. Prompt notes, memories, bounded tool specs, and eval fixtures can evolve under deterministic gates; tool specs may define input contracts and ordered reuse steps, but executable code, package installs, endpoints, permission changes, and runtime tool creation remain approval-gated or rejected.
- Candidate predictions are falsifiable decision-observability records copied onto promoted revisions; post-hoc attribution records compare later gate metrics with prediction targets without mutating immutable revision manifests.
- Conservative auto-rollback can move `current.json` from the current falsified revision to its predecessor; it never deletes revisions, never rolls back non-current revisions, and does nothing when no predecessor exists.
- Active eval fixtures are bounded by pointer: newest fixtures stay active, older fixtures are archived without deleting immutable revisions.

#### simplify/ — Simplification Extension

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface
    - [FROM]: core/extensions-host/types
    - [HERE]: simplify extension entry

#### export-html/ — HTML Export Extension

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface
    - [FROM]: core/extensions-host/types
    - [HERE]: export extension entry

---

## Extension Structure Pattern

```typescript
// Standard extension pattern
import type { Extension, ExtensionContext } from '../../core/extensions-host/types';

export default function createExtension(): Extension {
  return {
    name: 'extension-name',
    version: '1.0.0',
    
    async onLoad(context: ExtensionContext) {
      // Register tools, commands, keybindings
      context.registerTool({ ... });
      context.registerSlashCommand({ ... });
      context.registerKeybinding({ ... });
    },
    
    // Lifecycle hooks
    async onSessionStart(session) { },
    async onBeforeAgentStart(ctx) { },
    async onToolCall(tool, input) { },
    async onAfterAgentEnd(response) { },
  };
}
```

---

## Extension Lifecycle Hooks

| Hook | Timing | Purpose |
|------|--------|---------|
| `onLoad` | Extension loaded | Initialize resources |
| `onSessionStart` | New session begins | Session-specific setup |
| `onBeforeAgentStart` | Before AI call | Modify context/prompts |
| `onToolCall` | Tool invoked | Log/modify tool calls |
| `onToolExecutionStart` | Tool starts | Track execution |
| `onToolExecutionEnd` | Tool completes | Record results |
| `onAfterAgentEnd` | AI response ready | Post-process |
| `onSessionShutdown` | Session ends | Cleanup |

---

## Built-in Tools Provided by Extensions

| Extension | Tool | Description |
|-----------|------|-------------|
| mcp | `mcp_*` | MCP server tools |
| security-audit | `security_audit` | Vulnerability scanning |
| interview | `interview_*` | Requirement gathering |
| link-world | `fetch` | HTTP requests |

---

## Quality Rules

- Each extension must have `index.ts` as entry point
- Extensions should be self-contained (no cross-extension dependencies)
- All user-facing strings in English
- Provide JSDoc for public APIs

---

**Covenant**: When modifying extensions/, update this P2 and verify parent P1 links.
