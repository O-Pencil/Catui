# modes/acp/

> P2 | Parent: ../AGENT.md

Member List
acp-mode.ts: ACP protocol integration, @agentclientprotocol/sdk implementation, Agent Communication Protocol handler, /session status includes last loop result. Extension lifecycle aligned with interactive mode: bindSession emits session_ready; activateSession re-emits session_ready after switchSession so memory/soul/presence/interview rebuild context. ExtensionUIContext degrades select/confirm/input/editor to safe defaults (ACP has no interactive surface) instead of throwing, so non-interactive extensions keep contributing context.

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
