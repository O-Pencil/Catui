# AGENTS.md

> P1 | Root Project Charter & Navigation Map

This file provides guidance for **@o-pencil-agent** tooling and contributors when working in this repository.

---

## Project Overview

**nanoPencil** (formerly nano-pencil) is a terminal-native AI coding agent with persistent memory and evolving AI personality. Built with TypeScript, it provides an interactive TUI for conversational coding with multi-model support (Anthropic, OpenAI, Gemini, Alibaba DashScope/Token Plan, Ollama).

**Core Pillars:**
- Terminal First - No Electron, no browser, pure terminal
- Privacy First - Local storage, no telemetry
- Extensible - Plugin system for tools, themes, and behaviors
- Fast - Sub-second startup, instant response

**Dependencies** (`@pencil-agent/*` packages):
- `@pencil-agent/agent-core` - Core Agent logic
- `@pencil-agent/ai` - Model APIs and types
- `@pencil-agent/tui` - Terminal UI components

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

| Metric | Limit |
|--------|-------|
| Single file lines | ~800 max (split or justify exceptions) |
| Single directory files | ~8 max (split into subdirectories if exceeded) |
| Core orientation | Branches that can be deleted beat branches that can be written correctly |
| Document isomorphism | Breaking document isomorphism equals introducing unverifiable technical debt |

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
|  cli.ts -> main.ts -> Mode Selection (interactive/print/rpc) |
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
nanoPencil/
├── AGENTS.md              # THIS FILE - P1 navigation map
├── .PENCIL.md             # Product personality charter
│
├── cli.ts                 # CLI entry point
├── main.ts                # Main CLI handler
├── config.ts              # Config discovery & loading
├── index.ts               # Package exports
│
├── core/                  # Core functionality
│   ├── runtime/           # Agent runtime & SDK
│   ├── extensions/        # Extension system
│   ├── tools/             # Built-in tools
│   ├── mcp/               # MCP protocol integration
│   ├── session/           # Session management
│   ├── model/             # Model management
│   ├── config/            # Configuration
│   ├── prompt/            # Prompt engineering
│   ├── export-html/       # HTML export
│   └── utils/             # Utilities
│
├── modes/                 # Run modes
│   ├── interactive/       # TUI mode
│   ├── print/             # Print mode
│   ├── rpc/               # RPC mode
│   └── acp/               # ACP mode
│
├── extensions/            # Built-in extensions
│   ├── defaults/          # Auto-loaded extensions
│   └── optional/          # Opt-in extensions
│
├── packages/              # Bundled npm packages
│   ├── agent-core/        # Core Agent logic
│   ├── ai/                # Model APIs & providers
│   ├── tui/               # Terminal UI components
│   ├── mem-core/          # Persistent memory system
│   └── soul-core/         # AI personality engine
│
├── utils/                 # Shared utilities
├── cli/                   # CLI helpers
├── scripts/               # Build scripts
└── docs/                  # Documentation
```

---

## Build & Run Commands

```bash
# Install dependencies
npm install

# Bundle local packages (mem-core, soul-core)
node scripts/bundle-deps.js

# Build (TypeScript compile + resource copy)
npm run build

# Development (direct execution)
npx tsx cli.ts [args...]

# Production
node dist/cli.js [args...]

# Alternative
npm start -- [args...]
```

---

## Key Abstractions

### AgentSession (`core/runtime/agent-session.ts`)

Central session lifecycle manager shared across all modes:
- Wraps core `Agent` from `@pencil-agent/agent-core`
- Manages session persistence via SessionManager
- Handles model switching, thinking level changes
- Manages tool execution and bash commands
- Coordinates compaction (context window management)
- Emits events for extensions to hook into

### SDK (`core/runtime/sdk.ts`)

Programmatic usage factory for embedding nanoPencil:
```typescript
const { session } = await createAgentSession(options);
```

### Three Run Modes

| Mode | File | Use Case |
|------|------|----------|
| Interactive | `modes/interactive/interactive-mode.ts` | TUI interface |
| Print | `modes/print/print-mode.ts` | stdout/stdin streaming |
| RPC | `modes/rpc/rpc-mode.ts` | IDE integration |

---

## Key Subsystems

### Extension System (`core/extensions/`)

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

### Built-in Extensions (`extensions/defaults/`)

| Extension | Purpose |
|-----------|---------|
| `interview` | Requirement clarification through guided Q&A |
| `loop` | `/loop` session-scoped scheduled prompts |
| `link-world` | Internet access via agent-reach |
| `browser` | Direct browser automation via vendored Browser Harness CDP bridge |
| `mcp` | MCP protocol support |
| `security-audit` | Security vulnerability detection |
| `soul` | AI personality evolution and memory |
| `token-save` | Default-on bash output filtering, token savings tracking, and `/tokensave` stats |

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

- Persists conversation history to `.nanopencil/session/*.jsonl`
- Handles session forking, branching, switching
- Session migration between versions

### Compaction (`core/session/compaction/`)

| File | Purpose |
|------|---------|
| `compaction.ts` | Main compaction logic for context window management |
| `branch-summarization.ts` | Branch summary generation for forked sessions |
| `compaction-coordinator.ts` | Coordinates compaction operations |
| `utils.ts` | Token estimation helpers |

---

## Configuration Paths

| Path | Purpose |
|------|---------|
| `~/.pencils/agents/` | Global config root |
| `~/.pencils/agents/<id>/models.json` | Model definitions |
| `~/.pencils/agents/<id>/auth.json` | API keys & OAuth |
| `~/.pencils/agents/<id>/settings.json` | User preferences |
| `~/.pencils/agents/<id>/sessions/` | Conversation history |
| `~/.pencils/agents/<id>/extensions/` | User extensions |
| `NANOPENCIL_CODING_AGENT_DIR` | Override config root |

---

## Slash Commands

Built-in commands (`core/slash-commands.ts`):

| Command | Purpose |
|---------|---------|
| `/model` | Select model |
| `/agent-loop` | Select high-intelligence or low-intelligence loop adaptation for the current session |
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
       └─ [prepublishOnly hook] build:release (build only, no changelog)
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
- [ ] Verify published version: `npm view @pencil-agent/nano-pencil version`

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
- [P2: modes/](./modes/AGENT.md) - Interactive, print, RPC modes
- [P2: extensions/](./extensions/AGENT.md) - Built-in extensions
- [P2: packages/](./packages/AGENT.md) - Bundled npm packages

### Related Documentation

- [.PENCIL.md](./.PENCIL.md) - Product personality charter
- [packages/mem-core/AGENT.md](./packages/mem-core/AGENT.md) - Memory system
- [docs/](./docs/) - Documentation directory

---

**Covenant**: Maintain map-terrain isomorphism. Keep this file aligned with actual structure, or the structure will drift.
