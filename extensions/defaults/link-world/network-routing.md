---
name: network-routing
description: Decide whether a task should use NanoPencil's web_search, link_world tools, or browser automation.
---

# Network Routing

NanoPencil has two different network paths:

- `web_search` and `web_fetch` when those high-level tools are actually available in the current session
- `link_world_*` as the durable lower-level integration path
- `browser` and `browser_admin` for direct browser control and page interaction

Choose the path by task shape, not by habit.

## Use `web_search` First

Use `web_search` when it is available and the user needs:

- current facts
- recent news
- API/library documentation lookup
- general web research
- "what is", "find", "latest", "look up", "compare", or "summarize" style requests

If setup is uncertain, call `link_world_admin` with `status` or `doctor` first.

## Use `web_fetch` When The URL Is Known

Use `web_fetch` when it is available and:

- the user already gave a URL
- a prior search step found the exact page you need
- you need page content, not browser interaction
- the task is fetch-and-read rather than click-and-drive

## Use `browser` First

Use `browser` when the user needs:

- login-gated pages
- clicking, typing, uploads, downloads, tabs, screenshots
- form submission
- navigating a live web app
- inspecting visible UI state
- browser-based verification

If setup is uncertain, call `browser_admin` with `status` or `setup` first.

## Fallback Order

1. If `web_search` is available, use it for current knowledge discovery.
2. If `web_fetch` is available and the target URL is already known, use it.
3. If the answer requires interacting with a page, switch to `browser`.
4. If high-level link-world tools are unavailable but internet runtime is present, use `link_world_exec`.
5. Only fall back to `bash` for external CLIs when the dedicated tools are unavailable.

## Working Rule

Prefer NanoPencil's named tools over raw shell commands. The integration boundary should stay inside:

- `link_world_admin`
- `web_search`
- `web_fetch`
- `link_world_exec`
- `browser_admin`
- `browser`
