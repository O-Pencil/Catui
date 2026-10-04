# AGENTS.md

> P1 | Root Project Charter & Navigation Map

This file provides guidance for **@o-catui-agent** tooling and contributors when working in this repository.

---

## Project Overview

**Catui** (formerly catui-agent) is a terminal-native AI coding agent with persistent memory and selectable personas. Built with TypeScript, it provides an interactive TUI for conversational coding with multi-model support (Anthropic, OpenAI, Gemini, Alibaba DashScope/Token Plan, Ollama).

**Core Pillars:**
- Terminal First - No Electron, no browser, pure terminal
- Privacy First - Local storage, no telemetry
- Extensible - Plugin system for tools, themes, and behaviors
- Fast - Sub-second startup, instant response

**Dependencies** (published packages plus private `@catui/*` workspace libraries):
- `@catui/agent-core` - Core Agent logic
- `@catui/ai` - Model APIs and types
- `@catui/tui` - Terminal UI components
- `catui-protocol` - Public protocol contracts for extensions and published integrations
- `catui-mem` - Persistent memory package integration
- NanoSoul is suspended; `packages/soul-core` is retained standalone, outside the application build. Persona owns identity.

---

## FEATURE WORKFLOW (MANDATORY)

> **IMPORTANT — these instructions OVERRIDE default behavior. You MUST follow them.**

Before developing any **new feature / refactor / non-trivial change**, you **MUST** read and follow [`.dev-docs/feature-workflow.md`](.dev-docs/feature-workflow.md) (four-step loop + layer ownership + acceptance gates). Mandatory rules:

- **MUST** use the §2b layer-ownership decision tree to determine file placement. **Concept layer ≠ directory layer**: a feature has both a concept layer (cognition/tool/UI) and a directory home (packages/core/modes/extensions); the two are orthogonal, not 1:1. **New user-perceivable features go into `extensions/` by default**; do not stuff them into `core/` just because they are "cognitive capabilities."
- **MUST** follow the MUST / CAN / MUST-NOT constraints of each layer in §2b.
- **MUST** place types/protocols per the ladder in [`dev-conventions.md` §3b](.dev-docs/architecture-review/evolution/dev-conventions.md): types live in the **narrowest scope**; only cross-publish-boundary types (mem/soul/external) go into `catui-protocol`; consumers `extend` base contracts locally and **do not write back** to the protocol; discover existing types via the directory's DIP `AGENT.md` member list and **do not redefine**; **never pre-abstract** (let it emerge first).
- When §3 trigger conditions fire (load-bearing area / >400 lines / ≥8 ports / rewrite / public-API · deps · default-extension · CLI · TUI change / no clear owner) you **MUST** first create a `<topic>-review/` and complete that review before writing code.
- After completion you **MUST** run the §5 five acceptance gates (`verify:dip` / `verify:quality` / `verify:package-boundary` / `build` / `tsc --noEmit`) plus the §6 PR self-check and report results; changes go in via PR to main so CI enforces them again.

> **Warning:** **CI only enforces structural rules (cycles / DIP / boundaries / compilation); it cannot catch "wrong placement"** — stuffing an `extensions` feature into `core/` still passes CI. **Placement correctness is enforced by this rule, not by CI.**

Refactor outcomes, open issues, and outstanding items (P7/P8) live in [`REFACTOR-LEDGER.md`](.dev-docs/architecture-review/REFACTOR-LEDGER.md).

---

## Identity

Grounded in auditable engineering discipline: conclusions must be actionable, verifiable, and maintainable; reject vague or unverified assertions. Default to thorough reasoning and evidence chains; AI enhances delivery and decision quality, not a substitute for user judgment.

---

## Cognitive Architecture

**Phenomenon Layer**: Observable manifestations - error symptoms, logs, and reproduction paths

**Essence Layer**: Structural causality - root causes, coupling, violated invariants, and design principles

