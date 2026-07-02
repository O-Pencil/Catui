---
name: mcp-awareness
description: Use when the user asks how Catui nudges the agent toward the right `mcp_*` tool for a given request, or how MCP tool descriptions and system prompts carry the "use MCP first" signal.
surface: TODO  # user entry points: /mcp tools, MCP server enable/disable in mcp.json
owner: core/mcp/  # DIP P2 anchor — read its AGENT.md member list to find code
status: draft
---

# MCP Tool Awareness

> Catui uses three layered mechanisms to make the LLM more likely to
> reach for the right `mcp_*` tool when the user's request matches an
> MCP server's domain. The layers stack so a request like "fetch a
> public web page" still finds `mcp_fetch_fetch_html` even if the model
> misses the system-prompt hint or the warmup hint.

## When to use
- "Why isn't the LLM calling my MCP tool?" — to explain the three-layer nudge.
- "How do MCP tool descriptions get written?" — to find the build / inference code.
- "How big does the MCP section grow with many tools?" — to check the prompt budget.

## The three layers (in order of when the LLM sees them)

| Layer | When | What | Code |
|-------|------|------|------|
| 1. Tool description (per tool) | Every API call via tool schema | `name` + scenario-enriched `description` + scenario-enriched `guidance` | `core/mcp/mcp-adapter.ts:createMCPTool` |
| 2. System-prompt "MCP Tools Awareness" paragraph | Every system-prompt rebuild | Static paragraph listing up to 5 active `mcp_*` tools + nudge | `core/prompt/system-prompt.ts:buildSystemPrompt` |
| 3. Warmup hint CustomMessage | Once after MCP tools finish loading | Full MCP capabilities roster, hidden from chat but visible to LLM | `core/mcp/mcp-capabilities-hint.ts` + `core/runtime/agent-session.ts:warmupMcpTools` |

### Layer 1 — Tool description
Every MCP tool is wrapped by `createMCPTool(mcpClient, mcpTool)`. The
returned `ToolDefinition` carries:

- **`description`**: starts with the upstream MCP server's own description
  for compatibility with `/mcp tools` listing, then appends a
  scenario-oriented suffix from `mcp-server-hints.ts` (e.g. "read or write
  files outside the local project cwd"), then a `(MCP: server/tool)` marker
  the UI still relies on.
- **`guidance`**: a separate field (not `description`) that the system
  prompt builder can render as a per-tool reminder. Format: "Use
  mcp_<server>_<tool> when the user's request matches the MCP server
  '<serverId>' — typically <scenario phrase>."

The scenario phrases come from two sources merged together:

- **Server-level hints** (`core/mcp/mcp-server-hints.ts`): 11 builtin
  servers (filesystem, fetch, sequential-thinking, memory, figma-desktop,
  figma-remote, sqlite, github, brave-search, git, postgres) each have 2–3
  user-intent phrases. Unknown servers gracefully fall back to
  "<serverId>'s domain".
- **Schema-driven inference** (`core/mcp/mcp-schema-inference.ts`): 14
  SCENARIO_RULES match common field-name substrings (path → "operates on
  files or directories by path", url → "targets a URL or HTTP endpoint",
  query → "runs a search / lookup", branch/commit → "targets a git ref",
  etc.) and append a one-line "Takes args that …" sentence. This is
  especially valuable when the upstream MCP server's description is
  missing or terse.

### Layer 2 — System-prompt paragraph
`buildSystemPrompt({ selectedTools, mcpToolNames })` appends a fixed
"MCP Tools Awareness" paragraph right after the "Available tools" list
when at least one `mcp_*` tool is active. The paragraph is **bounded at
≤800 chars** even with 20+ tools (verified in
`progress-log.md` round 15). Total system prompt grows by ~5 chars per
additional MCP tool — descriptions themselves flow through OpenAI
tool_use schema and don't bloat the prompt.

The paragraph is omitted entirely when no MCP tool is active, so
non-MCP users see zero overhead.

### Layer 3 — Warmup hint CustomMessage
`agent-session.warmupMcpTools()` injects a single CustomMessage into the
session right after MCP tools finish loading, using:

- `customType: "mcp.capabilities"` (namespaced, not in the LLM-excluded set)
- `display: false` (hidden from the chat stream, visible to the LLM)
- `content: buildMcpCapabilitiesHint(tools)` — title line + one line per
  tool (`mcp_<server>_<tool>: <truncated description>`) capped at 8 tools
  before folding to `+N more`

The injection is idempotent via the `_mcpCapabilitiesInjected` flag on
the session — repeated warmups (e.g. from `/reload`) don't re-append.

Layer 3 fills the gap that layer 2 cannot: if the user starts chatting
before MCP finishes loading, the system prompt at session start didn't
yet know about the MCP tools. By the time the second turn runs, the
warmup hint is the very first message the LLM sees, so the capability
roster is unmissable.

## Why only three layers (and not a per-turn keyword matcher)

Earlier versions of Catui also shipped an `mcp-suggest` extension that
keyword-matched the user's prompt against `mcp_*` tool descriptions on
every turn and injected a top-3 hint CustomMessage. It was removed in
v1.3 because:

- Layer 1 already makes every tool's scenario visible to the LLM via
  the tool schema. A description like "Use mcp_fetch_fetch_html when
  … fetch a public web page" is itself a high-signal query → tool match.
- Layer 3 covers the warmup gap; per-turn hints add little on top of it
  but cost a full token budget walk every turn (tokenize, score, sort,
  inject).
- Default-off opt-in UX confused users (the toggle required a restart
  for a feature whose benefit was hard to observe).

If we ever need an additional nudge, the right shape is a single static
augmentation of the system prompt, not a per-turn keyword re-compute.

## Behavior & defaults

| Layer | Default | Cost |
|-------|---------|------|
| 1. Tool description | Always on | Per-tool description ~150–300 chars (charged once per LLM call, deduped by tool-use cache) |
| 2. System-prompt paragraph | Always on (when MCP active) | ≤800 chars total, even with 20+ tools |
| 3. Warmup hint | Always on (when MCP active) | One CustomMessage, hidden from chat |

## Code map → DIP
- Owner: `core/mcp/` — read its DIP **P2 member list** (`core/mcp/AGENT.md`) to locate files:
  - `mcp-adapter.ts` — `createMCPTool`, layer-1 wiring
  - `mcp-server-hints.ts` — `MCP_SERVER_HINTS`, server-level scenarios
  - `mcp-schema-inference.ts` — `SCENARIO_RULES`, schema-level inference
  - `mcp-capabilities-hint.ts` — `buildMcpCapabilitiesHint`, layer-3 body
  - `mcp-guidance.ts` — API-key guidance (separate concern, not used here)
  - `mcp-client.ts` / `mcp-manager.ts` — MCP transport (separate concern)
- Then follow **P3** file headers (WHO / FROM / TO / HERE) to navigate deeper.
- Layer 2 lives in `core/prompt/system-prompt.ts` (not `core/mcp/`) — it's a
  prompt concern, not an MCP concern.

## Tests

| File | Cases |
|------|-------|
| `test/mcp-tool-description.test.ts` | 21 — covers layer 1 (description + guidance format, server-hints, schema-inference) |
| `test/mcp-hint-injection.test.ts` | 13 — covers layer 3 (hint builder + CustomMessage + convertToLlm pipeline) |
| `test/system-prompt.test.ts` | 8 — covers layer 2 (system-prompt MCP paragraph + regression guard on Project Context block) |

All 42 cases live in `test/` and run with `node --test --import tsx`.

## Related
[[extensions]] [[sdk]] [[packages]] [[skills]]