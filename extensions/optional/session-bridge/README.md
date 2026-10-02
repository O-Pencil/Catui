# Catui same-session bridge

This built-in command lets an authorized local MCP client observe and message the
exact Catui session you are using. It never launches another agent. Node 20+ and
POSIX owner-only file permissions are required (macOS/Linux; Windows unsupported).

## Connect in three steps

1. Start Catui normally (or `catui --resume` to choose an existing conversation)
   and enter `/bridge start`. No extension paths or configuration files are needed.
2. On first use, confirm **Connect Codex**. Catui installs its bundled plugin through
   the installed Codex CLI. No account keys or ports to copy. Install/update Codex
   first if it is unavailable, then retry `/bridge setup`.
3. Open a new Codex chat and ask: **Connect to my Catui session and inspect its
   progress.** If several sessions are enabled, use the exact prompt shown by
   `/bridge status`. If the new plugin's tools are missing, restart Codex once.

`/bridge` opens an action menu. `/bridge status` shows waiting or the last
authenticated client contact; it does not infer a persistent connection from
installation success. `/bridge stop` disconnects. Start again explicitly after
switching, forking, reloading or restarting a session. To supervise continuously,
also ask Codex to schedule checks; the bridge itself is not a scheduler.

Subsequent starts skip setup for unchanged installed client assets. A changed
client or Node path prompts an update. `/bridge setup` explicitly repairs a removed
or disabled plugin even when Catui has a previous successful setup record. Setup
is optional: declining it leaves the bridge usable by an already configured client.
Headless sessions never assume installation consent; use interactive Catui for setup.

The command is default-loaded but inactive. It adds no listeners, processes, model
calls, files or prompt content until used. Existing explicit extension paths remain
compatible. An older running Catui process must first finish and restart on the
new version; `catui --resume` preserves the chosen conversation.

The extension binds only to 127.0.0.1 on an ephemeral port. It publishes a random
token in `~/.catui/bridges/<bridge-id>.json` (0700 directory, 0600 file). A custom
`CATUI_BRIDGE_DIR` must be identical in Catui and the MCP client. Never put registry
files or their tokens in Git, prompts, logs, shared directories, or plugin packages.
Any process with your OS account's access to the registry has the enabled bridge's
authority; this is local-account trust, not isolation from malicious same-user code.

## Distribution and developer details

The companion `plugin/server.js` is a dependency-free MCP stdio server. The npm
package contains its runtime files and setup code. On confirmation, Catui builds a
private, content-versioned local marketplace under `~/.catui/codex-bridge/` and
uses `codex plugin marketplace add` followed by `codex plugin add`. It never edits
the personal marketplace or Codex TOML by hand. Codex installs its own cache copy;
the MCP command pins the running Node executable and the chosen bridge registry.
This local distribution needs no public-directory listing or Git clone.

Official packaging reference: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins).
Setup commands have bounded output and timeouts and use argument arrays, not a shell.
Completed setup is recorded only after both commands succeed. The record is a
setup receipt, not proof the plugin remains enabled or that a client has connected.

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
node --test --import tsx test/session-bridge.test.ts test/session-bridge-setup.test.ts
```

Tests use temporary registries and controlled host capabilities; transport/MCP
tests use real loopback sockets and subprocesses. An SDK smoke loads the production
extension and verifies both queues on the same AgentSession, simulating only the
busy state without calling a provider. Reload closes its endpoint. This does not
prove a real model completed a task or that the user's active session is connected.
