# Same-session control bridge

Status: implemented; local acceptance recorded in [closure.md](./closure.md), 2026-10-02.

## Scope and placement

Add a default-loaded, inactive `extensions/optional/session-bridge/` command. A user starts it
with `/bridge start` inside an existing session. Its loopback server delegates to
that extension's existing context/API, never a new AgentSession or RPC subprocess.
The Codex plugin is a thin stdio MCP client, with no dependency on Catui internals.
SB07 adds a generic extension-host supervision primitive; feature state and effects
remain extension-owned. No public protocol package or dependencies change. Default command loading
is an intentional GB-2 behavior change requested for path-free onboarding.

## Findings and decisions

Finding card: [SB01 — Authority and receipts](./findings/SB01-authority-and-receipts.md).
Follow-up: [SB06 — Path-free onboarding](./findings/SB06-zero-path-onboarding.md).
Follow-up implemented: [SB07 — Supervised execution](./findings/SB07-supervised-execution.md).

- SB01: RPC has appropriate prompt/steer/follow-up semantics but starting another
  RPC process cannot control an existing interactive session. Use extension-owned
  lifecycle and existing `sendUserMessage` / `abort` capabilities.
- SB02: `sendUserMessage` returns void and host errors are asynchronous. A receipt
  must mean submitted, not delivered. Confirm observation through `message_start`
  user events. Never promise completion or provider success from HTTP acceptance.
- SB03: Stale targets and retry ambiguity matter. Use a random bridge-instance ID,
  exact session binding, a run ID for cancellation, bounded idempotent receipts,
  and revoke on switch/fork/reload/shutdown. No automatic re-enable after a switch.
- SB04: A bridge grants local control. Require an explicit start command, random
  bearer secret stored in an owner-only registry, loopback bind, no browser Origin,
  bounded input/output and no shell dispatch. SB07 supersedes the initial no-slash
  restriction with owner-declared command invocation. The plugin never emits secrets.
- SB05: Computer Use cannot control Codex UI. This feature exposes a new authorized
  Catui API, not terminal keystroke injection or a workaround to control Codex UI.
- SB06: Ship the client with Catui; offer first-use installation through Codex CLI,
  with no paths, keys or ports for users to configure. Distinguish installation,
  waiting and authenticated client contact. No automatic control on startup.

## Acceptance

Real HTTP plus stdio MCP integration tests must cover exact same context delivery,
busy follow-up/steer, receipts/retries, wrong sessions/run IDs, auth/origin rejection,
bounded requests, session switch, restart/cleanup, stale registry entries, and
plugin initialization/tool discovery. Verify the five repository gates, package
boundary after build, focused existing runtime tests, and plugin validation.
Real UI activation requires the user to start the bridge explicitly;
do not interrupt the ongoing MiniMax session or claim live delivery without receipt.

## Delivery

Independent worktree/branch; user authorized merging PR #22 after the SB07 work
and acceptance. No npm release in this change. Keep the current MiniMax
checkout unchanged. A bundled local marketplace packages the tested dependency-free
MCP client through the approved setup command. Installation and runtime activation
are separately reported; a public plugin-directory listing is not required.
