# RM05: cloudflared quick tunnel lifecycle

```yaml
finding_id: RM05
severity: operational
lenses: [robustness, windows]
files_primary:
  - modes/remote/tunnel.ts (new)
status: accepted
```

## Problem

External access must work without the user owning a domain or running a relay. The
cloudflared quick tunnel (`cloudflared tunnel --url ...`) gives a free ephemeral
public URL (trycloudflare.com) with TLS + WebSocket support. It is the same pattern
proven by permissionnine9/claude-code-remote-control.

## Lifecycle Design

1. **Binary discovery**: `CLOUDFLARED_PATH` env override → `cloudflared` /
   `cloudflared.exe` on PATH (probe by spawning `--version`, catch ENOENT).
2. **Not found → degrade, never crash**: print install hints
   (`winget install --id Cloudflare.cloudflared` on Windows, `brew install cloudflared`
   on macOS) and continue LAN-only.
3. **Spawn**: `cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate`;
   parse stderr with `/https:\/\/[a-z0-9-]+\.trycloudflare\.com/`, 15s timeout.
4. **URL derivation**: `https://<sub>.trycloudflare.com` → WebSocket endpoint
   `wss://<sub>.trycloudflare.com/ws`; QR/banner prefer the public URL when present.
5. **Teardown**: kill the child on shutdown. On Windows, `child.kill()` does not
   reliably kill the process tree → `taskkill /PID <pid> /T /F` fallback.

## Accepted Limitations

- Quick tunnel URLs are ephemeral (change per run) — pairing is per-run by design
  (token is per-run anyway).
- cloudflared availability/rate is Cloudflare's; LAN + Tailscale remain the primary
  paths. Documented in `docs/remote.md`.
- No account-owned named tunnels in v1 (would enable stable URLs + Access policies);
  deferred (see closure).
