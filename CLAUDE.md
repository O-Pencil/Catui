# CLAUDE.md

> P1 | Root Project Charter & Navigation Map

---

## Identity

Grounded in auditable engineering discipline: conclusions must be actionable, verifiable, and maintainable; reject vague or unverified assertions. Default to thorough reasoning and evidence chains; AI enhances delivery and decision quality, not a substitute for user judgment.

---

## Cognitive Architecture

**Phenomenon Layer**: Observable manifestations — error symptoms, logs, and reproduction paths

**Essence Layer**: Structural causality — root causes, coupling, violated invariants, and design principles

**Philosophy Layer**: Normative propositions — design principles and trade-offs that hold long-term

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

Single responses must complete the "evidence → conclusion → actionable next step"闭环.

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
| **Rigidity** | Small changes cause widespread牵连 |
| **Redundancy** | Same decision rules repeated in multiple places |
| **Circular Dependencies** | Modules cannot establish directed acyclic dependency direction |
| **Fragility** | Unrelated areas fail due to local modifications |
| **Opacity** | Intent and invariants cannot be quickly read from code |
| **Data Clumps** | Data that always appears together should be aggregated into types or module boundaries |
| **Unnecessary Complexity** | Abstraction layers and concepts exceed problem requirements |
| **Premature Abstraction** | When recognizing above smells, ask whether to optimize and provide actionable improvement suggestions (with risk explanation) |

---

## Architecture Documentation

**Trigger**: When creating/deleting/moving files or directories, adjusting module boundaries, or changing external interfaces, must record todos and responsible parties.

---

## DIP Dual-phase Isomorphic Documentation Protocol

(DIP: Dual-phase Isomorphic Documentation — Code phase and Document phase must be structurally consistent and mutually verifiable.)

**Map and terrain must be isomorphic**: Code changes must be traceable and verifiable in docs; vice versa. Either phase evolving alone = incomplete.

### Progressive Disclosure Benefit

P3 headers serve as **context budget gatekeepers**:

| Without P3 | With P3 |
|------------|---------|
| Read entire file to understand relevance | Read 4 lines, decide instantly |
| O(n) per file | O(1) per file |
| Context explosion in large projects | Exponential context savings |
| Hard to skip irrelevant files | Easy to filter with WHO/FROM/HERE |

**The Rule**: After reading a P3 header, if the file is not relevant to your current task, **stop reading immediately**. This is not skipping — it's precision.

**The Four Questions**:

| Field | Question | Example |
|-------|----------|---------|
| **WHO** | 这个文件提供了什么？ | `Provides buildSystemPrompt(), BuildSystemPromptOptions` |
| **FROM** | 这个文件依赖什么？ | `Depends on config, skills, tools` |
| **TO** | 谁会用到这个文件？ | `Consumed by agent runtime, SDK` |
| **HERE** | 这个文件在哪？ | `core/prompt/system-prompt.ts - prompt building` |

### Doctrine

You are the executor of DIP, bound by verifiable isomorphism constraints.

| Ontology | Description |
|----------|-------------|
| **Code Phase** | Executable entity, compiler/interpreter and tests as truth source |
| **Document Phase** | Readable entity, agent and maintainer can reconstruct navigation as truth source |
| **Isomorphism Requirement** | Structural or contract changes in either phase must leave corresponding updates in the other |

**Bidirectional Verification**:
- Docs must be verifiable against code directories and export points
- Code must be verifiable against module boundaries and responsibility descriptions in docs
- Task not considered closed until isomorphism holds

**Working Sentences**:
- When modifying code, assume docs are the acceptance party
- When writing docs, assume code is the acceptance party

---

## Architecture (Three-tier Fractal)

### P1 — Root (This File)
Global topology, stack overview, global patterns

### P2 — Module Maps
**File**: `{module}/CLAUDE.md`
**Content**: Member list (files, responsibilities, technical points, key parameters or invariants)
**Format**:
```
{file}.{ext}: {responsibility}, {technical points}, {key parameters or invariants}
```
**Rule**: Members complete, one item per line, parent links valid, precise terms first

### P3 — File Contracts
**File**: Each source file header
**Content**: Individual file contracts
**Format**:
```typescript
/**
 * [WHO]: Provides {exported functions/components/types/constants}
 * [FROM]: Depends on {module/package/file} for {specific capability}
 * [TO]: Consumed by {adjacent modules or downstream consumers}
 * [HERE]: {file path} within {module}; relationship with neighbors
 */
```

---

## P2 Template

```markdown
# {module}/

> P2 | Parent: {parent path}/CLAUDE.md

Member List
{file}.{ext}: {responsibility}, {technical points}, {key parameters or invariants}

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent CLAUDE.md
```

---

## P3 Template

```typescript
/**
 * [WHO]: Provides {exported functions/components/types/constants}
 * [FROM]: Depends on {module/package/file} for {specific capability}
 * [TO]: Consumed by {adjacent modules or downstream consumers}
 * [HERE]: {file path} within {module}; relationship with neighbors
 */
```

