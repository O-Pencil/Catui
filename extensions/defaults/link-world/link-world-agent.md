---
name: link-world
description: Built-in internet access bridge for NanoPencil. Use when a task needs agent-reach backed web search, browsing, or remote internet actions.
---

# Link-world

NanoPencil exposes link-world as first-class tools. Prefer these tools over calling `agent-reach` through `bash`.

## Tool Selection

- Use `web_search` for ordinary search and lightweight web research, but only if the tool is available in the current session.
- Use `web_fetch` when you already have the target URL and need its content, but only if the tool is available in the current session.
- Use `link_world_admin` first when you need setup status, version, install help, or diagnostics.
- Use `link_world_exec` only when you need a lower-level `agent-reach` command that `web_search` does not model.
- If the task is about interacting with a live page rather than retrieving knowledge, switch to the `browser` tool family instead of forcing link-world.
- Do not hand-build shell strings for `agent-reach` unless the dedicated tools are unavailable.

## Recommended Flow

1. Check readiness with `link_world_admin` action `status` or `doctor`.
2. If the runtime is missing, use `link_world_admin` action `install_help` or `/link-world install`.
3. If `web_search` is available, use it for ordinary search.
4. If `web_fetch` is available and the exact URL is already known, use it.
5. If high-level link-world tools are unavailable, call `link_world_exec` with explicit argv-style arguments.
6. Prefer bundled site or domain skills before inventing a new web workflow.

## Examples

Admin:

```json
{
  "action": "status"
}
```

Execution:

High-level search:

```json
{
  "query": "OpenAI Responses API"
}
```

```json
{
  "query": "Playwright file upload",
  "provider": "web",
  "limit": 5
}
```

High-level fetch:

```json
{
  "url": "https://example.com/docs"
}
```

Lower-level execution:

```json
{
  "args": ["doctor"]
}
```

```json
{
  "args": ["search", "OpenAI Responses API"]
}
```

## Notes

- Pass `args` as an array of tokens, not as one shell command string.
- If `agent-reach` is not installed, the tools will return install guidance.
- Keep NanoPencil as the integration boundary: diagnostics through `link_world_admin`, search through `web_search`, direct retrieval through `web_fetch`, lower-level execution through `link_world_exec`.
