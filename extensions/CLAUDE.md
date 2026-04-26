# extensions/ — Built-in Extensions Module

> P2 | Parent: ../CLAUDE.md

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
`index.ts`: - [WHO]: Extension with /grub command, locale-aware GRUB_MESSAGE_TYPE renderer, before_agent_start/context/input/agent_end hooks
    - [FROM]: core/extensions/types, @pencil-agent/tui
    - [HERE]: grub extension entry

`grub-controller.ts`: GrubController - state machine for autonomous iterations, localized prompt generation, GrubTaskState management

`grub-parser.ts`: Grub command parsing, parseGrubCommand/buildGrubHelp

`grub-i18n.ts`: Grub localization helper, English/Chinese strings and goal-language detection

`grub-types.ts`: Grub-specific type definitions (GrubStatus/GrubDecisionStatus/GrubDecision/GrubLocale/GrubTaskState)

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

#### btw/ — Quick Side Questions

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /btw command, BTW_MESSAGE_TYPE renderer
    - [FROM]: core/extensions/types, @pencil-agent/ai
    - [HERE]: btw extension entry

#### debug/ — System Diagnostics

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /debug command, before_agent_start hook (injects diagnostic system prompt), agent_end cleanup, dispatched via sendUserMessage for streaming output
    - [FROM]: core/extensions/types, @pencil-agent/tui, ./collectors
    - [HERE]: debug extension entry

`collectors.ts`: Diagnostic data collection, collectSystemInfo/collectModelInfo/collectSessionInfo/collectConfigInfo/collectGitInfo/collectAgentState, sanitizeForLLM, formatDiagnosticData

#### plan/ — Plan Mode for Read-only Planning

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /plan command, EnterPlanMode/ExitPlanMode tools, plan file management
    - [FROM]: core/extensions/types
    - [HERE]: plan extension entry

`plan-file-manager.ts`: PlanFileManager — plan file path management and I/O
`plan-permissions.ts`: shouldAllowToolCall() — tool call permission gating for plan mode
`plan-workflow-prompt.ts`: getPlanModeInstructions() — workflow prompt generation
`enter-plan-mode-tool.ts`: createEnterPlanModeTool() — EnterPlanMode tool
`exit-plan-mode-tool.ts`: createExitPlanModeTool() — ExitPlanMode tool with plan validation
`plan-agents.ts`: Explore/Plan subagent definitions
`plan-validation.ts`: validatePlan() — validates plan has required sections
`teammate-approval.ts`: isInTeammateContext(), submitPlanToLeader() — teammate plan approval

#### presence/ — AI-driven Presence Lines

**P3 Contract:**
`index.ts`: - [WHO]: Extension with opening + idle presence lines, uses NanoMemEngine episodes/preferences/lessons + git/cwd snapshot
    - [FROM]: core/extensions/types, @pencil-agent/tui
    - [HERE]: presence extension entry

#### sal/ — Structural Anchor Learning

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /sal:coverage /sal:status /sal:setup commands, before_agent_start/tool_execution_start/agent_end hooks
    - [FROM]: core/extensions/types
    - [HERE]: sal extension entry

`terrain.ts`: TerrainSnapshot/TerrainNode/TerrainEdge model, buildTerrainIndex(), checkDipCoverage()
`anchors.ts`: StructuralAnchor/AnchorResolution model, locateTask(), locateAction()
`weights.ts`: SalWeights interface, SAL_DEFAULT_WEIGHTS, loadSalWeights()
`eval/`: Eval sink adapters — insforge/jsonl/noop

#### subagent/ — SubAgent Extension

**P3 Contract:**
`index.ts`: - [WHO]: Extension with /subagent: /subagent:run/:stop/:status/:report/:apply commands, SUBAGENT_MESSAGE_TYPE renderer
    - [FROM]: core/extensions/types, @pencil-agent/tui
    - [HERE]: subagent extension entry

`subagent-runner.ts`: SubAgent orchestration — research and implement roles
`subagent-parser.ts`: SubAgent command parsing
`subagent-types.ts`: SubAgentPhase, SubAgentRunState, SubAgentRunReport

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
