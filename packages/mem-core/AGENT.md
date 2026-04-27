# AGENT.md

This file provides guidance for **@o-pencil-agent** tooling and contributors when working in this repository.

## Project Overview

NanoMem is a TypeScript-based persistent memory management system for AI assistants. It implements a sophisticated memory architecture with spaced repetition, intelligent eviction, privacy controls, and AI-powered memory extraction.

**Key characteristics:**
- Pure TypeScript ESM modules (no build step, requires Node.js 20+ with TypeScript execution via tsx or similar)
- JSON file-based persistence in `~/.nanomem/memory`
- Pluggable LLM integration - works with any LLM provider via a simple function signature
- Bilingual support (English/Chinese) for prompts and UI

## Running the Code

This project uses `.ts` imports and requires TypeScript execution:

```bash
# Run the CLI directly with tsx
npx tsx cli.ts stats
npx tsx cli.ts search "query"
npx tsx cli.ts insights

# Or use node with --loader
node --loader tsx cli.ts stats
```

## Environment Configuration

Configure via environment variables:

- `NANOMEM_TOKEN_BUDGET` - Total token budget for memory injection (default: 6000)
- `NANOMEM_MEMORY_DIR` - Directory for JSON storage (default: `~/.nanomem/memory`)
- `NANOMEM_LOCALE` - Language locale: `en` or `zh` (default: `en`)

## Architecture Overview

The codebase follows a clean layered architecture with clear module boundaries:

### Core Engine (`engine.ts`)
The `NanoMemEngine` class is the main API facade. It orchestrates all other modules and provides:
- Memory extraction and storage from conversations
- Episode management and consolidation
- Memory retrieval with budget-aware injection
- Statistics and insights generation

### Memory Storage (`store.ts`)
JSON-based persistence with automatic directory creation. Stores data in separate files:
- `knowledge.json` - Facts, entities, decisions
- `lessons.json` - Lessons learned
- `preferences.json` - User preferences
- `facets.json` - Patterns and struggles (behavioral insights)
- `work.json` - Work/task history
- `episodes/*.json` - Session summaries
- `meta.json` - Metadata (session count, last consolidation)

### Memory Types (`types.ts`)

**MemoryEntry** - Core memory types:
- `fact` - Technical knowledge, project structure, API details
- `lesson` - Mistakes, solutions, debugging insights
- `preference` - User style, naming, tool preferences
- `decision` - Architectural choices, design trade-offs
- `entity` - Named entities (people, services, etc.)
- `pattern` - Habitual user behaviors (with `facetData`)
- `struggle` - Failure experiences with resolution (with `facetData`)

**FacetData** - Structured data for behavioral insights:
```typescript
type FacetData =
  | { kind: "pattern"; trigger: string; behavior: string }
  | { kind: "struggle"; problem: string; attempts: string[]; solution: string }
```

**Episode** - Session summaries with metadata (files, tools, errors, observations)

**WorkEntry** - Task-oriented memories with goal and summary

### Key Algorithms

**Spaced Repetition** (`scoring.ts`, `engine.ts`):
- Memory `strength` grows with each successful recall (Ebbinghaus model)
- Growth factor configurable via `strengthGrowthFactor` (default: 1.5)
- Strength used in retrieval scoring

**Scoring System** (`scoring.ts`):
- Stanford-style retrieval scoring with three components:
  - `recency` - Based on `strength` (half-life decay)
  - `importance` - Explicit 1-10 rating
  - `relevance` - Tag overlap with context
- Weights configurable via `scoreWeights`

**Eviction** (`eviction.ts`):
- Utility-based eviction: combines access frequency and base impact
- Different half-life values per memory type (configurable)
- Enforces `maxEntries` limits per memory type

**Memory Linking** (`linking.ts`):
- A-MEM style relationship discovery between memories
- Uses tag overlap and semantic similarity
- Related memories shown in injection: `fact content [→ related; summaries]`

### Dual-Path Extraction (`extraction.ts`)

The system works with or without an LLM:
1. **LLM path**: Uses `LlmFn` to extract structured memories from conversations
2. **Heuristic fallback**: Pattern-based extraction when no LLM available

### Privacy & Scoping (`privacy.ts`)

- **PII filtering**: Basic PII redaction from memories
- **Scoping**: Multi-user support via `MemoryScope` (`userId`, `agentId`)
- **TTL**: Time-to-live based auto-eviction
- **Scope filtering**: All retrieval operations respect scope

### Consolidation (`consolidation.ts`)

- Batch processing of episode summaries into long-term memories
- Runs automatically on session start
- Marks episodes as `consolidated: true`

### Internationalization (`i18n.ts`)

All user-facing strings and LLM prompts support English and Chinese:
- Extraction prompts
- Injection section headers
- Memory behavior instructions
- Insights generation prompts

## Extension Integration (`extension.ts`)

The only module depending on `@pencil-agent/nano-pencil`. Bridges NanoPencil events to the engine:

