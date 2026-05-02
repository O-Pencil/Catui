---
name: browser
description: Direct browser control via NanoPencil's built-in Browser Harness. Use when the user wants to automate, scrape, test, or interact with web pages.
---

# Browser Harness

NanoPencil includes a vendored Browser Harness CDP bridge. Use the `browser` tool for normal work and `browser_admin` or `/browser` for install, setup, and diagnostics.

For current facts or general web research, prefer NanoPencil's `web_search` tool first. If the user already has a target URL and only needs the content, prefer `web_fetch`. Use `browser` when the task requires interacting with a page.

## Core Tool Shape

```json
{
  "code": "new_tab('https://example.com')\nwait_for_load()\nprint(page_info())",
  "timeout": 120
}
```

Common helpers are pre-imported inside the Python snippet:

- `new_tab(url)`, `goto_url(url)`, `wait_for_load()`, `page_info()`
- `capture_screenshot(...)`
- `click_at_xy(x, y)`, `type_text(text)`, `press_key(key)`, `scroll(x, y)`
- `js(expression)`, `cdp(method, **params)`, `drain_events()`
- `list_tabs()`, `switch_tab(target)`, `current_tab()`, `ensure_real_tab()`
- `upload_file(selector, path)`, `http_get(url, headers=None)`
- Remote helpers: `start_remote_daemon()`, `stop_remote_daemon()`, `list_cloud_profiles()`, `sync_local_profile()`

Treat the list above as the common surface, not a full inventory. If you need something lower-level, use raw `cdp(...)` or inspect the vendored helper module.

First navigation should be `new_tab(url)`, not `goto_url(url)`, so the user's current tab is not overwritten.

## Workflow

1. If Python dependencies are missing, run `browser_admin` with `{ "action": "install" }` or `/browser install`.
2. For setup or connection problems, run `browser_admin` with `{ "action": "doctor" }` or `/browser status`.
3. If the daemon is not attached, run `browser_admin` with `{ "action": "setup" }` or `/browser setup`.
4. If the user only needs knowledge retrieval, use `web_search` instead of browser automation.
5. For a page interaction task, search `.nanopencil/browser-workspace/domain-skills/` first for site-specific knowledge.
6. Use screenshots to understand and verify visible browser state.
7. After every meaningful action, verify with `capture_screenshot()` or `page_info()`.

## Editable Workspace

NanoPencil copies the bundled Browser Harness workspace to:

```text
.nanopencil/browser-workspace/
```

Use this project-local workspace for reusable browser knowledge:

- `agent_helpers.py` for task-specific helper functions.
- `domain-skills/<site>/` for durable site knowledge.

If you learn a reusable site pattern, update the relevant domain skill before finishing. Capture selectors, URL patterns, private APIs, waits, framework quirks, and traps. Do not write secrets, cookies, session tokens, pixel-only instructions, or run narration.

## Tactics

- Prefer screenshot-driven coordinate clicks for visible UI: `capture_screenshot()` -> inspect image -> `click_at_xy(x, y)` -> screenshot again.
- Drop to DOM/JS only when the target has no useful visible geometry.
- Use `http_get()` for static pages or APIs instead of spending browser time.
- If redirected to an auth wall, stop and ask the user. Do not type credentials from screenshots.
- For raw CDP, use `cdp("Domain.method", param=value)`.

## Interaction Skills

When a mechanic gets tricky, consult the bundled interaction skills:

- cookies, dialogs, downloads, drag-and-drop, dropdowns, iframes, cross-origin iframes
- network requests, print as PDF, profile sync, screenshots, scrolling, shadow DOM, tabs, uploads, viewport
