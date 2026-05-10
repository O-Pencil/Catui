# extensions/ — Built-in Extensions Module

> P2 | Parent: ../AGENT.md

---

## Overview

The `extensions/` module contains built-in extensions that extend nanoPencil's capabilities. Extensions can register tools, slash commands, keybindings, and hook into agent lifecycle events.

**Extension Categories:**
- `defaults/`: Auto-loaded on startup (unless disabled)
- `optional/`: Opt-in via configuration or flags

---

## Member List

### Default Extensions (`extensions/defaults/`)

Auto-loaded extensions available to all users.

#### diagnostics/ — Extension-Owned Issue Reporting

**P3 Contract:**
`index.ts`: - [WHO]: Extension with diagnostic:event listener and /report-issue command
    - [FROM]: core/extensions/types, @pencil-agent/tui, diagnostics helpers
    - [HERE]: diagnostics extension entry

`diagnostic-buffer.ts`: Session-local diagnostic dedupe and prompt gating

`reporter.ts`: User-approved InsForge pencil_issue_events upload adapter

`redaction.ts`: Secret/path redaction and message normalization

`types.ts`: Diagnostic event/report schema and diagnostic:event channel name

**Design Principle:**
- Diagnostics policy, buffering, UI prompts, and reporting live in the extension layer.
- Core and producer extensions emit only structured observations through the extension event bus.

#### token-save/ — Default Token Savings

**P3 Contract:**
`index.ts`: - [WHO]: Extension with bash tool_result/user_bash filtering, savings tracking, and /tokensave command
    - [FROM]: core/extensions/types, core/bash-executor, token-save filters/tracking helpers
    - [TO]: Auto-loaded by builtin-extensions.ts
    - [HERE]: token-save extension entry

`filters.ts`: Command classification and pure output filters for git, file reads, search, TS/test, JSON, and generic output

`config.ts`: Trusted user/project filter loader; user filters load from `~/.pencils/token-save/filters.json`, project filters require `.nanopencil/token-save/trust.json`

`lexer.ts`: Quote-aware shell segment splitter for compound command and pipe planning

`rewrite.ts`: Central TokenSave rewrite registry that maps high-noise commands to internal TokenSave execution plans

`runner.ts`: Capture/stream/passthrough contract that combines rewrite decisions, filters, raw recovery, and token accounting

`stream.ts`: Bounded stream accumulator used by stream-mode runner paths to cap raw capture without changing process exit semantics

`recovery.ts`: Raw output recovery writer for filtered command output

`toml-dsl.ts`: Configuration-driven filter pipeline with strip/replace/match/keep/truncate/head/tail/max-lines stages

`tracking.ts`: Session-local token savings aggregate and JSONL history persistence under `.nanopencil/token-save/`

**Design Principle:**
- Token savings must not change command execution semantics.
- Execution planning happens before bash, while filtering occurs after bash completes; raw output recovery is written for filtered results, and small/no-op savings fall back to raw output.

#### interview/ — Requirement Clarification

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /interview command, interview tool, lightweight before_agent_start hook
    - [FROM]: core/extensions/types, core/session/session-manager
    - [HERE]: interview extension entry

**Design Principle (CRITICAL):**
- `before_agent_start` hook MUST be synchronous and fast (<10ms)
- NO LLM calls (runProbe) in before_agent_start - they cause unpredictable delays
- NO UI interactions (confirm dialogs) in before_agent_start - they cause race conditions
- If interview might be beneficial, return a lightweight hint and let the Agent decide whether to call the interview tool

**Features:**
- `/interview` command: Force interactive clarification
- `interview` tool: Agent-triggered clarification via tool_call
- `before_agent_start` hook: Lightweight synchronous check only

#### grub/ — Autonomous Iterative Task Runner

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /grub command, GRUB_MESSAGE_TYPE renderer, before_agent_start/context/input/agent_end hooks
    - [FROM]: core/extensions/types, @pencil-agent/tui
    - [HERE]: grub extension entry

`grub-controller.ts`: GrubController - state machine for autonomous iterations, LoopTaskState management

`grub-parser.ts`: Grub command parsing, parseGrubCommand/buildGrubHelp

`grub-types.ts`: Grub-specific type definitions (GrubStatus/GrubDecisionStatus/GrubDecision/GrubTaskState)

`README.md`: Usage documentation for autonomous "keep digging until done" runner

#### loop/ — Recurring Prompt Scheduler

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /loop command, LOOP_MESSAGE_TYPE renderer, session-scoped recurring scheduler with pause/resume/run-now/max-runs/quiet
    - [FROM]: core/extensions/types, @pencil-agent/tui
    - [HERE]: loop extension entry

`scheduler-controller.ts`: SchedulerController - in-memory recurring task store with pause/resume/run-now, MAX_SCHEDULED_TASKS=50

`scheduler-parser.ts`: Loop command parsing with flags/subcommands, parseSchedulerCommand/parseDurationSpec/buildSchedulerHelp

`scheduler-types.ts`: Scheduled loop types, LoopPayloadKind/ScheduledLoopTask/LoopStartSpec/ParsedSchedulerCommand

`README.md`: Usage documentation for recurring scheduler

#### link-world/ — Internet Access

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface
    - [FROM]: core/extensions/types
    - [HERE]: link-world entry

`linkworld.ts`: Main link-world logic

`internet-search/`: Internet search capability

#### mcp/ — MCP Protocol Integration

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface for MCP
    - [FROM]: core/extensions/types
    - [HERE]: MCP extension entry

`mcp-management.md`: MCP configuration and usage guide

`figma-design.md`: Figma-specific MCP documentation

#### security-audit/ — Security Vulnerability Detection

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface
    - [FROM]: core/extensions/types
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
    - [FROM]: core/extensions/types, soul-core
    - [HERE]: soul extension entry

**Note**: Core implementation in `packages/soul-core/`

#### team/ — Multi-Agent Orchestration

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface for team
    - [FROM]: core/extensions/types
    - [HERE]: team extension entry

`team-controller.ts`: Multi-agent coordination logic

`team-parser.ts`: Team command parsing

`team-types.ts`: Team-specific types

### Optional Extensions (`extensions/optional/`)

Extensions that must be explicitly enabled.

#### simplify/ — Simplification Extension

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface
    - [FROM]: core/extensions/types
    - [HERE]: simplify extension entry

#### export-html/ — HTML Export Extension

**P3 Contract:**
`index.ts`: - [WHO]: Extension interface
    - [FROM]: core/extensions/types
    - [HERE]: export extension entry

---

## Extension Structure Pattern

```typescript
// Standard extension pattern
import type { Extension, ExtensionContext } from '../../core/extensions/types';

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
