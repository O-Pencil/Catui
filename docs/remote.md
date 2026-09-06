---
name: remote
description: Use when the user asks about controlling Catui from a phone, remote serve mode, the mobile APK, or QR pairing.
surface: "--serve --port <n> --host <addr> --tunnel; catui://connect deep link; apps/mobile APK"  # user entry points
owner: modes/remote/  # DIP P2 anchor — read its AGENT.md member list to find code
status: draft
---

# Remote Serve Mode (phone control)

> Run `catui --serve` on your computer, scan the printed QR code with your phone, and drive the same agent session from a phone browser or the Catui Android APK.

## When to use

- You want to kick off a long task on your PC and monitor/steer it from the couch.
- You want to send prompts, abort runs, switch models, or answer extension dialogs without sitting at the terminal.
- You are away from your LAN and still want to reach the session (`--tunnel`).

## Usage

### Start the server

```bash
catui --serve                 # default: 0.0.0.0:8787, prints QR + pairing URL
catui --serve --port 9000     # custom port
catui --serve --host 127.0.0.1   # restrict to localhost (pair from same machine only)
catui --serve --tunnel        # also spawn a cloudflared quick tunnel for external access
```

The banner lists every LAN IPv4 the server is reachable on, a QR code, and the one-time pairing token. The token is regenerated on every run — nothing long-lived is written to disk.

### Connect

1. **Phone browser (zero install)**: scan the QR code. It encodes `catui://connect?...` for the APK and a plain `http://<ip>:<port>/?token=...` URL; opening the URL in a browser pairs instantly.
2. **Android APK**: install the APK built from `apps/mobile`, then scan the same QR — the deep link auto-fills the endpoint and token. Recent endpoints are remembered locally on the device.

### Build the APK

Prerequisites: Node >= 20, JDK 21, Android SDK 35, and the Android SDK accepted via Android Studio or `sdkmanager`.

```bash
cd apps/mobile
npm install
npm run cap:sync              # web build + copy into the native project
cd android
./gradlew assembleDebug       # on Windows: gradlew.bat assembleDebug
# APK lands at android/app/build/outputs/apk/debug/app-debug.apk
```

The web UI is the same one served over HTTP, so you can also just keep using the browser.

## What the client can do

- Send prompts, steering mid-run messages, and follow-ups; abort a running turn
- Watch streaming replies, tool calls, and thinking blocks in real time
- Open the session drawer (`list_sessions`): switch, or start a new session
- Pick model and thinking level
- Answer extension dialogs (select / confirm / input / editor)

## Behavior & defaults

- Default bind `0.0.0.0:8787`. Prefer `--host 127.0.0.1` if you only pair from the same machine.
- WebSocket upgrade requires the token; wrong token gets HTTP 401 and the connection is dropped. The token also gates the very first message.
- LAN traffic is plain `ws://`/`http://` by design (same trust domain as your home network). The APK manifest allows cleartext and mixed content for this reason; browsers require HTTPS for camera QR scanning — use the APK for QR scans on LAN, or type/paste the token manually.
- `--tunnel` spawns a cloudflared quick tunnel (must be installed; it prints its own https URL). No account, no config; the URL is ephemeral and dies with the process.
- The phone client is a thin mirror: session state lives on the PC. Reconnect re-syncs the transcript automatically.
- Server stays up until Ctrl+C; both the tunnel and the HTTP server shut down together.

## Pairing failures & diagnostics

The mobile app tells network and token problems apart automatically. When pairing fails it probes every advertised endpoint via `/healthz` (CORS-open, token check included) and shows a red banner with a 诊断 (diagnostics) panel:

- ⚠️ 网络可达，但令牌无效 — the serve process restarted since the QR was shown. Re-run `catui --serve` and scan the fresh QR.
- ❌ 无法连通 — phone and PC are not reachable: different WiFi / guest network, router AP isolation, or Windows Firewall blocking the port (allow Node.js on private networks when prompted).
- ✅ 网络可达，令牌有效 — transient WebSocket failure; the client keeps retrying on its own.

The panel's 复制诊断信息 (copy diagnostics) button copies a plain-text report (time, target, per-endpoint results, user agent) for bug reports. Note: the mobile app UI is intentionally Chinese; it is the one surface exempt from the repo's English-only string policy.

## Code map → DIP

- Owner: `modes/remote/` — read its DIP **P2 member list** in `modes/AGENT.md` to locate files.
- Client app: `apps/mobile/` — see `apps/mobile/AGENTS.md`.
- Protocol core: `modes/rpc/rpc-command-handler.ts` (transport-agnostic; stdio RPC mode and the WebSocket server share it).
- Then follow **P3** file headers (WHO / FROM / TO / HERE) to navigate. Do **not** duplicate code paths here.

## Related

[[sdk]] [[models]] [[extensions]]
