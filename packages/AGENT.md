# packages/ — Bundled Packages Module

> P2 | Parent: ../AGENT.md

---

## Overview

The `packages/` directory contains bundled npm packages that are compiled and included with nanoPencil. These packages provide modular, reusable functionality that can be updated independently.

**Package Manager:** npm workspaces
**Build System:** TypeScript + tsc + custom scripts

---

## Member List

### agent-core/ — Core Agent Logic

**P3 Contract (index.ts):**
`index.ts`: - [WHO]: Agent class, AgentConfig
    - [FROM]: agent-loop.ts, structured-adaptive-agent-loop.ts, agent.ts, proxy.ts
    - [HERE]: agent core barrel

**Files:**
`agent.ts`: Main agent class with message loop
`agent-loop.ts`: Agent execution loop and state machine
`structured-adaptive-agent-loop.ts`: weak-model-compatible loop implementation with scaffolded, stronger-control runs and aggregate tool-result budget enforcement
`structured-adaptive-tool-orchestration.ts`: weak-model-compatible tool batching/execution layer
`structured-adaptive-streaming-tool-executor.ts`: streaming tool scheduler for weak-model-compatible loop
`proxy.ts`: Agent proxy for session isolation
`types.ts`: Agent-related type definitions

**Test:** `test/` with vitest configurations

### ai/ — Model APIs and Providers

