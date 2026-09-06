# RM02: Security model — token, tunnel exposure, static assets

```yaml
finding_id: RM02
severity: load-bearing
lenses: [security, trade-off]
files_primary:
  - modes/remote/remote-server.ts (new)
  - modes/remote/remote-mode.ts (new)
status: accepted
```

## Problem

Serve mode exposes a full control surface — including the `bash` command — to a
network listener. With `--tunnel`, that listener is reachable from the public
internet. The token is therefore equivalent to remote code execution on the host.

## Threat Model

| Threat | Mitigation |
|---|---|
| Token brute force | 192-bit `crypto.randomBytes(24).toString("base64url")`, per-run, never persisted; comparison via sha256 both sides + `crypto.timingSafeEqual` (avoids length leak) |
| Online guessing | Per-IP failure counter: 5 failed upgrades → 60s cooldown (in-memory) |
| Token leakage | QR rendered only in the host terminal; never in `/healthz` or logs beyond the banner; docs instruct "treat the QR like a password" |
| Public tunnel abuse | trycloudflare.com URL is unguessable-ish but public; token remains the only gate — documented; Tailscale recommended as the safer external path |
| Static shell snooping | Accepted trade-off: web app shell is a generic client with no secrets (see below) |

## Static Assets Without Auth — Accepted Trade-Off

The web UI shell (`/`, `/assets/*`) is served without token auth so the browser flow
is a single URL. Rationale:

- The shell contains no session data, no secrets — it is the same code the APK ships.
- The WebSocket endpoint (`/ws?token=...`) is the real gate; without it the shell is inert.
- Requiring auth on static files would force a login interstitial and add no security
  (an attacker with the URL but no token gains nothing).

## Residual Risks (documented, not mitigated in v1)

- `bash` command surface = RCE for any token holder. No allowlist in v1 (the mobile
  client is the owner's own PC controller, mirroring stdio RPC trust model).
- No TLS on LAN (`ws://`); mitigated by LAN being a private network. Tailscale
  provides encrypted transport for external use; cloudflared provides TLS at the edge.
- No per-command audit log in v1; deferred (see closure).
