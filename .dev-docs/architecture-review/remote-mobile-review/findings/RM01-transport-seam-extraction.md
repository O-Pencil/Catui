# RM01: Transport seam — where the shared RPC command handler lives

```yaml
finding_id: RM01
severity: load-bearing
lenses: [seam, DIP, layer-fit]
files_primary:
  - modes/rpc/rpc-mode.ts
  - modes/rpc/rpc-command-handler.ts (new)
files_secondary:
  - modes/remote/remote-server.ts (new)
  - test/rpc-command-catalog.test.ts
status: accepted
```

## Problem

`runRpcMode` currently fuses three concerns in one file: transport (readline on stdin /
console.log to stdout), protocol core (the `handleCommand` switch over `RpcCommand`,
~L439-668), and extension-UI bridging (`pendingExtensionRequests` + dialog promises).
The remote serve mode needs the exact same protocol core over WebSocket. Duplicating
the switch would be Redundancy (same decision rules in two places); moving it to
`core/` would violate the `core/` MUST-NOT (hosting mode/protocol business).

## Options Considered

| Option | Verdict |
|---|---|
| A. Duplicate the switch in `modes/remote/` | ❌ Redundancy smell; every new RpcCommand would need two edits |
| B. Extract to `core/runtime/` | ❌ Violates core MUST-NOT: single-mode business; RPC protocol is a mode concern |
| C. New `modes/shared/` directory | ❌ Premature: only two consumers, both protocol-related |
| D. Extract to `modes/rpc/rpc-command-handler.ts`; remote mode imports it | ✅ The rpc directory is the protocol's natural home; precedent: `modes/index.ts` barrel and `modes/agent-loop-result-format.ts` already share across modes |

## Decision

Option D. `modes/` MUST-NOT "no cross-mode functionality" is not violated because
nothing moves *out of* a mode — a sibling mode consumes the rpc protocol module, the
same way the modes barrel does.

## Extraction Contract

```ts
export type RpcServerMessage =
  | RpcResponse
  | RpcExtensionUIRequest
  | AgentSessionEvent
  | { type: "extension_error"; extensionPath: string; event: string; error: string };

export interface RpcCommandHandlerOptions {
  session: AgentSession;
  /** Default sink: session events + extension UI requests + extension errors. */
  send: (message: RpcServerMessage) => void;
}

export class RpcCommandHandler {
  async bind(): Promise<void>;
  async handleCommand(command: RpcCommand, send?: (m: RpcServerMessage) => void): Promise<RpcResponse>;
  handleExtensionUIResponse(response: RpcExtensionUIResponse): boolean;
  get shutdownRequested(): boolean;
  async runShutdownHooks(): Promise<void>;
}
```

Semantics carried over verbatim:

- Extension UI requests always flow through the default (broadcast) sink; resolution
  is first-response-wins (existing `pendingExtensionRequests.delete(id)` before
  resolve already guarantees it).
- `prompt` stays fire-and-forget; its `.catch` routes through the per-call sink so a
  failed prompt replies to the requesting client only.
- The `theme` value import moves with the extension UI context unchanged.

## Behavior Preservation Test Plan

1. `test/rpc-command-catalog.test.ts` imports the three builders from
   `../modes/rpc/rpc-mode.js` — rpc-mode re-exports them, so the test stays green
   without edits.
2. `--mode rpc` manual smoke: prompt → streamed events on stdout → `get_state` →
   `abort` → extension dialog round-trip.
3. `npx tsc --noEmit` green (no import cycles: handler imports only node:crypto,
   agent-session, extensions-host, interactive/theme, rpc-types).
