<!--
Companion to lesson C9: core to O-Pencil to Gateway integration map + SDK-drift finding.
Map and record only; no downstream code migration in this scope. Anchors are accurate as of catui-agent 1.1.10.
-->

# ecosystem-map — Core to O-Pencil to Gateway integration

"Core engine to GUI expression to Gateway touchpoints." All three repos live under `/root/workspace/`.

```
                       catui-agent (this repo, core engine)
                       publish: catui-agent 1.1.10 / SDK symbols AgentSession, AgentSessionEvent
                              ▲                       ▲
        consume SDK          │                       │         consume SDK
        ┌─────────────────────┘                       └─────────────────────┐
   O-Pencil (GUI)                                                   Pencil-Agent-Gateway (touchpoints)
   catgo-desktop / Electron                                          pencil-agent-gateway
   src/main/lib/nanopencil/                                          src/engine/nano-adapter.ts
```

## Repo positioning

| Repo | Package name | Role | How it consumes the core |
|------|--------------|------|--------------------------|
| catui-agent | `catui-agent` (SDK symbols exposed via `@catui/agent`) | Core engine | itself |
| O-Pencil | `catgo-desktop` | GUI client (Electron) | Main-process wrapper layer `src/main/lib/nanopencil/{session,types}.ts` imports `AgentSession`, `AgentSessionEvent` |
| Pencil-Agent-Gateway | `pencil-agent-gateway` | Outward integration gateway | Adapter `src/engine/nano-adapter.ts:43-44` imports `AgentSession`, `AgentSessionEvent` |

## Integration contract (the core SDK surface both downstream consumers use)

Downstream primarily consumes the **same set** of public symbols (via `@catui/agent` root exports / `packages/protocol` contracts):
- `AgentSession` — session handle (prompt / events / tools).
- `AgentSessionEvent` (aliased as `AgentEvent` in O-Pencil) — session event stream; GUI / gateway renders / forwards from it.

On the core side: C1 (Agent Loop), C2 (session / events), C3 (model). When you reach C9, see how downstream wires this symbol set into GUI events / gateway relay.

## Warning — drift finding (record only, no migration in this scope)

**The core has been renamed; downstream is still pinned to the old package**:

| | Downstream's current import | Core's current state |
|---|---|---|
| O-Pencil `src/main/lib/nanopencil/{session,types}.ts` | `@pencil-agent/nano-pencil` | Already published as `catui-agent` 1.1.10 |
| Gateway `src/engine/nano-adapter.ts` | `@pencil-agent/nano-pencil` | Same |

- **Impact**: downstream `npm install` still pulls the old package `@pencil-agent/nano-pencil` and is disconnected from the renamed core; fixes / capabilities in the new core do not reach the GUI or gateway.
- **Migration entry points** (separate project, not in this scope):
  1. Downstream `package.json` dependency `@pencil-agent/nano-pencil` to the core's new package name (confirm the core's published `name` is `catui-agent`, or if scoped is restored then `@catui/agent`).
  2. Bulk-replace import specifiers in downstream (O-Pencil `src/main/lib/nanopencil/`, Gateway `src/engine/nano-adapter.ts`, etc.; see each repo's `rg "@pencil-agent/nano-pencil"`).
  3. Verify the SDK symbol surface is unbroken (`AgentSession` / `AgentSessionEvent` still exported from the new package root).
  4. Each repo's own self-test (O-Pencil starts Electron and runs one round; Gateway adapter e2e).
- **This framework does not modify downstream code** — this is here as C9 learning material + a migration backlog entry only.

## Hint for the learner

C9 is the best "real debugging exercise": a rename-induced cross-repo breakpoint. Trace import specifier to package.json dependency to published package name — that's exactly one walk through "core SDK surface / how downstream consumes it / how versions and branding drift".