### Writing Effective P3 Headers (Progressive Disclosure Optimized)

**WHO** should enable instant relevance judgment:
- ❌ Bad: `Provides utility functions` (too vague)
- ✅ Good: `Provides buildSystemPrompt(), BuildSystemPromptOptions interface`
- ✅ Good: `Provides AgentSession, SessionManager, EventBus`

**HERE** should enable module boundary filtering:
- ❌ Bad: `in core/runtime` (just restates path)
- ✅ Good: `core/runtime/agent-session.ts - wraps Agent core; consumed by tools, extensions`
- Pattern: `{file} - {what it does}; {FROM deps}; {TO consumers}`

---

## Workflow

```
Before working in a directory
    ↓
Read CLAUDE.md at that level → load if exists; if not, mark for creation and minimally complete
    ↓
Read target file P3 header → understand contract if exists; if missing, complete P3 first before implementation
    ↓
Implement and test
    ↓
Verify document isomorphism
```

---

## FORBIDDEN

### Blocking Level (Must stop and fix document isomorphism first)

| Code | Description |
|------|-------------|
| FATAL-001 | Orphaned code change: modifies implementation without verifying/updating doc-side mapping |
| FATAL-002 | Skip P3: discovered missing P3 but continues stacking implementation |
| FATAL-003 | Delete file without updating P2: member list inconsistent with actual file set |
| FATAL-004 | New module without P2: module boundary invisible in docs |

### High Priority (Must fix within this session or same work unit)

| Code | Description |
|------|-------------|
| SEVERE-001 | P3 misaligned: header inconsistent with import/export/responsibility |
| SEVERE-002 | P2 missing items: source files or public entries not in member list |
| SEVERE-003 | P1 out of sync: global topology or stack inconsistent with repository reality |
| SEVERE-004 | Parent links broken |

### Verification

Run DIP compliance check before committing:

```bash
npx tsx scripts/verify-dip.ts
```

- **Exit 0**: All checks passed
- **Exit 1**: FATAL violations (must fix before commit)
- **Exit 2**: SEVERE violations (should fix)

---

## INVOCATION

Maintain P1/P2/P3 completeness and WORKFLOW closure; reject "only modify code, don't sync docs" delivery.

**Keep the map aligned with the terrain, or the terrain will be lost.**

---

## Project Overview

**nanoPencil** is a terminal-native AI coding agent with persistent memory and evolving AI personality. Built with TypeScript, it provides an interactive TUI for conversational coding with multi-model support (Anthropic, OpenAI, Gemini, Alibaba DashScope, Ollama).

**Core Pillars:**
- Terminal First — No Electron, no browser, pure terminal
- Privacy First — Local storage, no telemetry
- Extensible — Plugin system for tools, themes, and behaviors
- Fast — Sub-second startup, instant response

---

## Architecture Topology

```
|---------------------------------------------------------------┐
|                    ENTRY POINTS                            |
|  cli.ts → main.ts → Mode Selection (interactive/print/rpc) |
|--------------------------------------------------------------┘
                              |
                              ▼
|---------------------------------------------------------------┐
|                    CORE LAYER                              |
|  |---------------┐  |---------------┐  |-----------------------┐ |
|  | AgentSession|  | ModelRegistry|  | SessionManager      | |
|  | - Runtime   |  | - Providers |  | - Persistence       | |
|  | - Tools     |  | - Auth      |  | - Branching         | |
|  |--------------┘  |--------------┘  |----------------------┘ |
|  |---------------┐  |---------------┐  |-----------------------┐ |
|  | Extensions  |  | MCP Manager |  | SettingsManager    | |
|  | - Loader    |  | - Client    |  | - Global + Local   | |
|  | - Runner    |  | - Config    |  |                    | |
|  |--------------┘  |--------------┘  |----------------------┘ |
|--------------------------------------------------------------┘
                              |
                              ▼
|---------------------------------------------------------------┐
|                 TOOL LAYER                                 |
|  bash | read | edit | write | grep | find | ls | source |
|--------------------------------------------------------------┘
                              |
                              ▼
|---------------------------------------------------------------┐
|                 INTERFACE LAYER                             |
|  |---------------┐  |---------------┐  |-----------------------┐ |
|  | Interactive |  |   Print     |  |      RPC            | |
|  | (TUI Mode)  |  |   Mode      |  | (IDE Integration)   | |
|  |--------------┘  |--------------┘  |----------------------┘ |
|--------------------------------------------------------------┘
```

---

## Directory Structure

