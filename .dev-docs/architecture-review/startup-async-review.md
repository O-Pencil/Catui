# Startup Async + Build-Speed Review (P7 startup slice)

```yaml
review_id: startup-async-review
phase: P7 (startup + build pipeline)
parent: bundle-redesign-review (P7) / entry-volume-review (P6 cold-start line)
scope:
  - core/runtime/sdk.ts          # MCP load off the critical path
  - core/runtime/agent-session.ts# warmupMcpTools() / _refreshMcpTools()
  - modes/interactive/interactive-mode.ts
  - core/platform/timings.ts     # instrumentation
  - scripts/build-deps.js        # parallel deps build
  - core/lib/{ai,agent-core,tui}/tsconfig.build.json  # incremental
status: implemented
created_at: 2026-06-10
api_change: additive (non-breaking) — declared per GB-2
```

## Why

P6 cut cold-start ~75% by lazy-loading modes/providers, but **MCP was still
awaited synchronously inside `createAgentSession`, before the session/UI even
existed** (`sdk.ts`, old line 556). MCP is enabled by default for nanopencil
(`main.ts`), and the **default config ships three npx-based servers enabled**
(`filesystem`, `sequential-thinking`, `memory` — `DEFAULT_MCP_CONFIG`). Spawning
`npx -y @modelcontextprotocol/server-*` serially and awaiting the handshake
blocks the prompt for a long time.

### Measured before-baseline (NANOPENCIL_TIMING / isolated `MCPManager.initialize`)

| MCP config | blocking init (on critical path) |
|------------|----------------------------------|
| stock defaults (3× npx, **warm** cache) | **~20s** (cold first run 24–34s) |
| 2 local stdio servers | ~1.05s (= 500ms baseDelay × 2 + spawn + handshake) |
| per stdio server floor | 500ms `initializeServer` baseDelay + spawn + 2 round-trips |

The 500ms floor is a hardcoded `setTimeout` in `mcp-client.ts:initializeServer`.

## Decision

Move MCP off the startup critical path, **reusing the existing live-tool-refresh
path** that `reload()` already used (`_mcpToolsFactory → _customTools → _buildRuntime → agent.setTools`).
This is a first-class, already-exercised operation (`/reload`, persona switch,
figma setup), so mid-session tool injection is low risk.

- `createAgentSession` no longer awaits MCP. It builds `mcpToolsFactory` and
  returns immediately with `initialMcpTools = []`.
- New `AgentSession.warmupMcpTools()` runs the factory and merges tools into the
  live runtime, emitting `sdk:mcp_ready`.
- **Interactive** sets `deferMcpInit` and calls `warmupMcpTools()` fire-and-forget
  once the UI is ready (`interactive-mode.ts`, after `firstInput.ready`); a
  `MCP: N tool(s) ready` status appears when tools land.
- **One-shot / non-TTY modes (print, acp, rpc)** keep the old contract: MCP is
  awaited inside `createAgentSession` before returning, so tools are present for
  the single turn. This is the *minimal blast radius* choice — those modes need
  zero changes.

### Soul: not deferred (measured)

`createSoulManager` + `initialize` measured ~10–30ms warm (~100ms cold, dominated
by a one-time dynamic import). Below the "don't add complexity" threshold, and
soul is entangled with system-prompt injection — **left synchronous**.

### After (createAgentSession return time, deferMcpInit)

| MCP config | OLD (`deferMcpInit=false`) | NEW interactive (`deferMcpInit=true`) |
|------------|----------------------------|----------------------------------------|
| stock defaults (3× npx) | 56,227ms (cold) | **1,908ms** — MCP now background |
| 2 local stdio servers | 3,202–3,507ms | **624–793ms** (MCP 1,070ms → background) |

Correctness: with deferral, runtime has 0 MCP tools at first-input; after
warmup, all tools inject into the live runtime (verified: 0 → 26 tools,
`sdk:mcp_ready toolCount=26`).

## Build pipeline (P7 build line)

`build:deps` rebuilt the 4 internal libs **serially with no incremental cache**:
no-op rebuild measured **109s**. Two safe, behavior-neutral changes:

- **Parallel** `scripts/build-deps.js`: phase 1 = `extension-sdk + ai + tui` in
  parallel (mutually independent), phase 2 = `agent-core` (needs ai's `.d.ts`).
  Propagates child failures (unlike shell `& wait`, which returns 0 on failure).
- **Incremental** tsc on ai/agent-core/tui (`incremental` + `.tsbuildinfo`
  outside `dist`, gitignored). extension-sdk was already `composite`.

Result: no-op `build:deps` **109s → 41.7s (−62%)**; changed-file rebuilds only
recompile the affected package + dependents. Host `tsc` still full-emits (root
`clean:dist` wipes its output every build — out of scope here).

## Gates (all green)

- public-export symbols **296 = 296** (`collect-baseline.ts` AST diff: identical) —
  no new top-level export; additions are member-level (method/field/event variant).
- `verify:dip` ✅ · `verify:quality` ✅ (552 files, 0 cycles) ·
  `verify:package-boundary` static + `:dist` ✅
- `tsc --noEmit` ✅ · `test:tools` ✅ · `test:commands` ✅
- full `npm run build` green through the new parallel `build:deps`

## Out of scope (still P7/P8 backlog)

- Bundle size: `models.generated.js` (492K) chunking (BR03), browser 1.6M
  optional install (BR02) — gated on metrics / install UX.
- P8 SDK narrowing — breaks API, needs a major window.
- The default config enabling 3 npx MCP servers is itself questionable (network
  on every boot); async load makes it tolerable, but trimming defaults is a
  separate GB-2 product decision.