**P3 Contract (index.ts):**
`index.ts`: - [WHO]: AI SDK exports
    - [FROM]: providers/*
    - [HERE]: AI module barrel

**Files:**
`api-registry.ts`: API endpoint registry
`cli.ts`: AI CLI tool
`env-api-keys.ts`: Environment variable API key handling
`models.ts`: Base model types
`models.generated.ts`: Auto-generated model definitions
`stream.ts`: Streaming utilities
`types.ts`: Core AI types
`providers/`: Provider implementations
  - `anthropic.ts`: Anthropic API
  - `openai-responses.ts`: OpenAI Responses API
  - `openai-completions.ts`: OpenAI Completions API
  - `google.ts`: Google Gemini API
  - `google-vertex.ts`: Google Vertex AI
  - `google-gemini-cli.ts`: Gemini CLI integration
  - `amazon-bedrock.ts`: AWS Bedrock
  - `azure-openai-responses.ts`: Azure OpenAI
  - `github-copilot-headers.ts`: GitHub Copilot
  - `openai-codex-responses.ts`: OpenAI Codex
  - `register-builtins.ts`: Built-in provider registration
  - `transform-messages.ts`: Message format transformation
  - `simple-options.ts`: Simple API options
`utils/`: Shared utilities
  - `event-stream.ts`: SSE handling
  - `http-proxy.ts`: Proxy configuration
  - `json-parse.ts`: Streaming JSON parser
  - `oauth/`: OAuth implementations
    - `anthropic.ts`: Anthropic OAuth
    - `decode-credential.ts`: Safe base64 decode for embedded client id/secret (placeholder-safe at load)
    - `github-copilot.ts`: GitHub Copilot OAuth
    - `google-antigravity.ts`: Google OAuth
    - `google-gemini-cli.ts`: Gemini CLI OAuth
    - `openai-codex.ts`: Codex OAuth
    - `pkce.ts`: PKCE implementation
    - `types.ts`: OAuth types
  - `overflow.ts`: Context overflow handling
  - `sanitize-unicode.ts`: Unicode sanitization
  - `typebox-helpers.ts`: TypeBox utilities
  - `validation.ts`: Input validation

**Scripts:**
`scripts/generate-models.ts`: Model definition generator
`scripts/generate-test-image.ts`: Test image generator

### tui/ — Terminal UI Components

**P3 Contract (index.ts):**
`index.ts`: - [WHO]: TUI components and TUI class
    - [FROM]: components/*, tui.ts
    - [HERE]: terminal UI barrel

**Files:**
`tui.ts`: Main TUI orchestrator class
`terminal.ts`: Terminal detection and configuration
`editor-component.ts`: Text editor component
`editor.ts`: Editor logic
`input.ts`: Input handling
`autocomplete.ts`: Auto-completion engine
`fuzzy.ts`: Fuzzy matching
`keybindings.ts`: Keybinding definitions
`keys.ts`: Key code utilities
`kill-ring.ts`: Kill ring for yank
`stdin-buffer.ts`: Stdin buffering
`terminal-image.ts`: Terminal image rendering
`undo-stack.ts`: Undo/redo management
`utils.ts`: Shared utilities

**Components (`components/`):**
`box.ts`: Box/drawing primitive
`cancellable-loader.ts`: Interruptible loading
`image.ts`: Image component
`loader.ts`: Loading indicator
`markdown.ts`: Markdown renderer
`select-list.ts`: Selectable list
`settings-list.ts`: Settings list
`spacer.ts`: Spacer element
`text.ts`: Text component
`truncated-text.ts`: Smart truncation

### mem-core/ — Persistent Memory System

**P3 Contract (index.ts):**
`index.ts`: - [WHO]: NanoMemEngine, MemoryEntry types
    - [FROM]: engine.ts, store.ts, extraction.ts
    - [HERE]: memory barrel

**Files:**
`engine.ts`: Main NanoMemEngine facade class (orchestrates subsystems)
`engine-scoring-v2.ts`: V2 memory scoring and structural proximity
`engine-injection-text.ts`: Injection text formatting, conversation preference detection
`engine-v2-mapping.ts`: V2 type mapping and extraction-to-semantic conversion
`engine-archive.ts`: Archive partitioning, merging, staleness detection
`engine-links.ts`: V2 link materialization, conflict detection, procedural chains
`engine-insights.ts`: Insights report generation (LLM + rules-based)
`engine-episode-sync.ts`: Episode-to-V2 sync and mapping
`engine-reinforce.ts`: Memory reinforcement and reconsolidation
`engine-recall-select.ts`: Recall entry selection and budget allocation
`store.ts`: JSON-based persistence
`config.ts`: Configuration management
`consolidation.ts`: Episode consolidation
`dedup.ts`: Deduplication logic
`dream-lock.ts`: Dream lock mechanism
`eviction.ts`: Memory eviction algorithms
`extension.ts`: nanoPencil extension adapter
`extraction.ts`: Memory extraction (LLM + heuristic)
`full-insights.ts`: Comprehensive insights
`full-insights-sections.ts`: Claude-style parallel insight section generation for comprehensive reports
`full-insights-html.ts`: HTML insights report
`human-insights.ts`: Human-readable insights
`i18n.ts`: Internationalization
`insights-html.ts`: HTML insights generation
`linking.ts`: Memory relationship discovery
`privacy.ts`: Privacy controls and PII filtering
`scoring.ts`: Retrieval scoring algorithms
`types.ts`: All memory type definitions
`update.ts`: Memory update operations

**Note:** Has its own `AGENT.md` for detailed documentation

### soul-core/ — AI Personality Evolution

**P3 Contract (index.ts):**
`index.ts`: - [WHO]: SoulEngine, Personality traits
    - [FROM]: evolution.ts, manager.ts
    - [HERE]: soul barrel

**Files:**
`config.ts`: Soul configuration
`evolution.ts`: Personality evolution logic
`injection.ts`: Prompt injection
`manager.ts`: Soul state management
`store.ts`: Persistence
`types.ts`: Soul-related types

---

## Package Dependencies

```
agent-core
    └── ai

ai
    └── (standalone, no internal deps)

tui
    └── (standalone)

mem-core
    └── (standalone)

soul-core
    └── (standalone)
```

---

## Build Process

```bash
# Build individual package
npm run build --prefix packages/ai
npm run build --prefix packages/agent-core

# Bundle all local packages
node scripts/bundle-deps.js

# Root build aggregates all (build:deps: ai → agent-core → tui)
npm run build
```

---

## Testing

All packages use vitest:
```bash
npm run test --prefix packages/agent-core
npm run test --prefix packages/ai
npm run test --prefix packages/tui
```

---

## Publishing

Packages are published to npm as part of the monorepo:
- `@pencil-agent/agent-core`
- `@pencil-agent/ai`
- `@pencil-agent/tui`
- `@pencil-agent/mem-core` (internal)
- `@pencil-agent/soul-core` (internal)

---

**Covenant**: When modifying packages/, update this P2 and verify parent P1 links.
