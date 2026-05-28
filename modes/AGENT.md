# modes/ — Run Modes Module

> P2 | Parent: ../AGENT.md

---

## Overview

The `modes/` module contains the three distinct execution modes for nanoPencil. Each mode provides a different user interface paradigm while sharing the same core AgentSession.

**Key Characteristics:**
- I/O abstraction over shared core
- Mode selection at CLI entry point
- Consistent API surface across modes
- IDE integration support via RPC

---

## Member List

### Mode Selection

`index.ts`: Mode exports and selection logic
- [WHO]: Provides runMode(), ModeType
- [FROM]: Depends on interactive-mode, print-mode, rpc-mode
- [TO]: Consumed by main.ts
- [HERE]: modes/index.ts - mode router

`agent-loop-result-format.ts`: Shared agent loop result policy and transition formatter
- [WHO]: Provides formatLoopPolicySummary(), formatLoopTransitionSummary(), formatLoopTransitionHistory()
- [FROM]: Depends on agent-core AgentRunPolicy and AgentLoopTransition
- [TO]: Consumed by interactive and ACP status formatters
- [HERE]: modes/agent-loop-result-format.ts - shared run-result display helpers

### Interactive Mode (`modes/interactive/`)

Primary TUI mode for terminal-based interaction.

**Directory Structure:**
```
interactive/
├── interactive-mode.ts    # Main TUI controller
├── agent-loop-status.ts   # /status loop outcome formatting
├── components/            # UI widgets (41 files)
│   ├── index.ts           # Component barrel exports
│   ├── custom-editor.ts   # Custom input editor with keybindings
│   ├── assistant-message.ts # AI response display
│   ├── user-message.ts    # User input display
│   ├── bash-execution.ts  # Bash output display
│   ├── tool-execution.ts  # Tool call display
│   ├── diff.ts            # Diff visualization
│   ├── session-selector.ts # Session picker
│   ├── model-selector.ts   # Model picker
│   ├── settings-selector.ts # Settings UI
│   ├── extension-selector.ts # Extension manager
│   ├── provider-selector.ts  # Provider picker
│   ├── config-selector.ts   # Config picker
│   ├── theme-selector.ts    # Theme switcher
│   ├── thinking-selector.ts  # Reasoning level
│   ├── footer.ts              # Status bar
│   ├── countdown-timer.ts    # Loop timer display
│   ├── extension-input.ts    # Extension prompts
│   ├── extension-editor.ts   # Extension config editor
│   ├── custom-message.ts     # Custom message renderer
│   ├── apikey-input.ts       # API key dialog
│   ├── login-dialog.ts       # Login UI
│   ├── oauth-selector.ts     # OAuth picker
│   ├── scoped-models-selector.ts # Scoped models
│   ├── session-selector-search.ts # Fuzzy session search
│   ├── tree-selector.ts      # Session tree view
│   ├── memory-stats.ts       # NanoMem statistics
│   ├── soul-stats.ts         # Soul statistics
│   ├── skill-invocation-message.ts # Skill output
│   ├── branch-summary-message.ts # Branch display
│   ├── compaction-summary-message.ts # Compaction display
│   ├── keybinding-hints.ts   # Keyboard hints
│   ├── attachments-bar.ts    # File attachments
│   ├── show-images-selector.ts # Image toggle
│   ├── dynamic-border.ts     # Animated borders
│   ├── bordered-loader.ts    # Loading animation
│   ├── pencil-loader.ts      # Brand animation
│   ├── visual-truncate.ts    # Smart truncation
│   ├── armin.ts              # Argon2 + Minio utilities
│   ├── daxnuts.ts            # Data exchange nuts
│   └── user-message-selector.ts # User message picker
└── theme/                   # Theme definitions
    ├── theme.ts             # Theme loader
    ├── theme-schema.json    # Theme type schema
    ├── dark.json            # Dark theme
    ├── light.json           # Light theme
    └── warm.json            # Warm/amber theme
```

**P3 Contract:**
`interactive-mode.ts`:
- [WHO]: Provides InteractiveMode class, runInteractiveMode()
- [FROM]: Depends on @pencil-agent/tui, agent-session, components
- [TO]: Consumed by cli.ts, main.ts
- [HERE]: modes/interactive/interactive-mode.ts - TUI orchestration hub

### Print Mode (`modes/print/`)

Non-interactive mode for scripting and piping.

