# Same-session bridge closure

Date: 2026-10-02. SB06 and SB07 local implementation acceptance passed. The user
authorized merging PR #22 after current-head CI. Live MiniMax activation and npm
publication remain separate; no provider call is claimed by these tests.

## Delivered

- Default-loaded inactive command owns explicit activation, session/run binding, idempotent
  submission receipts and lifecycle cleanup through existing host capabilities.
- Authenticated loopback HTTP and an owner-only local descriptor registry.
- Dependency-free MCP client with discovery, progress, message and cancellation tools.
- First-use plugin installation through a Catui-owned local marketplace; no user
  paths, keys or ports. `/bridge` menu, `/bridge setup` repair, waiting/contact badge.
- Personal prototype plugin remains installed locally. Production installer uses
  its own `catui-bridge-local` source; temporary installation tests were cleaned.
- P2/P3 maps, usage documentation and this review. `test:tools` includes bridge tests.
- SB07 adds live command discovery, owner snapshots, idempotent asynchronous command
  operations and delegated decisions. Goal/Grub reuse existing handlers and leases;
  Plan exposes full content and standard approval with stale-content rejection.
- A generic optional host capability preserves old runtime construction. Unknown
  commands stay local-only. Clarification previews are retained in question text;
  cancelling Plan selection no longer falls through into approval.

## Verification

| Check | Result |
| --- | --- |
| `npm run verify:dip` | Pass |
| `npm run verify:quality` | Pass |
| `npm run verify:package-boundary` | Pass |
| `npm run build` | Pass |
| `npx tsc --noEmit` | Pass |
| `npm run verify:package-boundary:dist` | Pass |
| `npm run test:tools` | 49 passed, including 26 bridge/setup/supervisor cases |
| Registry policy tests | 10 passed; default command declaration covered |
| `npm run test:commands` | 29 passed |
| `npm run test:runtime-owners` | Pass |
| `npm run test:harness-critical` | 252 passed; harness eval passed |
| Plan/questions/event bridge/next-step/soul regression | 37 passed |
| Tool registry (Vitest runner) | 26 passed |
| Plugin manifest validator | Generated production plugin passed in temporary Python environment |
| Actual `npm pack` artifact | Built command, installer and client present; default path resolves |
| Real Codex CLI from packed installer | Fresh install, repeat install and changed-version upgrade passed |

The SDK smoke loads the actual extension into a real AgentSession and checks both
host queues and reload revocation with only provider busy state simulated. HTTP
and MCP subprocess tests use real transports. No paid/live model result is claimed.

The initial `npm ci --ignore-scripts --no-audit --no-fund` failed on the existing
lockfile: @types/node 22.19.15 did not satisfy 22.20.5 in this local resolver.
Dependencies were installed with `npm install --ignore-scripts --no-audit
--no-fund --package-lock=false`; no dependency or lockfile change is included.
Remote CI uses its own Node/npm versions and must be checked independently.

## PR self-review

No root SDK export or protocol package changed. Intentional additive host API:
optional `ExtensionAPI.supervision`, command supervision metadata, delegatable UI
options, context supervision flag and optional command error result. Older runtime
objects initialize supervision on runner construction. Generic mechanics live in
the host; business behavior stays with each extension. Default command registration
is deliberately changed under SB06/GB-2; control stays explicitly activated. The
standalone client has no Catui imports. One existing event-result test was updated
to the extracted ExtensionEventBridge owner instead of a removed private method.
No automatic model call or prompt injection. Enabling the
bridge creates one local listener; explicitly sent feedback adds normal user
message tokens including a visible delegation prefix. Existing permission and
input-hook behavior applies. Default startup additionally registers the command
without opening a listener, creating files or launching processes. The setup
subsystem loads lazily on a user command and asks before installing the plugin.

## Deferred and reopen conditions

- User must explicitly activate in the intended live session; installed plugin
  alone is not connected. New Codex threads pick up the plugin tools. The UI
  distinguishes waiting from last authenticated client contact, not continuous
  liveness. Timed supervision remains a separate Codex scheduling request.
- POSIX only; remote access, Windows and durable delivery acknowledgement are not
  supported. Reopen with an explicit requirement and separate boundary review.
- `submitted` is host handoff; `observed` is a matching user event. Neither means
  completion. Stopping the bridge does not retract queued messages.
- Same-user local processes are trusted. Assistant progress may contain sensitive
  project content. The private bridge token is not exposed in tool results.
- Production setup works on each user's machine from the npm package. It uses
  supported Codex CLI commands with a fixed marketplace root/source path and an
  atomic symlink to content-versioned client files. A successful setup marker is
  not a live inventory of plugins; `/bridge setup` repairs deletion/disablement.
- A public plugin-directory listing is not included or required by local setup.
- Settings/login/session switching, third-party commands without owner metadata,
  external editors, teammate approval and permission elevation remain local-only.
  This is explicitly discoverable, not a claim that every slash/UI surface is remote.
- Operation `handler_finished` is not task acceptance; inspect owner state,
  notifications and tests/artifacts. Bounded recent tool evidence is included;
  snapshots over 100000 characters report unavailability with a content revision.
- No real-model execution or takeover of the user's running MiniMax terminal was
  performed. Automated coverage exercises real owners, runner, HTTP and MCP with
  controlled run state and temporary storage.