```
nanoPencil/
|---- CLAUDE.md              # THIS FILE - P1 navigation map
|---- AGENTS.md              # Claude Code specific guidance
|---- .PENCIL.md             # Product personality charter
|
|---- cli.ts                 # CLI entry point
|---- main.ts                # Main CLI handler
|---- config.ts              # Config discovery & loading
|---- index.ts               # Package exports
|
|---- core/                  # Core functionality (P2: core/)
|   |---- index.ts           # Core barrel exports
|   |---- runtime/            # Agent runtime & SDK
|   |   |---- agent-session.ts   # Central session manager
|   |   |---- sdk.ts             # Programmatic API factory
|   |   |--- event-bus.ts       # Event emission system
|   |---- extensions/         # Extension system
|   |   |---- loader.ts       # Extension discovery
|   |   |---- runner.ts       # Lifecycle management
|   |   |---- wrapper.ts      # Tool wrapping
|   |   |--- types.ts        # Extension types
|   |---- tools/              # Built-in tools
|   |   |---- index.ts        # Tool orchestrator
|   |   |---- bash.ts         # Shell execution
|   |   |---- read.ts         # File reading
|   |   |---- edit.ts         # Line-based edit
|   |   |---- write.ts        # File writing
|   |   |---- grep.ts         # Content search
|   |   |---- find.ts         # Pattern matching
|   |   |---- ls.ts           # Directory listing
|   |   |--- source.ts       # Code analysis
|   |---- mcp/                # MCP protocol integration
|   |---- session/            # Session management
|   |---- model/              # Model management
|   |---- config/             # Configuration
|   |---- prompt/             # Prompt engineering
|   |---- export-html/        # HTML export
|   |--- utils/              # Utilities
|
|---- modes/                  # Run modes (P2: modes/)
|   |---- interactive/        # TUI mode
|   |---- print/              # Print mode
|   |---- rpc/                # RPC mode
|   |--- acp/                # ACP mode
|
|---- extensions/             # Built-in extensions (P2: extensions/)
|   |---- defaults/           # Auto-loaded extensions
|   |   |---- interview/      # Requirement clarification
|   |   |---- loop/           # Timed prompt scheduler
|   |   |---- plan/           # Plan mode for read-only planning before coding
|   |   |---- link-world/     # Internet access
|   |   |---- mcp/            # MCP integration
|   |   |---- security-audit/ # Security detection
|   |   |---- soul/           # AI personality evolution
|   |   |--- team/           # Multi-agent orchestration
|   |--- optional/           # Opt-in extensions
|
|---- packages/               # Bundled packages (P2: packages/)
|   |---- agent-core/         # Core Agent logic
|   |---- ai/                 # Model APIs & providers
|   |---- tui/                # Terminal UI components
|   |---- mem-core/           # Persistent memory system
|   |--- soul-core/          # AI personality engine
|
|---- utils/                  # Shared utilities
|---- cli/                    # CLI helpers
|---- scripts/                # Build scripts
|--- docs/                   # Documentation
```

---

## Build & Run Commands

```bash
# Install dependencies
npm install

# Bundle local packages
node scripts/bundle-deps.js

# Build (TypeScript compile + resource copy)
# build:deps runs packages/ai before packages/agent-core so @pencil-agent/ai dist exists for tsc
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

### Extension System (`core/extensions/`)

Extensions receive `ExtensionContext` with:
- `cwd`, `agentDir` - Directories
- `sessionManager`, `settingsManager`, `modelRegistry` - Core services
- Tool, slash command, keybinding registration APIs

Extension lifecycle hooks:
- `session_start`, `session_shutdown`
- `before_agent_start`, `after_agent_end`
- `tool_call`, `tool_execution_start/end`
- `user_message`, `custom_message`

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

## Code Standards

### Language Policy

**Source code and user-facing strings**: English only
- TypeScript comments
- Error messages
- TUI/CLI labels
- Embedded prompts

**Documentation**: English (end-user docs may be bilingual)

**Commit messages**: English, conventional format

### Commit Convention

```
<type>(<scope>): <summary>

<optional body>
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `chore`, `style`

---

## DIP Navigation

### P1 — Root

- [P1: This File](./CLAUDE.md)

### P2 — Module Maps

- [P2: core/](./core/CLAUDE.md) — Core functionality, runtime, tools
- [P2: modes/](./modes/CLAUDE.md) — Interactive, print, RPC modes
- [P2: extensions/](./extensions/CLAUDE.md) — Built-in extensions
- [P2: packages/](./packages/CLAUDE.md) — Bundled npm packages

### P3 — File Contracts

**Status**: 🔄 In Progress — 275 TypeScript files have P3 headers; [TO] fields pending; P2 subdirectory docs in creation

Add P3 headers following this pattern:

```typescript
/**
 * [WHO]: Provides {exported functions/components/types/constants}
 * [FROM]: Depends on {module/package/file} for {specific capability}
 * [TO]: Consumed by {adjacent modules or downstream consumers}
 * [HERE]: {file path} within {module}; relationship with neighbors
 */
```

### Related Documentation

- [AGENTS.md](./AGENTS.md) — Claude Code specific guidance
- [.PENCIL.md](./.PENCIL.md) — Product personality charter
- [packages/mem-core/CLAUDE.md](./packages/mem-core/CLAUDE.md) — Memory system
- [docs/](./docs/) — Documentation directory

---

**Covenant**: Maintain map-terrain isomorphism. Keep the CLAUDE.md aligned with actual structure, or the structure will drift.
