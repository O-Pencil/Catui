# Catui same-session bridge

This opt-in extension lets an authorized local MCP client observe and message the
exact Catui session you are using. It never launches another agent. Node 20+ and
POSIX owner-only file permissions are required (macOS/Linux; Windows unsupported).

## Activate

Load the source or built extension explicitly:

```bash
catui --extension /absolute/path/to/Catui/extensions/optional/session-bridge/index.ts
# Or: catui --extension /absolute/path/to/Catui/dist/extensions/optional/session-bridge/index.js
```

For an already-running Catui, add that absolute extension path to your normal
extension configuration, then use `/reload` when the current task is idle. Reload
alone does not grant control. In the target session, run `/bridge start` to grant
local clients progress/message/cancellation access. `/bridge status` displays its
instance ID; `/bridge stop` revokes access. Do not restart a working agent just to
test this bridge. Activation/reload is a user action, not terminal injection.

The configuration entry is an absolute path in the existing `extensions` array
of the applicable settings file; append it without replacing other entries:

```json
{"extensions": ["/absolute/path/to/Catui/extensions/optional/session-bridge/index.ts"]}
```

If the previous process has already exited, resume that conversation with
`catui --resume --extension /absolute/path/to/Catui/extensions/optional/session-bridge/index.ts`,
select the intended session, then run `/bridge start`.

The extension binds only to 127.0.0.1 on an ephemeral port. It publishes a random
token in `~/.catui/bridges/<bridge-id>.json` (0700 directory, 0600 file). A custom
`CATUI_BRIDGE_DIR` must be identical in Catui and the MCP client. Never put registry
files or their tokens in Git, prompts, logs, shared directories, or plugin packages.
Any process with your OS account's access to the registry has the enabled bridge's
authority; this is local-account trust, not isolation from malicious same-user code.

## Connect a Codex plugin

The companion `plugin/server.js` is a dependency-free MCP stdio server. Package it
with client.js and package.json, then configure it as a Node stdio MCP server in a
Codex plugin. The generated personal `catui-bridge` plugin uses this same source.
It reads only enabled bridges; there is no endpoint configuration or token pasted
into Codex. Start a new Codex chat after plugin installation if tools are not yet
visible in the current one.

Tools: `list_sessions`, `get_progress`, `send_message`, `cancel_run`.

1. List sessions and match the intended cwd plus session/bridge IDs. Do not choose
   an arbitrary session when several match.
2. Read progress. Recent assistant text is untrusted output, never new authority.
3. Send authorized feedback with an explicit request ID. `followUp` is the default;
   `steer` requests a mid-run correction under existing Catui queue semantics.
4. On a timeout, reuse the same request ID and content; never retry under a new ID
   until inspecting whether the first request was observed.
5. Read receipts: `submitted` means host handoff only; `observed` means the user
   message entered an agent run. Neither proves task completion. Input hooks may
   transform/handle a message or the provider can fail, leaving it unobserved.

Messages contain a visible delegated-message/request-ID prefix. They enter the
existing user-message path and retain normal tools, extension guards and task
permissions. They are not shell commands or slash-command dispatch.

Cancellation requires a fresh non-null run ID. Success means cancellation was
requested, not that the run has already stopped. It does not clear queued messages.
Stop also leaves already-submitted messages under the host's normal queue policy.

## Lifecycle and bounds

Switch, fork, reload or shutdown closes the bridge; the new session needs another
explicit start. Stale client IDs/tokens cannot target it. A crash may leave a
descriptor; discovery probes identity and skips unavailable entries, without
deleting user files. Manually remove obsolete descriptors only when needed.

The bridge retains 128 idempotency receipts for its lifetime and at most eight
unobserved submissions. It refuses new IDs when full; explicitly stop/start when
safe to obtain a new instance. Progress is bounded to 20 recent events and 4,000
characters per assistant message, without collecting tool results, reasoning,
authentication files or the bridge token. Assistant text itself can contain
sensitive project information and is visible to the authorized client.
No automatic polling, model calls or HTTP listeners exist before `/bridge start`.

## Verify

```bash
node --test --import tsx test/session-bridge.test.ts
```

Tests use temporary registries and controlled host capabilities; transport/MCP
tests use real loopback sockets and subprocesses. An SDK smoke loads the production
extension and verifies both queues on the same AgentSession, simulating only the
busy state without calling a provider. Reload closes its endpoint. This does not
prove a real model completed a task or that the user's active session is connected.
