---
name: figma-design
description: Use this skill when the user wants NanoPencil to inspect, create, or edit designs in Figma through MCP.
---

# Figma Design

Use this skill when the user asks NanoPencil to:

- Generate a design in Figma
- Edit an existing Figma file
- Turn requirements into Figma frames, components, or styles
- Read design context from Figma before implementing UI

## Preferred integration path

Prefer the official Figma Remote MCP server first. Use the desktop server as a fallback or as an additional local-context path.

NanoPencil includes two built-in disabled MCP presets:

- Server ID: `figma-remote`
- URL: `https://mcp.figma.com/mcp`
- Auth: `/figma auth` tries a standalone browser OAuth flow first. If Figma blocks first-time client registration on this machine, NanoPencil can fall back to importing an existing official local session.

- Server ID: `figma-desktop`
- URL: `http://127.0.0.1:3845/mcp`

## First-time setup flow

If the Figma MCP tools are not available yet:

1. Prefer the remote setup first:

```text
/figma auth
/figma remote
```

If the user already has dedicated Figma OAuth credentials for NanoPencil, they can also set:

```text
NANOPENCIL_FIGMA_CLIENT_ID
NANOPENCIL_FIGMA_CLIENT_SECRET
```

2. If the user wants the local desktop route instead, ask them to open the Figma desktop app and enable the desktop MCP server in Figma Dev Mode.
3. Then tell them to run:

```text
/figma setup
```

4. After reload, check whether MCP tools from a Figma server are available.

## How to work once Figma tools are available

- First inspect the available Figma MCP tools in the current session.
- Prefer reading the current file or selection context before writing.
- Then create or update frames, components, text, styles, or variables as needed.
- When the user wants generated UI, write the result into Figma instead of only describing it in chat.

## Important guidance

- Prefer the remote path when possible because it is closer to the Codex/Claude-style setup.
- If the remote path is not authenticated yet, guide the user through `/figma auth` before falling back to desktop.
- The official write-capable path is MCP, not the read-heavy REST API.
- If tools are missing after enabling either server, remind the user to run `/reload`.
- If the remote path fails but the user already has a valid local desktop MCP server, use the desktop route so the design task can still move forward.
