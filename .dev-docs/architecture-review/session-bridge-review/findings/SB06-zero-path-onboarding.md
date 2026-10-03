# SB06 — Ship a path-free connection flow

Status: implemented, 2026-10-02. Explicit user request: make the
published feature as convenient as possible for ordinary users.

## Problem and owner

SB01 requires a manually configured extension path and a separately assembled
personal plugin. Publishing the npm package alone leaves ordinary users unable
to follow a short setup flow. The owner remains session-bridge under extensions.

## GB-2 default-load declaration

Register the bridge command by default, retaining its current optional directory
for compatibility with explicit installations. Registration creates no server,
files, timer, process, model call or prompt injection. Only `/bridge start` opens
the local control boundary. `--no-extensions` and explicit extension loading keep
their existing meaning. Registry risk is command/external-process, with lifecycle
and external-process tests. Public SDK/protocol exports remain unchanged.

## Onboarding decision

On explicit start, offer one first-use installation confirmation in the TUI.
Distribute the client with Catui and materialize a Catui-owned local marketplace;
use supported `codex plugin marketplace add` and `codex plugin add` commands, with
argument arrays, bounded runtime/output and no shell or downloaded scripts.
Do not alter the user's personal marketplace or unrelated Codex settings by hand.
Headless mode never assumes confirmation; `/bridge setup` explicitly retries setup.
Record successful setup only after CLI success; changes to bundled client files
produce a new plugin version and require reinstall. No public directory listing
is required for this local distribution path.

## UX and acceptance

`/bridge` gives a small action menu. `/bridge start` works after an ordinary Catui
upgrade without paths. Show waiting vs last authenticated client contact; never
equate installation with connection or submission with task success. Expose the
current bridge ID in a ready-to-copy Codex prompt. Stop removes the status badge.
Cover fresh setup, decline, failure/retry, repeated setup, changed client assets,
missing CLI, paths with spaces, default registry and npm package contents. Exercise
installation with the real Codex CLI using a temporary Catui-owned marketplace.
Check that its name is absent first, remove only smoke-created plugin/marketplace
entries afterward, and verify that the existing personal plugin is unchanged.

## Real CLI finding

Changing a registered marketplace's root during an upgrade is rejected by Codex.
The root and `./plugins/catui-bridge` source path now remain stable. An atomic
symlink selects an immutable content-versioned plugin directory within that root.
Fresh install, same-version reinstall and a changed-version upgrade passed with
the real CLI. The production installer uses argument arrays and fixed selectors.