**Lifecycle hooks:**
- `session_start` - Triggers consolidation
- `before_agent_start` - Injects memory into system prompt
- `tool_execution_start/end` - Tracks tool usage and observations
- `agent_end` - Extracts memories from conversation
- `session_shutdown` - Saves episode summary

The adapter also wraps the host `completeSimple` LLM function and reports a fallback diagnostic via `./diagnostics.ts` (the canonical bus shared with utils/diagnostics.ts through `Symbol.for`) when a JSON-required memory response is visibly non-JSON, without changing engine extraction or fallback behavior. `extraction.ts` and `consolidation.ts` route their LLM-failure fallbacks through the same helper, so deep-utility errors land in the diagnostics buffer for silent auto-upload.

**Registered commands:**
- `mem-search <query>` - Search memories
- `mem-stats` - Show statistics
- `mem-insights [path]` - Generate HTML report

## Configuration System (`config.ts`)

Comprehensive configuration via `getConfig(overrides)`:

```typescript
{
  memoryDir: string,           // Storage location
  tokenBudget: number,         // Total tokens for injection
  budget: {                    // Allocation ratios per memory type
    lessons: number,
    knowledge: number,
    episodes: number,
    preferences: number,
    work: number,
    facets: number
  },
  halfLife: Record<string, number>,  // Decay rates per type
  maxEntries: {...},           // Capacity limits per type
  consolidationThreshold: number,     // Episodes before consolidation
  scoreWeights: { recency, importance, relevance },
  evictionWeights: { accessFrequency, baseImpact },
  defaultScope?: MemoryScope,
  locale: "en" | "zh",
  strengthGrowthFactor: number
}
```

## Memory Injection Format

Generated memory injection follows this structure:

```markdown
## Long-term Memory

### Lessons Learned
- lesson content

### Knowledge Base
- fact content [→ related; summaries]

### Recent Sessions
- [date] project: summary (Goal: user goal)

### User Preferences
- preference content

### Work History
- [date] goal: summary

### Behavioral Patterns
- When trigger → behavior

### Past Struggles
- Problem: problem | Tried: attempt1, attempt2 | Solved: solution

---
IMPORTANT: These memories are your personal recollections...
(memory behavior instructions - natural memory usage)
```

## Important Patterns

### POS Comments
Each file has a `[POS]` comment explaining its position in the architecture. These describe the module's role and dependencies.

### LLM Function Type
```typescript
type LlmFn = (systemPrompt: string, userMessage: string) => Promise<string>;
```
Simple async function - host products provide their own LLM integration.

### Graceful Degradation
The system works without an LLM through heuristic extraction. LLM features fail silently and fall back to rules-based behavior.

### Bi-temporal Memory
- `created` - When the system recorded the memory
- `eventTime` - When the fact actually occurred (optional)

### Update Operations (`update.ts`)
Mem0-style updates: `add | update | delete | noop` based on content similarity and explicit retraction.

### Export/Import
Full data export available via `exportAll()` - returns all memories, episodes, and metadata.

## CLI Usage (`cli.ts`)

```bash
nanomem stats              # Show memory counts
nanomem search <query>     # Search memories
nanomem forget <id>        # Delete a memory
nanomem export             # Export all as JSON
nanomem insights [--output <path>]  # Generate HTML report
```

## Files Reference

- `index.ts` - Barrel export (public API surface)
- `engine.ts` - Main engine facade class (~2400 lines), orchestrates subsystems
- `engine-scoring-v2.ts` - V2 memory scoring and structural proximity computation
- `engine-injection-text.ts` - Injection text formatting and conversation preference detection
- `engine-v2-mapping.ts` - V2 type mapping and extraction-to-semantic conversion
- `engine-archive.ts` - Archive partitioning, merging, and staleness detection
- `engine-links.ts` - V2 link materialization, conflict detection, procedural chain building
- `engine-insights.ts` - Insights report generation (LLM + rules-based)
- `engine-episode-sync.ts` - Episode-to-V2 sync and mapping
- `engine-reinforce.ts` - Memory reinforcement and reconsolidation after recall
- `engine-recall-select.ts` - Recall entry selection and budget allocation for progressive recall
- `config.ts` - Configuration management
- `types.ts` - All type definitions
- `store.ts` - JSON persistence layer
- `extraction.ts` - Memory extraction (LLM + heuristic)
- `consolidation.ts` - Episode consolidation
- `scoring.ts` - Retrieval and ranking algorithms
- `privacy.ts` - PII filtering, scoping, TTL
- `linking.ts` - Memory relationship discovery
- `i18n.ts` - Internationalization (en/zh)
- `eviction.ts` - Memory eviction algorithms
- `update.ts` - Memory update operations
- `extension.ts` - NanoPencil extension adapter
- `insights-html.ts` - HTML report generation
- `cli.ts` - Standalone CLI tool