**Philosophy Layer**: Normative propositions - design principles and trade-offs that hold long-term

**Thinking Path**: Avoid slogan-style assertions.
**Output**: Design rationale (why the solution is superior under constraints) and reusable decision templates for the team.

---

## Cognitive Mission

**Progressive Sequence**:
1. **How to fix** (how to repair)
2. **Why it breaks** (why it fails)
3. **How to design it right** (how to design correctly under constraints)

**Goal**: Users not only eliminate defects but can articulate the failure mechanism and prevent similar issues proactively.

---

## Role Trinity

| Layer | Responsibility | Action |
|-------|---------------|--------|
| **Phenomenon** | Emergency response | Stanch bleeding, locate, provide minimal change set |
| **Essence** | Forensic analysis | Causal chains, dependency graphs, invariant checks |
| **Philosophy** | Standards review | Principle consistency, long-term costs, interface evolution strategy |

Single responses must complete the "evidence -> conclusion -> actionable next step" loop.

---

## Philosophy / Good Taste

**Principle**: Prefer eliminating special cases through structure rather than stacking conditional branches. Boundaries should be absorbed into normal models.

**Constraint**:
- Branch explosion is a design signal
- Continuously compress branches using data structures and invariants

**Anti-pattern**: Using conditional branches for edge cases instead of type systems

---

## Quality Metrics

| Metric | Limit | Enforced by |
|--------|-------|-------------|
| Single file lines | ~800 max (split or justify exceptions) | `verify:structure` |
| Single directory files | ~8 max (split into subdirectories if exceeded) | review; not yet gated |
| Core orientation | Branches that can be deleted beat branches that can be written correctly | review |
| Document isomorphism | Breaking document isomorphism equals introducing unverifiable technical debt | `verify:dip` |

### The structural ratchet

Two gates enforce the file-size and DIP invariants:
`verify:structure` (file size) and `verify:dip` (P1 extension table, P2 member
lists and doc coverage, P3 headers). Both fail on any violation **outside**
`.dev-docs/structure-baseline.json` and neither will rewrite that file to accept
new entries.

This matters more than the individual rules. A gate that reports but always exits
0 teaches the team that green means nothing, and a team that has learned that
stops reading. The baseline is the honest compromise: existing debt is recorded
instead of blocking, new debt fails the build.

- **Shrink it** by fixing entries. Once a violation stops being reported, its key
  stops matching and the entry becomes dead weight.
- **Grow it** only via `npm run verify:baseline:update`, which passes
  `--allow-grow` for the size gate. Treat that as a written decision, not a
  convenience — the commit message is the record.
- **Never** delete the baseline to reset the ratchet. The bootstrap path
  re-records current debt, it does not clear it.

A green `verify:dip` therefore means *"no new structural debt"*, not *"clean"*.
Read the baseline count in the output; it is the real number.

---

## Code Smells

| Smell | Description |
|-------|-------------|
| **Rigidity** | Small changes cause widespread ripple effects |
| **Redundancy** | Same decision rules repeated in multiple places |
| **Circular Dependencies** | Modules cannot establish directed acyclic dependency direction |
| **Fragility** | Unrelated areas fail due to local modifications |
| **Opacity** | Intent and invariants cannot be quickly read from code |
| **Data Clumps** | Data that always appears together should be aggregated into types or module boundaries |
| **Unnecessary Complexity** | Abstraction layers and concepts exceed problem requirements |
| **Premature Abstraction** | When recognizing above smells, ask whether to optimize and provide actionable improvement suggestions (with risk explanation) |

---

## Architecture Topology

