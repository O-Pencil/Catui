# Remote Mobile Review

```yaml
review_id: remote-mobile-review
parent_doc: ../../feature-workflow.md §3
scope: modes/rpc protocol-core extraction, new modes/remote/ serve mode, apps/mobile web client, Capacitor APK packaging
status: closed
created_at: 2026-09-06
trigger: CLI user path change + >400 new lines + new npm deps (ws, qrcode) + load-bearing refactor of modes/rpc/rpc-mode.ts
outcome: landed-with-deferreds (see closure.md)
```

## Purpose

Pre-implementation review for the "Catui mobile companion" feature: a phone (APK) and
browser client that remotely control a Catui instance running on the user's PC.

Feature shape (user-confirmed):

- Client form: one TypeScript web UI (Vite + React 19 + Tailwind 4), packaged as an APK
  via Capacitor; the PC serves the same UI to browsers.
- Connectivity: LAN direct (IP:port + token + QR pairing) AND external access via
  built-in cloudflared quick tunnel (`--tunnel`); Tailscale works by pointing at the
  tailnet IP (no code).
- Scope: full control surface — prompt/steer/follow-up/abort, streaming display, tool
  calls, session new/switch/list, model + thinking switching, extension UI dialogs.

## Why This Triggers §3 (special review, not plain code review)

| Trigger | How it hits |
|---|---|
| CLI user path change | New `--serve/--port/--host/--tunnel` flags alter `main.ts` dispatch and the stdin guard |
| Load-bearing refactor | `modes/rpc/rpc-mode.ts` handleCommand core is extracted into a shared module while stdio RPC behavior must stay identical (IDE clients + `test/rpc-command-catalog.test.ts` depend on it) |
| New npm deps | `ws` (WebSocket server) + `qrcode` (terminal QR) in root `dependencies` |
| >400 lines | New mode directory + a full web app |
| Public API diff | `RpcCommand`/`RpcResponse` gain an additive `list_sessions` variant (re-exported through the root SDK barrel) |

## Architecture Decision Summary

1. **Layer placement** (feature-workflow §2b decision tree): a network server mode is a
   new I/O paradigm — like interactive/print/rpc/acp — so the server lands in
   `modes/remote/`. The mobile web app is a build artifact producer, not host runtime
   code, so it lands outside the published package in `apps/mobile/` (NOT in root
   workspaces). See RM01, RM03.
2. **Protocol reuse, not re-invention**: the WebSocket carries the existing
   `RpcCommand`/`RpcResponse` + `AgentSessionEvent` + `RpcExtensionUIRequest` messages
   one-JSON-per-text-frame — mirroring the proven stdio RPC line protocol. The command
   handling core is extracted from `rpc-mode.ts` into `modes/rpc/rpc-command-handler.ts`
   shared by both transports. See RM01, RM04.
3. **Security posture**: per-run 192-bit random token, timing-safe comparison, per-IP
   lockout; static web shell served without auth (token gates the WS); public tunnel
  exposure treated as RCE-equivalent surface. See RM02, RM05.

## Current Finding Set

| Finding | Status | Purpose |
|---------|--------|---------|
| [RM01](./RM01-transport-seam-extraction.md) | ✅ accepted | Where the shared RPC command handler lives; rpc-mode behavior preservation |
| [RM02](./RM02-security-token-tunnel.md) | ✅ accepted | Token model, public-tunnel exposure, static-asset auth trade-off |
| [RM03](./RM03-static-asset-publish-boundary.md) | ✅ accepted | apps/mobile outside workspaces; public dir lifecycle; npm publish cleanliness |
| [RM04](./RM04-multi-client-routing-resync.md) | ✅ accepted | Broadcast vs reply routing; extension UI first-response-wins; reconnect resync; `list_sessions` API diff |
| [RM05](./RM05-cloudflared-tunnel-lifecycle.md) | ✅ accepted | cloudflared spawn/parse/teardown; Windows binary detection; graceful degradation |
| [RM06](./RM06-cli-flag-surface.md) | ✅ accepted | `--serve/--port/--host/--tunnel` surface; stdin consumption guard |
| [RM07](./RM07-new-deps-justification.md) | ✅ accepted | Why `ws` and `qrcode`; alternatives considered |

## Acceptance

- Five automated gates green at the end: `verify:dip`, `verify:quality`,
  `verify:package-boundary`, `build`, `tsc --noEmit`, plus `test:commands` proving the
  rpc-mode refactor is behavior-neutral.
- Manual end-to-end: serve mode on Windows host, browser client full control surface,
  reconnect drill (lock screen mid-stream → snapshot + `message_end` self-heal), tunnel
  path via trycloudflare.com from a cellular network.
- `closure.md` written with landed/deferred/reopen conditions before merge.
