# core/platform/utils/

> P2 | Parent: ../AGENT.md

Member List
sleep.ts: sleep() function, sleep helper that respects abort signal, no external dependencies
shell.ts: getShellConfig(), getShellEnv(), killProcessTree(), shell detection and utilities, detects bash/zsh/fish/pwsh, key invariant: cached shell config per process
tools-manager.ts: ensureTool() function, ToolManager class, external tool installation and management (ripgrep, fd, etc.), downloads and extracts to ~/.nanopencil/bin/
logger.ts: AgentLogger interface, createLogger(), noopLogger, structured JSON logging with session/turn/span tracing, key types: LogEntry, LogLevel

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md