```
|---------------------------------------------------------------|
|                    ENTRY POINTS                               |
|  cli.ts -> main.ts -> Mode Selection (interactive/print/rpc/acp/serve) |
|---------------------------------------------------------------|
                              |
                              v
|---------------------------------------------------------------|
|                    CORE LAYER                                 |
|  |-------------------|  |-------------------|  |-------------|
|  | AgentSession      |  | ModelRegistry    |  | SessionMgr  |
|  | - Runtime         |  | - Providers      |  | - Persist   |
|  | - Tools           |  | - Auth           |  | - Branching |
|  |-------------------|  |-------------------|  |-------------|
|  |-------------------|  |-------------------|  |-------------|
|  | Extensions        |  | MCP Manager       |  | SettingsMgr|
|  | - Loader          |  | - Client          |  | - Global+Loc|
|  | - Runner          |  | - Config          |  |             |
|  |-------------------|  |-------------------|  |-------------|
|  |-------------------|  |-------------------|  |-------------|
|  | SubAgent System   |  | Workspace         |  | Prompt      |
|  | - Agent Tool      |  | - Worktree Mgr    |  | - Builder   |
|  | - Registry        |  | - Git Isolation    |  | - Inject    |
|  |-------------------|  |-------------------|  |-------------|
|---------------------------------------------------------------|
                              |
                              v
|---------------------------------------------------------------|
|                    TOOL LAYER                                 |
|  bash | read | edit | write | grep | find | ls | source      |
|---------------------------------------------------------------|
                              |
                              v
|---------------------------------------------------------------|
|                    INTERFACE LAYER                            |
|  |-------------------|  |-------------------|  |-------------|
|  | Interactive       |  | Print             |  | RPC         |
|  | (TUI Mode)        |  | Mode              |  | (IDE Integ) |
|  |-------------------|  |-------------------|  |-------------|
|---------------------------------------------------------------|
```

---

## Directory Structure

```
Catui/
├── AGENTS.md              # THIS FILE - P1 navigation map
├── .CATUI.md             # Product personality charter
│
├── cli.ts                 # CLI entry point
├── main.ts                # Main CLI handler
├── config.ts              # Config discovery & loading
├── index.ts               # Stable root SDK exports
├── tools.ts               # Public ./tools subpath exports
├── runtime.ts             # Public ./runtime subpath exports
├── session.ts             # Public ./session subpath exports
├── session-compaction.ts  # Public ./session/compaction subpath exports
├── public-config.ts       # Public ./config subpath exports
├── models.ts              # Public ./models subpath exports
├── skills.ts              # Public ./skills subpath exports
│
├── core/                  # Core functionality
│   ├── runtime/           # Agent runtime & SDK
│   ├── lib/               # Private workspace libraries (ai, agent-core, tui)
│   ├── platform/          # Shared platform primitives
│   ├── extensions-host/   # Extension system host
│   ├── tools/             # Built-in tools
│   ├── mcp/               # MCP protocol integration
│   ├── session/           # Session management
│   ├── model/             # Model management
│   ├── prompt/            # Prompt engineering
│   ├── export-html/       # HTML export
│   ├── sub-agent/         # CC-style Agent tool, registry, worktree isolation
│   └── workspace/         # Workspace/worktree management
│
├── modes/                 # Run modes
│   ├── interactive/       # TUI mode
│   ├── print/             # Print mode
│   ├── rpc/               # RPC mode
│   ├── acp/               # ACP mode
│   └── remote/            # Remote serve mode (HTTP + WebSocket for mobile/browser clients)
│
├── apps/                  # Standalone applications (own toolchains, not npm workspaces)
│   └── mobile/            # Mobile web UI + Capacitor APK shell (Vite/React/Tailwind 4)
│
├── extensions/            # Built-in extensions
│   ├── builtin/           # First-party extension source (default-enabled entries auto-load)
│   └── optional/          # Opt-in extensions
│
├── packages/              # Bundled package-shaped integrations
│   ├── protocol/          # Stable public protocol contracts
│   ├── mem-core/          # Persistent memory system
│   └── soul-core/         # Suspended standalone source (not a root workspace)
│
├── utils/                 # Shared utilities
├── cli/                   # CLI helpers
├── scripts/               # Build scripts
├── llm-wiki/              # Verifiable LLM Wiki graph, Markdown pages, and generated site
└── docs/                  # Documentation
```

