# apps/mobile/

Standalone Vite + React 19 + Tailwind CSS 4 web app that remote-controls a Catui agent over the serve-mode WebSocket. Packaged into an Android APK via Capacitor. Own package.json + lockfile; deliberately NOT part of the root npm workspaces (RM03: keep the React/Vite/Capacitor toolchain out of the root install).

## Members

| File | Purpose |
|------|---------|
| `package.json` | Own deps/lockfile; build = `tsc --noEmit && vite build` |
| `tsconfig.json` | Strict TS for src + config files; no repo-source imports |
| `vite.config.ts` | React + Tailwind 4 plugins; LAN-exposed dev server |
| `capacitor.config.ts` | APK shell config; allowMixedContent for ws:// LAN targets |
| `android/` | Capacitor 7 native project (tracked in git); AndroidManifest carries cleartext + `catui://connect` deep-link intent-filter; build outputs ignored |
| `index.html` | SPA entry (whitelisted from the root `*.html` gitignore rule) |
| `src/protocol/types.ts` | Wire-level mirror of modes/rpc/rpc-types.ts (server stays canonical — repo source types can't be imported without pulling the whole repo type graph) |
| `src/protocol/client.ts` | RemoteClient: WS transport, id correlation, backoff reconnect |
| `src/connection/connection-store.ts` | Connection target + history (persisted via @capacitor/preferences); deep link + page URL parsing |
| `src/connection/ConnectScreen.tsx` | QR scan / manual pairing / saved endpoints |
| `src/connection/QrScanner.tsx` | jsQR camera scanner (APK secure context; browser needs HTTPS) |
| `src/state/session-store.ts` | Session mirror: snapshot hydration + event reducer + actions |
| `src/state/wiring.ts` | Singleton wiring: client <-> stores; deep link handling; connect/disconnect flows |
| `src/views/ChatView.tsx` | Layout: header, transcript, composer, overlays |
| `src/views/Transcript.tsx` | Message list; auto-scroll; toolResult index |
| `src/views/MessageBubble.tsx` | User bubble; assistant markdown + thinking + tool calls |
| `src/views/ToolCallCard.tsx` | Collapsible tool invocation + result |
| `src/views/Composer.tsx` | Prompt / steer / follow-up / abort; slash palette |
| `src/views/SessionDrawer.tsx` | list_sessions + switch + new session |
| `src/views/ModelSheet.tsx` | Model picker + thinking level chips |
| `src/views/ExtensionDialog.tsx` | select/confirm/input/editor/openExternalEditor overlays |
| `src/views/Toaster.tsx` | notify/status toasts |

## Build flows

- Web bundle: `cd apps/mobile && npm install && npm run build` -> `dist/`
- Root integration: `npm run build:mobile-web` (repo root) builds and copies into `modes/remote/public/`
- Native project: `npx cap add android` (Capacitor 7 — requires Node >= 20; the scaffold is tracked, only needed on fresh setup)
- APK: `npm run cap:sync && cd android && ./gradlew assembleDebug` (needs JDK 21 + Android SDK 35); output at `android/app/build/outputs/apk/debug/`

## Constraints

- No imports from repo source (../../..) — the standalone lockfile cannot resolve them; protocol shapes are mirrored in `src/protocol/types.ts`
- Gitignored: `node_modules/`, `dist/`, `android/` build artifacts, `android/app/src/main/assets/public/` (cap sync output), APKs
