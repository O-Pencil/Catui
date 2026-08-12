# CLI Output Disconnect Review

## Scope

Prevent the `catui` process from crashing when its stdout or stderr consumer
closes while the CLI is still rendering output. The change covers every CLI
path, including `--help`, `--version`, interactive, print, RPC, and ACP modes.

## Decision

- Owner: the CLI process boundary, installed before the fast paths emit output.
- Treat `EPIPE` as normal output-consumer shutdown.
- Preserve existing behavior for every other stream error.
- Do not add mode-specific guards or alter rendering, transport, or session
  behavior.

## Acceptance

- A real child process writing through a closed pipe exits without an unhandled
  stream error.
- An unexpected stream error remains observable.
- Type, architecture, package-boundary, build, and release-package gates pass.
