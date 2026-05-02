# extensions/defaults/team/

> P2 | Parent: ../AGENT.md

Member List
- index.ts: AgentTeam extension entry, /team <task>, /team:spawn/:preset/:send/:status/:progress/:psyche/:dashboard/:task/:mail/:allow-path/:stop/:terminate/:approve/:mode commands, TEAM_MESSAGE_TYPE renderer, realtime status/dashboard updates
- team-types.ts: TeammateRole/TeammateMode/TeammateStatus/TeamTask/HarnessState/PsycheWeights/TeammateLiveState/TeammateIdentity/TeammateMessage/PersistedTeammate/TeamSpawnSpec/TeamSendResult types
- team-state-store.ts: TeamStateStore class - durable teammate persistence via JSON files in <agentDir>/teams/
- team-parser.ts: Team command parser - parseTeamCommand/buildTeamHelp for /team:* subcommands
- team-runtime.ts: TeamRuntime class - teammate registry, per-teammate send queue, task/mailbox prompt context, lifecycle, realtime status/live events, mailbox + permission + transcript wiring; uses SubAgentRuntime for agent spawning
- team-task-store.ts: TeamTaskStore class - durable shared task list in <storageDir>/tasks.json with claim/status updates
- team-harness.ts: Harness protocol helpers - context files, phase instructions, checkpoint/revert, feature validation
- team-presets.ts: Preset definitions and executor - solo/duo/squad spawning, model-assisted auto team selection, heuristic fallback
- team-dashboard.ts: Text dashboard/status rendering - teammate cards, live stream preview, progress bars, footer summary
- team-psyche.ts: Psyche prompt layer - role/phase weighted Id/Ego/Superego prompt construction
- team-permissions.ts: PermissionStore - pending permission request queue, approve/deny, path allowlists (B.4)
- team-mailbox.ts: TeamMailbox - typed JSONL-backed append-only message log for leader↔teammate and teammate↔teammate routing (B.3)
- team-transcript.ts: TeamTranscriptWriter - per-teammate JSONL transcripts under <storageDir>/transcripts/ (B.7)
- TESTING.md: Manual & smoke-test guide for the Phase B AgentTeam extension

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md

---

## Phase B: AgentTeam Architecture

This extension implements the Phase B "true AgentTeam" per the refactor plan:
- Persistent teammates with durable state (survive across main session restarts)
- Each teammate has identity, mode, status, worktree, and message history
- Teammates run in isolated worktrees (for implementers)
- Uses core/sub-agent/ infrastructure for actual agent spawning

## Commands

| Command | Description |
|---------|-------------|
| `/team` | List all teammates |
| `/team:spawn <role> [--name <id>]` | Create a persistent teammate |
| `/team:send <name> <message>` | Send message to a teammate |
| `/team:status [<name>]` | Show team or teammate status |
| `/team:stop <name>` | Stop teammate's current turn |
| `/team:terminate <name>` | Destroy a teammate |
| `/team:approve <request-id>` | Approve a permission request |
| `/team:mode <name> <plan\|execute\|review>` | Switch teammate mode |
| `/team:task list` | Show shared team tasks |
| `/team:task add <title>` | Add a shared task |
| `/team:task claim <id> <name>` | Assign/claim a task for a teammate |
| `/team:task done\|block\|cancel <id>` | Update task status |
| `/team:mail <from> <to> <message>` | Route teammate-to-teammate mailbox message |
| `/team:allow-path <name> <path>` | Grant teammate write access to a path prefix |

## Roles

- `researcher`: Read-only exploration
- `reviewer`: Read-only review/audit
- `implementer`: Sandboxed write in isolated worktree
- `planner`: Read-only plan production
- `generic`: Read-only by default

## Modes

- `research`: Read-only exploration
- `plan`: Read-only plan production; execute requires leader approval
- `execute`: Sandboxed write in worktree
- `review`: Read-only review

## State Persistence

Teammate state is stored in `~/.nanopencil/agent/teams/<uuid>.json`:
- Identity (id, name, role, createdAt)
- Mode and status
- Working directory and worktree info
- Message history
- Last activity timestamp

Shared team coordination state is also stored under `~/.nanopencil/agent/teams/`:
- `tasks.json`: durable task list with status, owner, dependencies, and artifact paths
- `mailbox.jsonl`: replayable mailbox events for leader↔teammate and teammate↔teammate routing

TeamStateStore is deliberately independent of core SessionManager per the refactor plan:
> "team-state-store 自己负责 teammate 历史 ... SessionManager 只负责主会话"

## Core Dependencies

- `core/sub-agent/`: SubAgentRuntime for spawning agents
- `core/workspace/`: WorktreeManager for isolated worktrees
- `core/tools/`: Tool creation with sandboxed bash

## Phase B status

Shipped in this iteration:
- Permission request/response (`team-permissions.ts`, wired into `/team:mode` execute escalation and `/team:approve`)
- Durable shared task list (`team-task-store.ts`, wired into `/team:task`)
- Mailbox protocol (`team-mailbox.ts`, posts on send/result/mode_change/permission_request/permission_response/task_update/task_claim/teammate_message and replays across restarts)
- Prompt context injection: each teammate receives claimed tasks, blocked/open task cues, and recent mailbox messages before every turn
- Path-scoped write allowlist exposed through `/team:allow-path`; execute-mode edit/write tools and simple bash write commands enforce teammate cwd or approved path prefixes
- Per-teammate send queue: concurrent `/team:send` calls for the same teammate run sequentially instead of failing while the teammate is running
- Per-teammate JSONL transcripts (`team-transcript.ts`)
- Subprocess SubAgent backend harness (`core/sub-agent/subprocess-backend.ts` + `subprocess-worker.ts`) — interface complete, worker LLM loop deferred (see backend doc).

Future work:
- Worker-side full LLM agent loop for the subprocess backend
- Broaden bash write parsing beyond simple single-command forms while keeping complex shell syntax rejected by default
