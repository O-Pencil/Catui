# extensions/ — Built-in Extensions Module

> P2 | Parent: ../AGENT.md

---

## Overview

The `extensions/` module contains built-in extensions that extend Catui's capabilities. Extensions can register tools, slash commands, keybindings, and hook into agent lifecycle events.

**Extension Categories:**
- `builtin/`: first-party extension source; default-enabled entries are auto-loaded on startup
- `optional/`: opt-in via configuration or flags

---

## Member List

### Built-in Extension Source (`extensions/builtin/`)

First-party extension source. Default-enabled entries are auto-loaded by `getBuiltinExtensionPaths()`; entries marked optional in `builtInExtensions` require explicit configuration/CLI opt-in even if their source directory is still here.

Current default extension directories:
`btw/`, `debug/`, `diagnostics/`, `discipline/`, `grub/`, `idle-think/`, `link-world/`, `loop/`, `mcp/`, `plan/`, `presence/`, `recap/`, `sal/`, `security-audit/`, `soul/`, `subagent/`, `team/`, `token-save/`.

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

#### token-save/ — Default Token Savings

**P3 Contract:**
`index.ts`: - [WHO]: Extension with bash tool_result filtering, savings tracking, and /tokensave command
    - [FROM]: core/extensions-host/types, token-save filters/tracking helpers
    - [TO]: Auto-loaded by builtin-extensions.ts
    - [HERE]: token-save extension entry

`filters.ts`: Command classification and pure output filters for git, file reads, search, TS/test, JSON, and generic output

`config.ts`: Trusted user/project filter loader; user filters load from `~/.catui/token-save/filters.json`, project filters require `.catui/token-save/trust.json`

`lexer.ts`: Quote-aware shell segment splitter for compound command and pipe planning

`rewrite.ts`: Central TokenSave rewrite registry that maps high-noise commands to TokenSave capture/passthrough plans

`runner.ts`: Capture/passthrough contract that combines rewrite decisions, filters, raw recovery, and token accounting

`recovery.ts`: Raw output recovery writer for filtered command output

`toml-dsl.ts`: Configuration-driven filter pipeline with strip/replace/match/keep/truncate/head/tail/max-lines stages

`tracking.ts`: Session-local token savings aggregate and JSONL history persistence; history.jsonl lives under `~/.catui/token-save/projects/<projectKey>/` (keyed by sha1 of realpath, never inside the project tree)

`paths.ts`: projectKeyForPath() + dataDirForKey() + resolveTokenSavePaths() — single source of truth for the user-level runtime data dir; one-shot legacy migration from `<project>/.catui/token-save/` runs on first post-upgrade load

**Design Principle:**
- Token savings must not change command execution semantics.
- Execution planning happens before bash, while filtering occurs after bash completes; raw output recovery is written for filtered results, and small/no-op savings fall back to raw output.
- Runtime data (history, raw recovery) is kept out of the project tree; only user/project configuration files (filters.json, trust.json) may live under `<project>/.catui/token-save/`.

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
`engine/detector.ts`: Vulnerability detection logic
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

Extensions that must be explicitly enabled.

Optional extensions are not returned by `getBuiltinExtensionPaths()`; load them through explicit extension configuration or CLI extension paths.

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
