---
name: mcp-management
description: Use this skill when the user asks to install, configure, debug, enable, or disable MCP servers or MCP tools in NanoPencil.
---

# MCP Management

Use this skill when the user asks for any of the following:

- Install a new MCP server
- Configure an existing MCP server
- Enable or disable MCP servers in NanoPencil
- Debug why MCP tools are missing
- Add API keys or environment variables for an MCP server

## What NanoPencil already does

- MCP is enabled by default in NanoPencil unless the user launched it with `--no-mcp` or in offline mode.
- NanoPencil reads MCP server definitions from `~/.nanopencil/agent/mcp.json`.
- MCP tools are loaded into the current session at startup and on `/reload`.

Important:

- Editing `mcp.json` alone does not make new MCP tools appear immediately in the current session.
- After changing MCP config, tell the user to run `/reload`, or explain that a restart/reload is needed before the new tools can be used.

## How to inspect the current MCP setup

1. Read `~/.nanopencil/agent/mcp.json` if it exists.
2. Check whether the target server already exists in `mcpServers`.
3. Check whether it is enabled.
4. Check whether required environment variables are present.

If the file does not exist, NanoPencil will create a default one when MCP config is first loaded.

## How to add a new MCP server

1. Find the official install/start command from the server's documentation.
2. Prefer stable commands such as:
   - `npx -y <package>`
   - `uvx <package>`
   - `python -m <module>`
   - `node /absolute/path/to/server.js`
3. Add a server entry to `~/.nanopencil/agent/mcp.json`.
4. Set `enabled: true` only if the command and required credentials are ready.
5. Tell the user that `/reload` is required to apply the change.

## Config shape reminder

Use this structure:

```json
{
  "mcpServers": [
    {
      "id": "example",
      "name": "Example",
      "command": "npx",
      "args": ["-y", "@example/server"],
      "enabled": true,
      "transport": "stdio",
      "toolTimeout": 30000
    }
  ]
}
```

For remote HTTP/SSE MCP servers, use the server's documented transport and URL fields supported by NanoPencil's MCP config.

## Safe operating rules

- Do not invent MCP package names. Check the server's official docs first.
- Do not claim the new MCP tools are ready until the config is written and the user has reloaded.
- If credentials are required, ask the user for the missing values instead of guessing.
- If an install command modifies global system state, tell the user what will be installed.

## Good response pattern

When the user asks you to install an MCP server:

1. Inspect `mcp.json`
2. Install or configure the server
3. Update `mcp.json`
4. Tell the user exactly what changed
5. Ask them to run `/reload` if the current session needs to pick up the new tools
