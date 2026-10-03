# SB01 — Same-session authority and honest receipts

Status: implemented; live user-session activation remains a manual acceptance step.

## Evidence

- `modes/rpc/` creates a separate RPC mode; starting it cannot attach to an existing TUI.
- Extension `sendUserMessage` delegates to the host and returns void. Host prompt
  errors are reported asynchronously, so HTTP acceptance cannot prove delivery.
- The extension context already owns session identity, idle/pending state and abort.

## Decision

Use the existing context through five narrow capabilities in an optional extension.
No core runtime or public protocol changes. Require `/bridge start`, bind every
write to the session, bind cancellation to a fresh run ID, and revoke on lifecycle
changes. Keep idempotency records until stop and reject overflow instead of evicting.
Report `submitted` immediately and `observed` only after the matching user event.

## Verification and limits

HTTP/MCP tests exercise session identity, stale cancellation, retry deduplication,
registry permissions, bounded payloads and lifecycle cleanup. The production
extension is exercised with a controlled host and with a production SDK-created
AgentSession whose busy state is simulated. Both real host queues and reload are
checked. Tests do not claim a real provider run or delivery to the user's ongoing
MiniMax session.

Stopping the bridge prevents new submissions. It does not retract messages
already handed to the host. Same-user local processes can read the private token;
this design separates users and browser origins, not hostile processes under the
same OS account. Reopen if durable delivery acknowledgements, Windows support,
remote access or queue retraction become requirements.