---

## Build & Run Commands

```bash
# Install dependencies
npm install

# Build (TypeScript compile + resource copy)
npm run build

# LLM Wiki (scan graph, update Markdown pages, verify isomorphism, render HTML)
npm run wiki:all

# Mobile web UI for serve mode (builds apps/mobile, copies bundle into modes/remote/public/)
npm run build:mobile-web

# Development (direct execution)
npx tsx cli.ts [args...]

# Remote serve mode (phone/browser control; prints QR + token)
npx tsx cli.ts --serve [--port 8787] [--host 0.0.0.0] [--tunnel]

# Production
node dist/cli.js [args...]

# Alternative
npm start -- [args...]
```

---

## Key Abstractions

### AgentSession (`core/runtime/agent-session.ts`)

Central session lifecycle manager shared across all modes:
- Wraps core `Agent` from `@catui/agent-core`
- Manages session persistence via SessionManager
- Handles model switching, thinking level changes
- Manages tool execution and bash commands
- Coordinates compaction (context window management)
- Emits events for extensions to hook into

### SDK (`core/runtime/sdk.ts`)

Programmatic usage factory for embedding Catui:
```typescript
const { session } = await createAgentSession(options);
```

### Run Modes

| Mode | File | Use Case |
|------|------|----------|
| Interactive | `modes/interactive/interactive-mode.ts` | TUI interface |
| Print | `modes/print/print-mode.ts` | stdout/stdin streaming |
| RPC | `modes/rpc/rpc-mode.ts` | IDE integration (JSON-lines over stdio) |
| ACP | `modes/acp/acp-mode.ts` | Agent Communication Protocol |
| Remote Serve | `modes/remote/remote-mode.ts` | Control Catui from phone/browser (`catui --serve`) |

---

## Key Subsystems

### Extension System (`core/extensions-host/`)

| File | Purpose |
|------|---------|
| `loader.ts` | Discovers extensions from npm packages, local paths |
| `runner.ts` | Manages extension lifecycle, event emission, tool wrapping |
| `wrapper.ts` | Wraps user tools with extension before/after hooks |
| `types.ts` | All extension-related TypeScript types |

Extensions can:
- Register custom tools, slash commands, keybindings
- Hook into agent events (before_agent_start, tool_call, context, etc.)
- Add UI components (dialogs, selectors, widgets)
- Modify prompts and context

### Extensions

`extensions/builtin/` loads by default. `extensions/optional/` loads on demand or when
explicitly enabled. Every directory under either tier has a row below. The `verify:dip`
P1 check fails in both directions: a directory with no row, and a row pointing at a
directory that no longer exists.

