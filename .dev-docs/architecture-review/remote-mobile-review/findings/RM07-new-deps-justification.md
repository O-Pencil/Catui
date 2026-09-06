# RM07: New dependency justification — `ws` and `qrcode`

```yaml
finding_id: RM07
severity: deps
lenses: [deps, minimal-surface]
files_primary:
  - package.json
status: accepted
```

## `ws` (^8.18.0) — WebSocket server

- **Need**: serve mode requires a WebSocket server. Node's built-in WebSocket
  (undici) is client-only; there is no server implementation in stdlib.
- **Alternatives considered**:
  - HTTP POST + SSE (zero new deps): rejected — two asymmetric channels, awkward
    client→server commands, no clean auth handshake reuse, harder reconnect semantics.
  - Hand-rolled WS over `node:http` upgrade: rejected — framing/masking/close-handling
    re-implementation is a known security hazard; `ws` is the de-facto standard,
  battle-tested, zero transitive runtime deps.
- **Placement**: root `dependencies` (used by `modes/remote/` at runtime after
  dynamic import — no startup cost for other modes). `@types/ws` in devDependencies.
- **Startup budget**: imported only inside `modes/remote/*` which main.ts
  dynamic-imports exclusively in serve mode → interactive startup unchanged.

## `qrcode` (^1.5.4) — QR generation

- **Need**: pairing UX — the phone scans a QR in the PC terminal instead of typing
  IP:port:token.
- **Alternatives considered**:
  - Printing the URL only: rejected — typing a 192-bit token on a phone is hostile;
    QR is the established pattern (Happy, claude-code-remote-control both use it).
  - Hand-rolled QR encoder: rejected — QR is a nontrivial spec (Reed-Solomon,
    masking); re-implementing is pure risk.
- **Usage**: `QRCode.toString(payload, { type: "terminal", small: true })` — half-block
  glyphs render correctly in Windows Terminal. `@types/qrcode` in devDependencies.

## Verdict

Both are leaf dependencies with wide adoption and no transitive runtime dependencies
of consequence; both are load-bearing for the feature's core UX. Accepted.
