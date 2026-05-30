# Testing the AgentTeam Extension (Phase B)

> Manual & smoke-test guide for `extensions/builtin/team/`.
> Owner: AgentTeam Phase B. Last updated: 2026-04-08.

This document describes how to verify the Phase B AgentTeam runtime end to end. It covers persistence, the permission model, the mailbox, transcripts, and the subprocess SubAgent backend.

---

## 0. Prerequisites

```bash
npm install
npm run build         # or run via tsx for fast iteration
```

Run nanoPencil in interactive mode for the manual scenarios:

```bash
npx tsx cli.ts
```

All teammate state lives under:

- `${NANOPENCIL_AGENT_DIR:-~/.nanopencil/agent}/teams/<id>.json`        — durable state
- `${NANOPENCIL_AGENT_DIR:-~/.nanopencil/agent}/teams/tasks.json`       — shared task list
- `${NANOPENCIL_AGENT_DIR:-~/.nanopencil/agent}/teams/mailbox.jsonl`    — replayable mailbox log
- `${NANOPENCIL_AGENT_DIR:-~/.nanopencil/agent}/teams/transcripts/<id>.jsonl` — per-teammate transcripts

You can wipe state between runs with:

```bash
rm -rf ~/.nanopencil/agent/teams
```

---

## 1. Type & lint sanity

```bash
npx tsc --noEmit
```

The team extension must report **zero** errors. Pre-existing `presence/index.ts` errors related to `@pencil-agent/mem-core` are unrelated and may remain until that extension is rebundled.

---

## 2. Manual smoke test — happy path

In an interactive session:

```text
/team                                    # → "No teammates."
/team:spawn researcher --name scout      # spawns read-only researcher
/team                                    # lists scout (○ idle)
/team:status scout                       # full record incl. cwd
/team:send scout "What does core/sub-agent/ do?"
/team:status scout                       # messages = 2
/team:terminate scout                    # ⊗ teammate gone
/team                                    # → "No teammates."
```

Pass criteria:

- `scout`'s state file appears under `~/.nanopencil/agent/teams/` after spawn.
- The state file is removed after `terminate`.
- `~/.nanopencil/agent/teams/transcripts/<id>.jsonl` contains one `leader` line and one `teammate` line per send, then is removed on terminate.

---

## 3. Persistence across restarts

```text
/team:spawn researcher --name scout
/team:send scout "Summarize README.md"
```

Quit nanoPencil (`/exit` or Ctrl+C). Restart with `npx tsx cli.ts`. Then:

```text
/team
/team:status scout
```

Pass criteria:

- `scout` is still listed.
- The previous message history is intact.
- `scout`'s status is `idle` (any in-flight `running` is downgraded to `idle` on load — see `team-runtime.ts` `load()`).

---

## 4. Worktree isolation for implementers

```text
/team:spawn implementer --name builder
/team:status builder
```

Pass criteria:

