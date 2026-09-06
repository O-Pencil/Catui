# Remote Mobile Review — Closure

```yaml
review_id: remote-mobile-review
status: closed
closed_at: 2026-09-06
outcome: landed-with-deferreds
```

## Landed

| Piece | Files |
|---|---|
| Transport-agnostic RPC protocol core (RM01) | `modes/rpc/rpc-command-handler.ts` (extracted from rpc-mode.ts; stdio behavior preserved, `test:commands` 29/29) |
| Protocol extension (RM04) | `list_sessions` command + `RpcSessionListEntry` in `modes/rpc/rpc-types.ts` |
| Serve mode (RM02, RM05, RM06) | `modes/remote/` — remote-mode.ts (entry/token/lifecycle), remote-server.ts (HTTP static + token-gated WS), connection-info.ts (LAN IPs + QR + deep link), tunnel.ts (cloudflared quick tunnel) |
| CLI surface (RM06) | `--serve/--port/--host/--tunnel` in `cli/args.ts`, dispatch + stdin guard in `main.ts` |
| Mobile web client (RM03, RM04) | `apps/mobile/` — Vite + React 19 + Tailwind 4, own lockfile outside root workspaces; protocol mirror, connection store, session store, chat/session/model/extension-dialog views |
| Build pipeline (RM03) | `scripts/build-mobile-web.js` + root `build:mobile-web` script → copies bundle into `modes/remote/public/` (gitignored); `copy-assets.js` extended |
| APK shell | `apps/mobile/android/` Capacitor scaffold (tracked in git); AndroidManifest: `usesCleartextTraffic` + `catui://connect` deep-link intent-filter |
| New deps (RM07) | root: `ws`, `qrcode`; apps/mobile: `@capacitor/*`, `jsqr`, `zustand`, `react-markdown` |
| DIP sync | root AGENTS.md (topology/directory/run-modes/build cmds/P2 nav), `modes/AGENT.md`, `modes/rpc/AGENT.md`, `cli/AGENT.md`, `apps/mobile/AGENTS.md`, `config.ts` P3, five P3 headers in apps/mobile/src |
| User doc | `docs/remote.md` |

## Acceptance gates (all green, 2026-09-06)

- `verify:dip` — 658/658 P3 headers valid, 35 P2 modules checked
- `verify:quality` — 723 files scanned
- `verify:package-boundary` — passed
- `npm run build` (root) — full pipeline incl. minify
- `npx tsc --noEmit` (root) + `apps/mobile` build — both green
- `test:commands` — 29 pass / 0 fail (proves the rpc-mode extraction is behavior-neutral)
- Manual browser E2E on Windows host: auto-pairing via token URL, model sheet, session drawer (list/switch/new), streaming replies, zero console errors

## Deviations from plan

1. **Capacitor 8 → 7.** `cap add` failed on Node 20 (Cap v8 requires Node >= 22; box has 20.20 via nvm4w). Downgraded all `@capacitor/*` to `^7.0.0` (engines: node >= 20). No API surface used by this app differs between 7/8. Revisit if the repo ever standardizes on Node 22+.

## Hardening sweep (2026-09-07, pre-device-test)

Pre-test review found and fixed three gaps + one permission miss:

1. **QR endpoint picked a virtual NIC** (`addresses[0]` = VMware 192.168.13.1 on the dev box) — first scan from a phone would target an unreachable address. Fixed twice over: (a) `getLanIPv4Addresses()` now orders by MAC OUI (VMware/Hyper-V/WSL/VirtualBox prefixes) then by range (192.168/16, 10/8 first, 172.16/12 last); (b) the deep link carries the remaining addresses via `alt=` and `RemoteClient.connect()` rotates through them during initial pairing (no backoff — host discovery), remembering the endpoint that worked. Verified on the dev box: 192.168.0.17 now orders first.
2. **Stale-token dead end** — after a `--serve` restart the app showed "Reconnecting…" forever with no hint. `wiring.ts` now tracks `everConnected`; a drop before the first open sets `connectFailed`, and ChatView renders a red banner ("token changes every server restart — re-scan or enter manually") instead of the amber reconnecting bar.
3. **Release pipeline could ship without the web UI** — `modes/remote/public/` is gitignored and `build:release` didn't build it. `build-mobile-web.js` gained `--strict` (exit 1 instead of silent skip) and `build:release` now chains `build:mobile-web -- --strict && npm run build`; AGENTS.md release flow updated.
4. **Missing CAMERA permission in AndroidManifest** — Capacitor bridges the WebView `getUserMedia` permission request, but only for manifest-declared permissions. Added `android.permission.CAMERA` + non-required camera feature; APK rebuilt (4.1 MB).

