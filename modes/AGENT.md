# modes/ — Run Modes Module

> P2 | Parent: ../AGENT.md

---

## Overview

The `modes/` module contains the distinct execution modes for Catui. Each mode provides a different user interface paradigm while sharing the same core AgentSession.

**Key Characteristics:**
- I/O abstraction over shared core
- Mode selection at CLI entry point
- Consistent API surface across modes
- IDE integration support via RPC
- Remote control surface via serve mode (HTTP + WebSocket)

---

## Member List

### Mode Selection

`index.ts`: Mode exports and selection logic
- [WHO]: Provides runMode(), ModeType; barrel-exports InteractiveMode, runPrintMode, RpcClient, runRpcMode, runAcpMode, runRemoteMode + types
- [FROM]: Depends on interactive-mode, print-mode, rpc/, acp/, remote/
- [TO]: Consumed by root index.ts (SDK surface); main.ts dispatches via dynamic import instead
- [HERE]: modes/index.ts - mode router + public SDK mode surface

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
│   ├── catui-loader.ts      # Brand animation
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
- [FROM]: Depends on @catui/tui, agent-session, components
- [TO]: Consumed by cli.ts, main.ts
- [HERE]: modes/interactive/interactive-mode.ts - TUI orchestration hub

### Print Mode (`modes/print/`)

Non-interactive mode for scripting and piping.

`print-mode.ts`: Provides runPrintMode(options), PrintModeResult, print loop result JSON formatting with optional latest run trace path, and automatic continuation text aggregation for batch/stdin/stdout execution consumed by main.ts

**P3 Contract:**
`print-mode.ts`:
- [WHO]: Provides PrintModeOptions, PrintModeResult, formatPrintLoopResult(), collectPrintAssistantText(), runPrintMode(), and benchmark-facing latest trace path metadata
- [FROM]: Depends on ai, agent-core, agent-session
- [TO]: Consumed by main.ts, modes/index.ts, print mode tests
- [HERE]: modes/print-mode.ts - batch processing mode

### RPC Mode (`modes/rpc/`)

JSON-RPC over stdin/stdout for IDE integration; the protocol core is transport-agnostic and shared with serve mode's WebSocket transport.

**P3 Contract:**
`rpc-command-handler.ts`:
- [WHO]: Provides RpcCommandHandler, RpcServerMessage, buildRpcSlashCommands(), buildRpcSessionState(), buildRpcLoopPolicyOptions()
- [FROM]: Depends on agent-session, session-events, extensions-host, session-manager, rpc-types
- [TO]: Consumed by rpc-mode.ts (stdio transport) and modes/remote/remote-server.ts (WebSocket transport)
- [HERE]: modes/rpc/rpc-command-handler.ts - transport-agnostic RPC protocol core

**P3 Contract:**
`rpc-mode.ts`:
- [WHO]: Provides runRpcMode(); re-exports protocol builders for tests and SDK consumers
- [FROM]: Depends on agent-session, rpc-command-handler, rpc-types
- [TO]: Consumed by main.ts
- [HERE]: modes/rpc/rpc-mode.ts - stdio JSON-lines transport over the shared protocol core

**P3 Contract:**
`rpc-client.ts`:
- [WHO]: Provides RpcClient class
- [FROM]: Depends on rpc-types
- [TO]: Consumed by rpc-mode
- [HERE]: modes/rpc/rpc-client.ts - RPC client implementation

**P3 Contract:**
`rpc-types.ts`:
- [WHO]: Provides RpcCommand, RpcResponse, RpcSessionState, RpcSlashCommand, RpcLoopPolicyOptions, RpcSessionListEntry types
- [FROM]: No dependencies (type-only; agent-core/ai/core shapes imported as types)
- [TO]: Consumed by rpc-client, rpc-mode, rpc-command-handler, apps/mobile web client (type-only mirror)
- [HERE]: modes/rpc/rpc-types.ts - RPC protocol definitions shared by stdio and WebSocket transports

### ACP Mode (`modes/acp/`)

Agent Communication Protocol mode.

**P3 Contract:**
`acp-mode.ts`:
- [WHO]: Provides AcpMode class, runAcpMode(), ACP status formatting helpers
- [FROM]: Depends on agent-session
- [TO]: Consumed by main.ts
- [HERE]: modes/acp/acp-mode.ts - ACP protocol handler

### Remote Serve Mode (`modes/remote/`)

Serves the mobile web UI over HTTP and bridges token-authenticated WebSocket clients to the shared RPC protocol core. Entry: `catui --serve [--port] [--host] [--tunnel]`.

**P3 Contract:**
`remote-mode.ts`:
- [WHO]: Provides runRemoteMode(), RemoteModeOptions
- [FROM]: Depends on node:crypto, remote-server, tunnel, connection-info, interactive theme
- [TO]: Consumed by main.ts (dynamic import when --serve is passed), modes/index.ts (SDK surface)
- [HERE]: modes/remote/remote-mode.ts - serve mode entry: per-run token, server lifecycle, banner/QR, tunnel, signal cleanup

**P3 Contract:**
`remote-server.ts`:
- [WHO]: Provides createRemoteServer(), RemoteServerOptions, RemoteServerHandle
- [FROM]: Depends on node:http, node:crypto, ws, mime-types, config.ts (getRemotePublicDir), rpc-command-handler, rpc-types
- [TO]: Consumed by remote-mode.ts
- [HERE]: modes/remote/remote-server.ts - HTTP static UI + token-authenticated WebSocket transport for remote control

**P3 Contract:**
`connection-info.ts`:
- [WHO]: Provides getLanIPv4Addresses(), buildConnectDeepLink(), renderQr(), formatConnectionBanner()
- [FROM]: Depends on node:os, node:url, chalk, qrcode
- [TO]: Consumed by remote-mode.ts
- [HERE]: modes/remote/connection-info.ts - LAN discovery, deep link building, QR + banner rendering

**P3 Contract:**
`tunnel.ts`:
- [WHO]: Provides startQuickTunnel(), QuickTunnel, CloudflaredNotFoundError
- [FROM]: Depends on node:child_process
- [TO]: Consumed by remote-mode.ts
- [HERE]: modes/remote/tunnel.ts - cloudflared quick tunnel lifecycle (spawn/parse/cleanup)

`public/`: Built mobile web bundle copied here by `npm run build:mobile-web` (gitignored build output; source lives in apps/mobile).

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
// From main.ts (dynamic import so startup only pays for the chosen mode)
if (options.serve) runRemoteMode(session, options);      // --serve: HTTP + WebSocket
else if (options.mode === 'interactive') runInteractiveMode(session);
else if (options.mode === 'print') runPrintMode(session, options);
else if (options.mode === 'rpc') runRpcMode(session);
else if (options.acp) runAcpMode(session, options);
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
