# Session bridge

Parent: [optional extensions](../AGENT.md).

| Member | Responsibility |
| --- | --- |
| index.ts | Explicit /bridge activation and same-session lifecycle hooks |
| contracts.ts | Private wire limits, errors, registry and capability contracts |
| controller.ts | Session/run binding, idempotent bounded submission and observed receipts |
| registry.ts | Owner-only discovery directory and ephemeral descriptor publication |
| server.ts | Authenticated bounded loopback HTTP listener and cleanup |
| plugin/ | Dependency-free stdio MCP client packaged for Codex |
| setup/ | User-confirmed bundled plugin installation and first-use onboarding |
| control/ | Asynchronous supervisor operation receipts and state revision validation |
| README.md | Installation, activation, receipts and trust boundaries |

Default-loaded command; no model call, timer, process, file write or server at registration. No host
internals beyond the extension API type. Stop/switch/fork/reload/shutdown revoke
transport access; already submitted host messages are not automatically withdrawn.