## Device-test round 1 (2026-09-07): scan-to-pair parse bug + diagnostics

First on-device scan failed with the stale-token banner. Root cause was not the network or the token — it was a **deep-link parsing bug**: WHATWG `new URL("catui://connect?...")` parses `host: "connect"`, `pathname: ""`, but `parseConnectDeepLink()` checked `pathname === "//connect"` (always false). Worse, `handleScan`'s serve-URL fallback then built an endpoint from `url.host` — literally `ws://connect/ws`. Every scan connected to a garbage endpoint and surfaced as a pairing failure. Fixes shipped in the same APK:

1. `parseConnectDeepLink()` now checks `url.host === "connect"`; the scan fallback only accepts `http:`/`https:` payloads.
2. **Pairing diagnostics**: `/healthz` is now CORS-open and accepts `?token=` → `tokenValid` (verified: wrong token false, right token true, CORS `*`). On pairing failure the app probes every advertised endpoint and classifies: 网络可达但令牌无效 (re-scan) / 无法连通 (WiFi、AP 隔离、防火墙) / 可达且令牌有效 (transient, auto-retry). New `PairingDiagnostics.tsx` sheet with a 复制诊断信息 button (plain-text report: time, target, per-endpoint results, UA) for bug reports.
3. **Chinese UI for the pairing flow** (user request): connect screen, QR scanner, status banners, diagnostics panel. The mobile app is the one surface exempt from the English-only string policy (documented in `docs/remote.md`).

Known limitations accepted at close (candidates for a future review): no image attachments from the phone composer (protocol supports `ImageContent`, UI doesn't); no local notification when a long task finishes while the app is backgrounded; serve mode and the interactive TUI must not open the same session file concurrently (single-writer); APK still uses the default Capacitor icon; Windows firewall may prompt per node.exe path (npm link changes the path).

## Deferred (user environment)

1. ~~**`gradlew assembleDebug`**~~ — **DONE 2026-09-07**: built via a portable toolchain (Temurin JDK 21 zip + Android cmdline-tools at `D:\android-tools\`, no admin needed; Gradle dist fetched once from the Tencent mirror then `distributionUrl` reverted). Output: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` (4.1 MB), copy kept at repo root `catui-mobile-debug.apk` (gitignored). Rebuild path documented in `docs/remote.md` + `apps/mobile/AGENTS.md`.
2. **Cellular tunnel drill** — `--tunnel` verified to spawn/parse/teardown locally; an actual off-LAN trycloudflare round-trip is pending a real phone.
3. **On-device QR scan + deep link** — camera QR and `catui://connect` need the installed APK; browser-side pairing is verified. APK is now available for install.

## Reopen conditions

- Node upgraded to >= 22 and Capacitor bumped back to 8 (re-run `cap sync`, verify manifest survives).
- Any change to `RpcCommand`/`RpcServerMessage` shapes: update `modes/rpc/rpc-types.ts` AND the mirror in `apps/mobile/src/protocol/types.ts` in the same PR (document isomorphism rule).
- Multi-client concurrency beyond broadcast + first-response-wins (RM04) requires a real routing table — reopen RM04.
- Tunnel hardening (persistent named tunnels, auth in front of the public URL) — reopen RM05/RM02 before recommending `--tunnel` for untrusted networks.