| Extension | Tier | Purpose |
|-----------|------|---------|
| `ask-user-question` | builtin | Structured ask-the-user prompts that route through a single shared slot |
| `browser` | builtin | Opt-in direct browser automation via vendored Browser Harness CDP bridge |
| `btw` | builtin | "By the way" interjections to surface tangential context without losing the main thread |
| `catail` | builtin | Research-to-publication Skill from framing through human-gated submission readiness |
| `catpaw` | builtin | Evidence-led UI/UX design craft workflow skill |
| `context-management` | builtin | Default budget hints, branch-history retrieval, working notes, and safe same-session context handoffs |
| `debug` | builtin | Runtime debugging helpers and diagnostics overlays |
| `diagnostics` | builtin | Self-diagnostic event capture + structured log surface |
| `discipline` | builtin | Built-in engineering workflow skills, `skill` tool, lightweight skill-use bootstrap. Also the home of the `interview` skill. |
| `goal` | builtin | `/goal` long-running autonomous goal pursuit (codex-goal lineage) |
| `grub` | builtin | `/grub` autonomous long-running task harness with feature-list validation |
| `humanizer` | builtin | Vendored writing-quality skill: removes AI-writing tells from prose without changing meaning or inventing facts |
| `idle-think` | builtin | Idle-turn "thinking" hooks — fills silent pauses with background reasoning |
| `insights` | builtin | Per-session / cross-session insights, dashboards, and HTML report export |
| `link-world` | builtin | Internet access via agent-reach |
| `loop` | builtin | `/loop` session-scoped scheduled prompts |
| `lsp` | builtin | Language-server integration for symbol / definition / refactor tools |
| `mcp` | builtin | MCP protocol support |
| `next-step` | builtin | Suggestion-of-next-step nudges after the agent settles |
| `notebook` | builtin | Notebook-edit tool wrapper |
| `plan` | builtin | `/plan` mode and plan-mode-aware command dispatch |
| `presence` | builtin | Persona / soul / memory presence rendering in the TUI footer and idle lines |
| `recap` | builtin | Session recap: summarize prior turns on session resume |
| `sal` | builtin | Structural Anchor Localization: experience-driven cognitive-map primitives that boost memory recall quality |
| `security-audit` | builtin | Security vulnerability detection |
| `skill-tool` | builtin | Direct `Skill` tool exposure for callers that need explicit invocation |
| `subagent` | builtin | CC-style Agent tool: spawn isolated sub-sessions with their own context |
| `task` | builtin | Task-list / todo management and progress display |
| `teach` | builtin | Structured teaching mode — walk a user through a topic step by step |
| `team` | builtin | Multi-agent team orchestration with shared scratchpad |
| `typesafe` | builtin | Default decision/tool/evaluation guidance and vendored TypeSafe integration skill |
| `evolution` | optional | Source evolution: independent review, verified repair, scheduled PR delivery. See below. |
| `export-html` | optional | Session export to standalone HTML |
| `session-bridge` | optional | `/bridge` — connect Codex to the current session; inactive until `/bridge start` |
| `simplify` | optional | Opt-in review pass that flags redundant code and unused surface |

### Tools (`core/tools/`)

| Tool | File | Purpose |
|------|------|---------|
| bash | `bash.ts` | Shell command execution |
| read | `read.ts` | File reading with truncation options |
| edit | `edit.ts` | File editing (line-based replacements) |
| write | `write.ts` | File writing (overwrite or create) |
| grep | `grep.ts` | Content search via ripgrep |
| find | `find.ts` | File pattern matching |
| ls | `ls.ts` | Directory listing |
| source | `source.ts` | Source code analysis |

### MCP Integration (`core/mcp/`)

| File | Purpose |
|------|---------|
| `mcp-client.ts` | MCP protocol client implementation |
| `mcp-config.ts` | MCP server configuration management |
| `mcp-adapter.ts` | MCP tools adapter |
| `mcp-guidance.ts` | MCP usage guidance |

### Session Management (`core/session/`)

- Persists conversation history to `.catui/session/*.jsonl`
- Handles session forking, branching, switching
- Session migration between versions

### Compaction (`core/session/compaction/`)

| File | Purpose |
|------|---------|
| `compaction.ts` | Main compaction logic for context window management |
| `branch-summarization.ts` | Branch summary generation for forked sessions |
| `utils.ts` | Token estimation helpers |

---

## Configuration Paths

| Path | Purpose |
|------|---------|
| `~/.catui/agents/` | Global config root |
| `~/.catui/agents/<id>/models.json` | Model definitions |
| `~/.catui/agents/<id>/auth.json` | API keys & OAuth |
| `~/.catui/agents/<id>/settings.json` | User preferences |
| `~/.catui/agents/<id>/sessions/` | Conversation history |
| `~/.catui/agents/<id>/extensions/` | User extensions |
| `CATUI_CODING_AGENT_DIR` | Override config root |

---

## Slash Commands

Built-in commands (`core/slash-commands.ts`):

