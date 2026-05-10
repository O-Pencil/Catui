# core/ — Core Functionality Module

> P2 | Parent: ../AGENT.md

---

## Overview

The `core/` module contains the central business logic for nanoPencil. It orchestrates agent runtime, session management, tool execution, extension loading, and configuration.

**Key Characteristics:**
- Platform-agnostic TypeScript (Node.js 20+)
- Event-driven architecture via EventBus
- Dependency injection pattern for testability
- Extension hooks for extensibility

---

## Member List

### Entry Coordination

`index.ts`: Barrel exports for core API surface, re-exports runtime, tools, extensions

### Internationalization (`core/i18n/`)

`index.ts`: i18n core - locale management, translation function `t()`

### Tools Layer (`core/tools/`)

`index.ts`: Tool registry and orchestrator, loads built-in tools and extension tools, - [WHO]: ToolExecutor, tool registry

`bash.ts`: Shell command execution with timeout and streaming

`edit.ts`: Line-based file editing via diff application

`write.ts`: File writing (create or overwrite)

`grep.ts`: Content search via ripgrep integration

`find.ts`: File pattern matching via glob

`ls.ts`: Directory listing with metadata

`source.ts`: Source code analysis and context extraction

`path-utils.ts`: Path manipulation utilities

`truncate.ts`: Output truncation for large results

`orchestrator.ts`: Tool execution ordering and dependency resolution

### Extension System (`core/extensions/`)

`loader.ts`: Discovers extensions from npm packages, local paths, workspace config

`runner.ts`: Manages extension lifecycle, event emission, tool wrapping, - [WHO]: ExtensionRunner
- [FROM]: loader.ts
- [TO]: (check imports)
- [HERE]: extension orchestration
`wrapper.ts`: Wraps user tools with extension before/after hooks; lets tool_result hooks replace both successful output and error text

`types.ts`: All extension-related TypeScript types and interfaces, including tool_call input replacement results

`index.ts`: Barrel exports for extension system

### MCP Integration (`core/mcp/`)

`mcp-client.ts`: MCP protocol client implementation, handles JSON-RPC communication

`mcp-config.ts`: MCP server configuration management

`mcp-adapter.ts`: Adapts MCP tools to nanoPencil tool format, - [WHO]: McpToolAdapter
- [FROM]: mcp-client.ts
- [TO]: (check imports)
- [HERE]: protocol bridge
`mcp-guidance.ts`: MCP usage guidance and error handling

`index.ts`: Barrel exports for MCP module

`figma-auth.ts`: Figma OAuth integration for MCP servers

### SubAgent Runtime (`core/sub-agent/`)

`sub-agent-types.ts`: Core SubAgent interfaces — SubAgentSpec, SubAgentHandle, SubAgentResult, SubAgentBackend; consumed by backend and runtime
`sub-agent-backend.ts`: InProcessSubAgentBackend — wraps createAgentSession() with AbortSignal forwarding and optional timeout
`sub-agent-runtime.ts`: SubAgentRuntime class — active agent registry, spawn/abortAll/terminateAll, default global instance
`index.ts`: Barrel exports for sub-agent module

### Workspace Management (`core/workspace/`)

`worktree-manager.ts`: WorktreeManager — createTempWorkspace, createGitWorktree, detectChanges, generatePatch, dispose/disposeAll; default global instance; - [WHO]: WorktreeManager, worktreeManager, WorkspacePath
`index.ts`: Barrel exports for workspace module

### Session Management (`core/session/`)

`session-manager.ts`: Session persistence to JSONL, handles forking, branching, switching

`branch-summarization.ts`: Branch summary generation for forked sessions

`compaction-coordinator.ts`: Coordinates compaction operations

`utils.ts`: Token estimation and text processing helpers

`index.ts`: Barrel exports for compaction module

### Model Management (`core/model/`)

`index.ts`: Model registry facade, - [WHO]: ModelRegistry
- [FROM]: model-registry.ts, model-resolver.ts
- [TO]: (check imports)
- [HERE]: model abstraction
`switcher.ts`: Runtime model switching logic, - [WHO]: ModelSwitcher
- [FROM]: index.ts
- [TO]: (check imports)
- [HERE]: model transitions
`model-registry.ts`: Manages model definitions, handles API key resolution, appendOpenRouterModel writes custom OpenRouter ids to models.json

`model-resolver.ts`: Resolves model IDs to provider configurations

### Configuration (`core/config/`)

`settings-manager.ts`: Two-tier settings (global + project-local), merge logic

`resource-loader.ts`: Discovers and loads extensions, skills, prompts, themes

`auth-storage.ts`: Secure API key storage and retrieval

`resolve-config-value.ts`: Config value resolution with precedence

### Prompt Engineering (`core/prompt/`)

`system-prompt.ts`: System prompt builder with memory injection

`prompt-templates.ts`: Template library for various prompt types

### Other Modules

`defaults.ts`: Default configuration values

`diagnostics.ts`: Health checks and system diagnostics

`keybindings.ts`: Keybinding definitions for TUI

`messages.ts`: Message handling and formatting

`skills.ts`: Skill definitions and registry

`slash-commands.ts`: Built-in slash command implementations

`bash-executor.ts`: Shared bash execution logic with streaming, truncation, cancellation, and explicit cwd support

`exec.ts`: Shared child-process execution helper for extension and package manager commands

`package-manager.ts`: Package source installation, update, removal, and resource discovery for npm/git/local packages

`soul-integration.ts`: Soul manager loading, prompt injection, and session context extraction bridge

`timings.ts`: Startup/runtime checkpoint timing helper for profiling initialization phases

`custom-providers.ts`: Custom provider registration

`footer-data-provider.ts`: Footer information for TUI

`mcp-manager.ts`: MCP server lifecycle management, - [WHO]: McpManager
- [FROM]: mcp/
- [TO]: (check imports)
- [HERE]: MCP orchestration

`agent-dir/`: Multi-agent directory and metadata management

`persona/`: Persona management

`export-html/`: HTML export functionality with templates

---

## Architectural Patterns

### Dependency Direction

```
runtime/agent-session.ts  ← tools/
                        ← session/
                        ← extensions/
                        ← model/
                        ← config/
```

### Event Flow

```
User Input → AgentSession → EventBus → Extensions
                            ↓
                        ToolOrchestrator → Tools
                            ↓
                        Response → User
```

### Extension Hooks

All hooks are optional. Default execution continues if hook is absent.

---

## Quality Rules

- Single file limit: ~400 lines for complex modules
- Directory file limit: ~15 files per subdirectory
- No circular dependencies between modules
- All public APIs must have JSDoc

---

**Covenant**: When modifying core/, update this P2 and verify parent P1 links.
