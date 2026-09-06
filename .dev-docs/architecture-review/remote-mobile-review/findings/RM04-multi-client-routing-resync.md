# RM04: Multi-client routing, reconnect resync, and the `list_sessions` protocol extension

```yaml
finding_id: RM04
severity: protocol
lenses: [protocol, public-api, ux]
files_primary:
  - modes/rpc/rpc-types.ts
  - modes/rpc/rpc-command-handler.ts (new)
  - apps/mobile/src/protocol/client.ts (new)
status: accepted
```

## Multi-client routing (phone + browser simultaneously)

One shared `RpcCommandHandler` per server with a **broadcast default sink**
(session events, extension UI requests, extension errors fan out to all clients) and a
**per-call sink** (command replies and async prompt errors route only to the
requesting socket). Consequences:

- All connected clients see the same live transcript.
- Extension UI requests are answered first-response-wins (the existing
  `pendingExtensionRequests` map already deletes-before-resolve, so the second
  responder is a no-op). This is correct: the dialog is a single user interaction.

## Reconnect resync (client-driven; server keeps no replay log)

1. On WS open the client sends `get_state` + `get_messages` (id-correlated) and
   rebuilds its transcript from the snapshot.
2. If `state.isStreaming`, the UI renders a streaming placeholder; deltas missed
   during the disconnect are healed at event boundaries: `message_end` carries the
   full `AgentMessage` and `tool_end` carries full output (verified shapes in
   `core/lib/agent-core/src/types.ts`).
3. Session switch / new-session on the server continues on the same connection —
   `AgentSession.subscribe` listeners survive session switches.
4. Extension dialog raised while a client was offline: the server-side dialog promise
   has its own timeout/abort semantics; the offline client simply never saw the
   request. Accepted.

Heartbeat: protocol ping every 30s, pong timeout 10s → terminate; backpressure guard:
terminate at `bufferedAmount > 8MB` (phone screen-locked). Client auto-reconnects with
exponential backoff.

## `list_sessions` — Intentional Public-API Diff

The protocol today only has `switch_session` (requires a `sessionPath` the phone
cannot discover). The session drawer needs discovery. Additive union members on
`RpcCommand`/`RpcResponse` (both re-exported through the root SDK barrel):

```ts
| { id?: string; type: "list_sessions" }
| { id?: string; type: "response"; command: "list_sessions"; success: true;
    data: { sessions: Array<{ path: string; id: string; name?: string; modified: string;
            messageCount: number; firstMessage: string; parentSessionPath?: string }> } }
```

Backed by `SessionManager.list()` (core/session/session-manager.ts, returns
`SessionInfo[]`; Date → ISO string at the boundary). Additive union members are
non-breaking for existing consumers; declared as an intentional API diff in the PR
description per feature-workflow §5. `list_sessions` is also valid over stdio RPC
(IDE clients gain session discovery for free).
