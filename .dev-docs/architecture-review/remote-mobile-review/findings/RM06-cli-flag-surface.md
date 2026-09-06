# RM06: CLI flag surface — `--serve/--port/--host/--tunnel`

```yaml
finding_id: RM06
severity: user-path
lenses: [cli, ux]
files_primary:
  - cli/args.ts
  - main.ts
status: accepted
```

## Surface

| Flag | Type | Default | Notes |
|---|---|---|---|
| `--serve` | boolean | off | Enter remote serve mode |
| `--port <n>` | number | 8787 | HTTP + WS listen port |
| `--host <addr>` | string | 0.0.0.0 | Bind address (loopback-only opt-in) |
| `--tunnel` | boolean | off | Spawn cloudflared quick tunnel (implies serve behavior when combined with `--serve`) |

## Dispatch Rules

1. **Stdin guard** (main.ts L287 region): the guard that prevents slurping piped stdin
   must include serve mode — `if (parsed.mode !== "rpc" && !parsed.acp && !parsed.serve)`
   — so `catui --serve` never consumes piped stdin meant for nothing.
2. **Dispatch order**: the `else if (parsed.serve)` branch is inserted before the
   `isInteractive` fallback, mirroring the `--acp` boolean-flag precedent. The runner
   is dynamically imported (`await import("./modes/remote/remote-mode.js")`) keeping
   the P6/EV02 startup budget: `ws`/`qrcode` load only in serve mode.
3. **`--port`/`--host`/`--tunnel` are only meaningful with `--serve`**: using them
   without `--serve` prints a warning and continues with normal mode selection
   (no hard error — matches the repo's lenient-flag posture for auxiliary flags).
4. **Help text**: `printHelp()` gains a "Remote" section with the four flags and the
   QR pairing story in one line.

## modes/index.ts barrel

`runRemoteMode` is exported from `modes/index.ts` for SDK surface parity (the CLI path
bypasses the barrel per P6/EV02 — dynamic import directly).