| Command | Purpose |
|---------|---------|
| `/model` | Select model |
| `/agent-loop` | Select standard or weak-model-compatible loop adaptation for the current session |
| `/thinking` | Set thinking level |
| `/clear` | Clear conversation |
| `/fork` | Fork session |
| `/switch` | Switch session |
| `/tree` | Show session tree |
| `/compact` | Manual compaction |
| `/export` | Export to HTML |
| `/share` | Share session |
| `/login` | Configure API keys |
| `/settings` | Open settings |
| `/link-world` | Install internet access extension |
| `/grub` | Start/status/resume/stop an autonomous long-running task harness |
| `/bridge` | Connect Codex to the current session; guided setup, status and disconnect |

`session-bridge` is default-loaded from `extensions/optional/session-bridge/`;
the command stays inactive until `/bridge start`. First use offers bundled Codex
plugin installation; `/bridge setup` repairs setup. See its README for receipt
and lifecycle rules (the internal review notes are no longer in the repo).
The bridge exposes live command capabilities, owner snapshots for Grub/Goal/Plan,
asynchronous command receipts and delegated questions/standard plan approvals.
Only owner-enabled commands are remotely executable; elevation stays local.
Generic supervision lives in `core/extensions-host/supervision.ts`; feature state
and command behavior remain extension-owned.

Source evolution is configured separately with `catui evolve init --model provider/model --review-model provider/model`.
`catui evolve configure --review-model provider/model --scope adaptive` enables
independent review and bounded evolution of detection/repair methods.
`catui evolve start|stop|status|run|install-service|launch` manages the independent
usage observer, verified source repair, daily PR delivery, automatic merge/release,
and managed version adoption. Owner: `extensions/optional/evolution/source/`;
see its README for operating budgets, OS verification requirements and recovery.

---

## Code Standards

### Language Policy

**Source code and user-facing strings**: English only
- TypeScript comments
- Error messages
- TUI/CLI labels
- Embedded prompts

**Documentation**: English (end-user docs may be bilingual)

**Commit messages**: English, conventional format

### Tool Implementation Rules

- Use the Read tool instead of `cat` bash command
- Use the Edit tool for file modifications (not sed/awk)
- Use the Bash tool for terminal operations
- Never use `git add -A` - only add specific files you modified

---

## Commit Message Convention

```
<type>(<optional scope>): <short summary>

<optional body with more detail>
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `chore` | Build, tooling, dependencies, etc. |
| `style` | Formatting only (no behavior change) |

### Rules

- **No `Co-Authored-By:`**: Do not add any `Co-Authored-By:` trailer to commit messages
- Keep the subject line concise; use the body for bullets or context when needed

### Example

```
feat(interview): reduce interview trigger frequency

- Add shouldRunInterview heuristics
- Trigger only on vague or very short prompts
- Skip interview after persona switch
- Improve interview progress visibility
```

---

## Release Process

```bash
# 1. Ensure all changes committed and pushed
git status
git push

# 2. Run release (patch version bump + changelog + publish)
npm run release
```

### How `npm run release` works

```
npm run release
  ├─ npm version patch
  │    ├─ [version hook] generate CHANGELOG.md + git add
  │    ├─ npm auto-commits package.json + CHANGELOG.md + creates local git tag
  │    └─ [postversion hook] git push (tags kept local, GitHub rules block tag push)
  └─ npm publish
       ├─ [prepublishOnly hook] build:release (root build only; mobile has its own toolchain)
