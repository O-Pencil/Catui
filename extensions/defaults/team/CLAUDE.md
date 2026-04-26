# extensions/defaults/team/

> P2 | Parent: ../CLAUDE.md

Member List
- index.ts: AgentTeam extension entry, /team <task> auto-selection, /team:spawn/:preset/:send/:status/:progress/:psyche/:dashboard/:stop/:terminate/:approve/:mode commands, TEAM_MESSAGE_TYPE renderer, realtime stream observer, footer/widget updates
- team-types.ts: TeammateRole/TeammateMode/TeammateStatus/HarnessState/PsycheWeights/TeammateLiveState/TeammateIdentity/TeammateMessage/PersistedTeammate/TeamSpawnSpec/TeamSendResult types
- team-state-store.ts: TeamStateStore class - durable teammate persistence via JSON files in <agentDir>/teams/
- team-parser.ts: Team command parser - parseTeamCommand/buildTeamHelp for /team root auto-selection and /team:* subcommands, preset/progress/psyche/dashboard parsing, --harness spawn flag
- team-runtime.ts: TeamRuntime class - teammate registry, lifecycle, harness/psyche prompt injection, realtime sub-agent event forwarding, harness implementer execute default, mailbox + permission + transcript wiring; uses SubAgentRuntime for agent spawning
- team-psyche.ts: Psyche prompt layer - phase/role/soul weighted Id/Ego/Superego prompt construction
- team-harness.ts: Harness protocol helpers - harness file defaults, phase instructions, context file selection, feature-list validation, git checkpoint/revert, phase progression
- team-presets.ts: Preset definitions and executor - solo/duo/squad teammate spawning, model-assisted auto team selection, heuristic fallback, optional autostart
- team-dashboard.ts: Text dashboard/status rendering - card layout, live stream preview, psyche/progress bars, footer status summary
- team-permissions.ts: PermissionStore - pending permission request queue, approve/deny, path allowlists (B.4)
- team-mailbox.ts: TeamMailbox - typed in-memory append-only message log for leader↔teammate (B.3)
- team-transcript.ts: TeamTranscriptWriter - per-teammate JSONL transcripts under <storageDir>/transcripts/ (B.7)
- TESTING.md: Manual & smoke-test guide for the Phase B AgentTeam extension

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent CLAUDE.md

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
| `/team <task>` | Auto-select solo/duo/squad and start the task |
| `/team:spawn <role> [--name <id>] [--harness]` | Create a persistent teammate |
| `/team:preset <solo\|duo\|squad> <task>` | Create teammates from a preset |
| `/team:send <name> <message>` | Send message to a teammate |
| `/team:status [<name>]` | Show team or teammate status |
| `/team:progress [<name>]` | Show harness progress |
| `/team:psyche [<name>]` | Show psyche weights |
| `/team:dashboard` | Toggle the text dashboard widget |
| `/team:stop <name>` | Stop teammate's current turn |
| `/team:terminate <name>` | Destroy a teammate |
| `/team:approve <request-id>` | Approve a permission request (TODO) |
| `/team:mode <name> <plan\|execute\|review>` | Switch teammate mode |

## Roles

- `researcher`: Read-only exploration
- `reviewer`: Read-only review/audit
- `implementer`: Sandboxed write in isolated worktree
- `planner`: Read-only plan production
- `verifier`: Read-only strict verification/review
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

TeamStateStore is deliberately independent of core SessionManager per the refactor plan:
> "team-state-store 自己负责 teammate 历史 ... SessionManager 只负责主会话"

## Core Dependencies

- `core/sub-agent/`: SubAgentRuntime for spawning agents
- `core/workspace/`: WorktreeManager for isolated worktrees
- `core/tools/`: Tool creation with sandboxed bash

## Phase B status

Shipped in this iteration:
- Permission request/response (`team-permissions.ts`, wired into `/team:mode` execute escalation and `/team:approve`)
- Mailbox protocol (`team-mailbox.ts`, posts on send/result/mode_change/permission_request/permission_response)
- Per-teammate JSONL transcripts (`team-transcript.ts`)
- Subprocess SubAgent backend harness (`core/sub-agent/subprocess-backend.ts` + `subprocess-worker.ts`) — interface complete, worker LLM loop deferred (see backend doc).

Future work:
- Worker-side full LLM agent loop for the subprocess backend
- Path-scoped write permission requests (`PermissionStore.allowPath` is implemented but not yet consulted by the bash sandbox)
- Cross-restart mailbox replay
