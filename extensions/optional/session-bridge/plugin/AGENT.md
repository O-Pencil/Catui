# Companion MCP client

Parent: [session bridge](../AGENT.md).

| Member | Responsibility |
| --- | --- |
| client.js | Private descriptor reads and authenticated bounded loopback requests |
| server.js | MCP stdio framing, initialization and four tool declarations |
| package.json | ESM declaration for a dependency-free deployable client |

Copy these runtime files into the personal plugin. Never copy registry secrets.
The plugin starts no Catui session and exposes no general shell/UI control.