```

For non-patch releases, run `npm version` manually:

```bash
npm version minor && npm publish   # 1.13.2 -> 1.14.0
npm version major && npm publish   # 1.13.2 -> 2.0.0
```

### Changelog Generation

- Uses `scripts/generate-changelog.js`
- Triggered automatically by `version` lifecycle hook
- Based on git commit history since last tag, categorized by type
- Follows [Keep a Changelog](https://keepachangelog.com/)

### Release Checklist

- [ ] All changes committed and pushed (clean working tree required by `npm version`)
- [ ] `npm run release` successful
- [ ] Verify published version: `npm view catui-agent version`

---

## DIP Protocol (Dual-phase Isomorphic Documentation)

Code phase and Document phase must be structurally consistent and mutually verifiable.

**Map and terrain must be isomorphic**: Code changes must be traceable and verifiable in docs; vice versa.

### Progressive Disclosure

P3 headers serve as **context budget gatekeepers**:

| Without P3 | With P3 |
|------------|---------|
| Read entire file to understand relevance | Read 4 lines, decide instantly |
| O(n) per file | O(1) per file |
| Context explosion in large projects | Exponential context savings |

**The Rule**: After reading a P3 header, if the file is not relevant to your current task, **stop reading immediately**.

### The Four Questions (P3 Header)

| Field | Question | Example |
|-------|----------|---------|
| **WHO** | What does this file provide? | `Provides buildSystemPrompt(), BuildSystemPromptOptions` |
| **FROM** | What does this file depend on? | `Depends on config, skills, tools` |
| **TO** | Who uses this file? | `Consumed by agent runtime, SDK` |
| **HERE** | Where is this file? | `core/prompt/system-prompt.ts - prompt building` |

### P3 Template

```typescript
/**
 * [WHO]: Provides {exported functions/components/types/constants}
 * [FROM]: Depends on {module/package/file} for {specific capability}
 * [TO]: Consumed by {adjacent modules or downstream consumers}
 * [HERE]: {file path} within {module}; relationship with neighbors
 */
```

### Architecture Layers

| Layer | File | Content |
|-------|------|---------|
| **P1** | `AGENTS.md` (this file) | Global topology, stack overview, patterns |
| **P2** | `{module}/AGENT.md` | Member list, responsibilities, key parameters |
| **P3** | Each source file header | Individual file contracts |

### FORBIDDEN

#### Blocking Level (Must stop and fix document isomorphism first)

| Code | Description |
|------|-------------|
| FATAL-001 | Orphaned code change: modifies implementation without verifying/updating doc-side mapping |
| FATAL-002 | Skip P3: discovered missing P3 but continues stacking implementation |
| FATAL-003 | Delete file without updating P2: member list inconsistent with actual file set |
| FATAL-004 | New module without P2: module boundary invisible in docs |

#### High Priority (Must fix within this session)

| Code | Description |
|------|-------------|
| SEVERE-001 | P3 misaligned: header inconsistent with import/export/responsibility |
| SEVERE-002 | P2 missing items: source files not in member list |
| SEVERE-003 | P1 out of sync: global topology inconsistent with repository reality |
| SEVERE-004 | Parent links broken |

---

## DIP Navigation

### P1 - Root

- [P1: This File](./AGENTS.md)

### P2 - Module Maps

- [P2: core/](./core/AGENT.md) - Core functionality, runtime, tools
- [P2: core/sub-agent/](./core/sub-agent/AGENT.md) - CC-style Agent tool, registry, worktree isolation
- [P2: modes/](./modes/AGENT.md) - Interactive, print, RPC, ACP, remote serve modes
- [P2: apps/mobile/](./apps/mobile/AGENTS.md) - Mobile web UI + Capacitor APK shell
- [P2: extensions/](./extensions/AGENT.md) - Built-in extensions
- [P2: packages/](./packages/AGENT.md) - Bundled npm packages

### Related Documentation

- [Design principles](./docs/design-principles.md) - Current architecture decisions and provenance
- [README artwork](./assets/readme/AGENT.md) - Header asset and generation record

- [.CATUI.md](./.CATUI.md) - Product personality charter
- [packages/mem-core/AGENT.md](./packages/mem-core/AGENT.md) - Memory system
- [docs/](./docs/) - Documentation directory

---

**Covenant**: Maintain map-terrain isomorphism. Keep this file aligned with actual structure, or the structure will drift.