- `builder.cwd` and `worktreePath` point at a fresh git worktree under
  `~/.nanopencil/agent/...` (or `WorktreeManager`'s default location).
- `git worktree list` from the project shows the new worktree.
- Default mode is `plan` (read-only), **not** `execute`.

---

## 5. Permission model — execute escalation

```text
/team:mode builder execute
```

Pass criteria:

- The response says **"requires approval"** and prints a request id.
- `/team:approve` (no args) lists the pending request with action
  `mode_change_to_execute`.
- `/team:approve <id>` flips `builder` to `execute` mode.
- A second `/team:approve <id>` returns "not found or already resolved".
- `/team:status builder` now reports `mode: execute`.
- `/team:terminate builder` cancels any still-pending requests cleanly.

Negative test — denial path:

```text
/team:spawn implementer --name builder2
/team:mode builder2 execute       # pending
/team:terminate builder2          # cancels the request as denied
```

Pass criteria: terminate succeeds, no dangling promise warnings in stderr.

---

## 6. Mailbox observation

The mailbox is currently consumed by `team-runtime` itself; programmatic observers can subscribe via `runtime.getMailbox().subscribe(...)`. To verify mailbox traffic from a test harness:

```ts
import { TeamRuntime } from "./team-runtime.js";
const rt = new TeamRuntime({ storageDir: "/tmp/team-test" });
rt.getMailbox().subscribe((m) => console.log(m.type, m.direction));
await rt.spawn({ role: "researcher", baseCwd: process.cwd() });
await rt.send("researcher-1", "ping");
```

Expected message sequence: `task_request` → `task_result`.
After `setMode("..." , "execute")` on an implementer: `permission_request`, then on approval `permission_response` and `mode_change`.

Shared task and teammate mail smoke:

```text
/team:spawn researcher --name scout
/team:spawn reviewer --name reviewer
/team:task add Map team implementation
/team:task claim T-1 scout
/team:mail scout reviewer "Please review T-1 when ready"
/team:task list
```

Pass criteria:

- `tasks.json` contains `T-1` with `status: "claimed"` and `ownerName: "scout"`.
- `mailbox.jsonl` contains `task_update`, `task_claim`, and `teammate_message`.
- Restarting nanoPencil preserves `/team:task list` output and the teammate mailbox context shown to each teammate.
- The next `/team:send scout ...` prompt includes `Shared team tasks`, the claimed task, and recent mailbox lines targeting `scout`.

---

## 6.1 Path-scoped write access

```text
/team:spawn implementer --name builder
/team:mode builder execute
/team:approve <request-id>
```

Pass criteria:

- In execute mode, `edit`, `write`, and simple bash write commands can mutate files inside `builder.cwd`.
- Attempts to mutate an absolute path outside `builder.cwd` fail with `Write denied` or the team bash sandbox message.
- `/team:allow-path builder ../shared-output` grants that path prefix; subsequent `edit`, `write`, and simple bash writes under the approved path succeed.
- Complex shell write syntax with `&&`, pipes, command substitution, or subshells remains blocked by default.

---

## 7. Transcripts

After any `/team:send`:

```bash
ls ~/.nanopencil/agent/teams/transcripts/
cat ~/.nanopencil/agent/teams/transcripts/<id>.jsonl
```

Pass criteria:

- One JSON object per line.
- Each line has `timestamp`, `kind` (`leader` | `teammate` | `event`), and `content`.
- Transcript file is removed when the teammate is terminated.

---

## 8. Stop in flight

Spawn a teammate, send a long task, then immediately stop:

```text
/team:spawn researcher --name slow
/team:send slow "Read every file under core/ and summarize"
# while running:
/team:stop slow
/team:status slow
```

Pass criteria:

- The send call returns within ~15 seconds with `aborted: true` or an error.
- `slow` ends up in `stopped` status.
- A subsequent `/team:send slow "ping"` works (status returns to `running` then `idle`).

Concurrent send queue check:

```text
/team:spawn researcher --name scout
/team:send scout "First long read"
# while running:
/team:send scout "Second follow-up"
```

Pass criteria:

- The second send is queued instead of rejected.
- Mailbox contains a `task_progress` event with `status: "queued"`.
- The teammate receives and records both leader messages in order.

---

## 9. Subprocess SubAgent backend (smoke)

The subprocess backend is exercised via `SubprocessSubAgentBackend` directly. Quick Node smoke from the repo root:

```bash
npx tsx -e "
import { SubprocessSubAgentBackend } from './core/sub-agent/subprocess-backend.js';
const backend = new SubprocessSubAgentBackend();
const ctrl = new AbortController();
const handle = await backend.spawn({
  prompt: 'hello',
  cwd: process.cwd(),
  tools: [],
  signal: ctrl.signal,
});
console.log(await handle.result());
"
```

Pass criteria:

- The script prints `{ success: true, response: '[subprocess-worker:...] received prompt of 5 chars in cwd ...' }`.
- Aborting before the worker posts: replace `await handle.result()` with `ctrl.abort(); await handle.result();` — should print `{ success: false, error: 'Aborted' }` and the worker thread is terminated.

> **Scope note.** The subprocess backend ships the harness (worker_threads channel, abort wiring, lifecycle) but does **not** run the full LLM agent loop inside the worker yet. Callers that need real LLM execution should keep using the in-process backend; this backend is the foundation for future crash isolation.

---

## 10. Recovery (corrupt state file)

Touch a malformed state file to confirm `loadAll()` skips it gracefully:

```bash
echo "not-json" > ~/.nanopencil/agent/teams/garbage.json
npx tsx cli.ts
/team
```

Pass criteria: nanoPencil starts normally, `/team` lists only valid teammates, no crash.

---

## 11. Coverage matrix

| §B item                          | Covered by section |
|----------------------------------|--------------------|
| B.1 Persistent teammates         | §2, §3             |
| B.2 State store independence     | §3, §10            |
| B.3 Mailbox protocol             | §6                 |
| B.4 Permission model             | §5                 |
| B.5 Worktree isolation           | §4                 |
| B.6 Multi-backend (subprocess)   | §9                 |
| B.7 Transcripts                  | §7                 |
| B.8 Recovery                     | §3, §10            |
| AbortSignal closure (Phase A.2)  | §8                 |

---

**Covenant**: When you add a new `/team:*` command or change the permission/mailbox surface, update this file in the same commit.
