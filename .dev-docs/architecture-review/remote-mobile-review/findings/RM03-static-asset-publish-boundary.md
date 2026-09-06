# RM03: Static asset & publish boundary for apps/mobile

```yaml
finding_id: RM03
severity: boundary
lenses: [DIP, publish, build]
files_primary:
  - apps/mobile/ (new)
  - package.json
  - scripts/build-mobile-web.js (new)
  - scripts/copy-assets.js
status: accepted
```

## Problem

The repo root declares npm workspaces (`core/lib/*`, `packages/*`). Adding the mobile
web app (React + Vite + Capacitor toolchain) to workspaces would drag the heavy client
toolchain into every root `npm install` and risk publish pollution of `catui-agent`.

## Decisions

1. **`apps/mobile` is NOT added to workspaces.** It keeps its own `package.json` +
   `package-lock.json`; root install stays lean; npm publish of the root package is
   structurally untouched (`files` already excludes everything except
   `dist/assets/docs/LICENSE/README.md`).
2. **Serving path**: the PC serves the web UI from a `public` directory resolved in
   order: `dist/modes/remote/public` (production, next to compiled server code), then
   `modes/remote/public` (tsx dev runs). If absent, the server responds with a minimal
   inline HTML notice ("Web UI not built — run `npm run build:mobile-web`") and the
   WebSocket endpoint stays fully functional (the APK keeps working regardless).
3. **Built assets are NOT committed.** `modes/remote/public/` is gitignored (the root
   `.gitignore` already ignores `*.html` globally — an explicit `!apps/mobile/index.html`
   un-ignore is required for the Vite source file). A maintainer producing a full
   release runs `npm run build:mobile-web && npm run build`.
4. **Root `npm run build` does NOT invoke the mobile web build.** Standard build speed
   is a protected property (startup/CI budget). New script `build:mobile-web`:
   if `apps/mobile/node_modules` is missing → print notice, exit 0 (non-fatal);
   else `npm --prefix apps/mobile run build` + copy `apps/mobile/dist` →
   `modes/remote/public`.
5. **`copy-assets.js`** gains a `copyTreeAssets(modes/remote/public →
   dist/modes/remote/public)` block — silent no-op when source missing (existing
   pattern).
6. **package.json `files`** gains `"dist/modes/remote/public"` so a release build that
   ran the web build ships the UI.

## Publish Cleanliness Check

- `apps/` never enters `files` or workspaces → never published.
- `ws`/`qrcode` are regular `dependencies` → `verify:package-boundary` unaffected
  (they are host deps used by `modes/remote/`, not internal lib boundary violations).
- `*.apk` gitignored; `android/` gradle build outputs gitignored.