`print-mode.ts`: Provides runPrintMode(options), PrintModeResult, print loop result JSON formatting, and automatic continuation text aggregation for batch/stdin/stdout execution consumed by main.ts

**P3 Contract:**
`print-mode.ts`:
- [WHO]: Provides PrintModeOptions, PrintModeResult, formatPrintLoopResult(), collectPrintAssistantText(), runPrintMode()
- [FROM]: Depends on ai, agent-core, agent-session
- [TO]: Consumed by main.ts, modes/index.ts, print mode tests
- [HERE]: modes/print-mode.ts - batch processing mode

### RPC Mode (`modes/rpc/`)

JSON-RPC over stdin/stdout for IDE integration.

**P3 Contract:**
`rpc-mode.ts`:
- [WHO]: Provides runRpcMode(), buildRpcSlashCommands(), buildRpcSessionState(), buildRpcLoopPolicyOptions()
- [FROM]: Depends on agent-session, rpc-client
- [TO]: Consumed by main.ts
- [HERE]: modes/rpc/rpc-mode.ts - IDE bridge

**P3 Contract:**
`rpc-client.ts`:
- [WHO]: Provides RpcClient class
- [FROM]: Depends on rpc-types
- [TO]: Consumed by rpc-mode
- [HERE]: modes/rpc/rpc-client.ts - RPC client implementation

**P3 Contract:**
`rpc-types.ts`:
- [WHO]: Provides RpcRequest, RpcResponse, RpcSessionState, RpcLoopPolicyOptions types
- [FROM]: No dependencies
- [TO]: Consumed by rpc-client, rpc-mode
- [HERE]: modes/rpc/rpc-types.ts - RPC protocol definitions

### ACP Mode (`modes/acp/`)

Agent Communication Protocol mode.

**P3 Contract:**
`acp-mode.ts`:
- [WHO]: Provides AcpMode class, runAcpMode(), ACP status formatting helpers
- [FROM]: Depends on agent-session
- [TO]: Consumed by main.ts
- [HERE]: modes/acp/acp-mode.ts - ACP protocol handler

### Utilities (`modes/utils/`)

Shared utilities for all modes.

**P3 Contract:**
`clipboard.ts`:
- [WHO]: Provides copyToClipboard()
- [FROM]: No dependencies
- [TO]: Consumed by interactive-mode
- [HERE]: modes/utils/clipboard.ts - platform-agnostic clipboard access

**P3 Contract:**
`clipboard-native.ts`:
- [WHO]: Provides clipboard module, getClipboardBinary()
- [FROM]: Depends on @mariozechner/clipboard
- [TO]: Consumed by clipboard-image
- [HERE]: modes/utils/clipboard-native.ts - platform-specific clipboard

**P3 Contract:**
`clipboard-image.ts`:
- [WHO]: Provides readClipboardImage(), ClipboardImage type
- [FROM]: Depends on clipboard-native, photon-node
- [TO]: Consumed by interactive-mode (image paste)
- [HERE]: modes/utils/clipboard-image.ts - clipboard image operations

**P3 Contract:**
`image-convert.ts`:
- [WHO]: Provides convertImageFormat()
- [FROM]: Depends on photon-node
- [TO]: Consumed by clipboard-image
- [HERE]: modes/utils/image-convert.ts - image format conversion

**P3 Contract:**
`image-resize.ts`:
- [WHO]: Provides resizeImage()
- [FROM]: Depends on photon-node
- [TO]: Consumed by interactive-mode
- [HERE]: modes/utils/image-resize.ts - image resizing for display

---

## Mode Selection Logic

```typescript
// From cli.ts/main.ts
if (options.mode === 'interactive') runInteractiveMode(session);
else if (options.mode === 'print') runPrintMode(session, options);
else if (options.mode === 'rpc') runRpcMode(session);
```

---

## Architecture Patterns

### Mode Independence

Each mode:
- Receives pre-configured AgentSession
- Manages its own I/O loop
- Handles its own input parsing
- Formats its own output

### Shared State

- AgentSession is the single source of truth
- Modes do not share UI state directly
- All modes can trigger compaction

---

## Quality Rules

- Components directory: Subdivide if >20 files
- Theme files must validate against schema
- All mode entry points must handle SIGINT gracefully

---

**Covenant**: When modifying modes/, update this P2 and verify parent P1 links.
