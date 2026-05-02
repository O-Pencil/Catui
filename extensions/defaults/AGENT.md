# extensions/defaults/

> P2 | Parent: ../AGENT.md

Member List
diagnostics/index.ts: Diagnostics extension entry, subscribes to diagnostic:event, buffers session-local diagnostic records, prompts only after threshold at agent_end, registers /report-issue
diagnostics/types.ts: Diagnostic event/report type contract and diagnostic:event channel name
diagnostics/diagnostic-buffer.ts: DiagnosticBuffer, event coercion, fingerprint dedupe, prompt gating
diagnostics/reporter.ts: User-approved InsForge pencil_issue_events reporter, configured via NANOPENCIL_ISSUE_* env vars
diagnostics/redaction.ts: Diagnostic message normalization and secret/path redaction helpers
browser/index.ts: Browser Harness extension entry, registers browser/browser_admin tools, /browser command, Browser Harness resource discovery, project-local browser workspace seeding
browser/browser.md: Browser Harness day-to-day skill instructions for NanoPencil tool use and workspace contribution
browser/install.md: Browser Harness setup and troubleshooting instructions, exposed as a skill resource
browser/src/browser_harness/: Vendored Browser Harness Python package, CDP daemon, IPC bridge, admin commands, and helper functions
browser/interaction-skills/: Reusable Browser Harness mechanics guides for browser interactions
browser/agent-workspace/: Seed workspace copied to .nanopencil/browser-workspace for editable helpers and domain skills
link-world/index.ts: Internet access integration entry, registers link_world_admin/link_world_exec/web_search/web_fetch tools, /link-world status/doctor/version/install commands, and bundled internet-search resources
link-world/link-world-agent.md: Agent-facing skill that tells models to prefer web_search/web_fetch and link_world_admin/link_world_exec over bash for internet tasks
link-world/network-routing.md: Routing skill that tells models when to use web_search/web_fetch/link-world versus browser automation
link-world/agent-workspace/: Seed workspace copied to .nanopencil/link-world-workspace for project-local domain skills and notes
mcp/index.ts: MCP protocol integration extension, MCP guidance resources
presence/index.ts: AI-driven opening + idle presence lines, uses NanoMemEngine episodes/preferences/lessons + git/cwd snapshot, injects latest line into agent systemPrompt every turn for main-conversation perception, 30s debounce + idle in-flight lock, configurable via settings.presence.enabled, PRESENCE_MESSAGE_TYPE renderer
plan/index.ts: Plan Mode extension entry, /plan /plan:validate /plan:approve commands, EnterPlanMode/ExitPlanMode tools, permission gating, TUI status/widget, workflow prompt injection
plan/types.ts: Plan mode types, persisted state payload, attachment variants, permission result model
plan/plan-file-manager.ts: Plan file path management, slug generation, settings-aware plans directory, plan state hydration/serialization, resume/fork copy helpers
plan/plan-permissions.ts: Plan mode tool permission gating, exact plan-file write checks, read-only bash allowlist, agent/tool blocking policy
plan/plan-workflow-prompt.ts: Plan mode full/sparse workflow prompt, reentry prompt, exit prompt, EnterPlanMode/ExitPlanMode tool result text
plan/enter-plan-mode-tool.ts: EnterPlanMode tool for model-initiated plan mode entry and UI state activation
plan/exit-plan-mode-tool.ts: ExitPlanMode tool for user-approved plan mode exit, validation, teammate approval, UI cleanup
plan/plan-agents.ts: Explore/Plan subagent prompt helpers and read-only tool list for plan mode
plan/plan-validation.ts: Plan structure validation for Context, Approach, Files/Changes, and Verification sections
plan/teammate-approval.ts: Teammate plan approval mailbox integration and approval/waiting message formatting
subagent/index.ts: SubAgent extension entry, /subagent:/subagent:run/:stop/:status/:report/:apply commands, SUBAGENT_MESSAGE_TYPE renderer
subagent/subagent-parser.ts: SubAgent command parsing, parseSubAgentCommand/buildSubAgentHelp
subagent/subagent-runner.ts: SubAgent orchestration — research (read-only) and implement (isolated worktree) roles, diff preview and apply flow
subagent/subagent-types.ts: SubAgent extension types — SubAgentPhase, SubAgentWorkerInfo, SubAgentRunState, SubAgentRunReport
interview/index.ts: Requirement clarification extension, /interview command, lightweight before_agent_start hook
security-audit/interface.ts: Security audit interface, SecurityCheckResult/AuditEvent/SecurityEngine
security-audit/index.ts: Security extension entry, audit logging and dangerous pattern detection
security-audit/engine/interceptor.ts: Request/response interception, InterceptorResult confirmation flow
security-audit/engine/logger.ts: Security event logging, JSON file audit trail
security-audit/engine/detector.ts: Vulnerability detection, pattern matching for dangerous commands
soul/index.ts: AI personality evolution extension, persistent personality across sessions
grub/index.ts: Grub extension entry - autonomous iterative task runner extracted from legacy loop, /grub command + GRUB_MESSAGE_TYPE renderer
grub/grub-controller.ts: GrubController - drives autonomous grub iterations, state machine for LoopTaskState
grub/grub-parser.ts: Grub command parsing, parseGrubCommand/buildGrubHelp
grub/grub-types.ts: Grub types, GrubStatus/GrubDecisionStatus/GrubDecision/GrubTaskState/GrubTaskSnapshot
grub/README.md: Grub extension documentation - autonomous "keep digging until done" runner
loop/index.ts: Loop extension entry - session-scoped recurring prompt/command scheduler with pause/resume/run-now/max-runs/quiet, /loop command + LOOP_MESSAGE_TYPE renderer
loop/scheduler-controller.ts: SchedulerController - in-memory recurring task store with pause/resume/run-now/max-runs, MAX_SCHEDULED_TASKS=50
loop/scheduler-parser.ts: Loop command parsing with flags/subcommands, parseSchedulerCommand/parseDurationSpec/buildSchedulerHelp, --name/--max/--quiet
loop/scheduler-types.ts: Scheduled loop types, LoopPayloadKind/ScheduledLoopTask/LoopStartSpec/ParsedSchedulerCommand
loop/README.md: Loop extension documentation - recurring scheduler usage and flags
sal/index.ts: SAL extension entry, enabled by default, registers --nosal/--sal-ab/--sal-rebuild-terrain flags, /sal:coverage /sal:status /sal:setup commands, before_agent_start/tool_execution_start/agent_end hooks; /sal:setup writes ~/.memory-experiments/credentials.json with adapter inference (insforge/jsonl/noop); publishes structuralAnchor via core/runtime/turn-context (no SAL-specific globals); emits run_start/turn_anchor/run_end eval events through pluggable EvalSink with best-effort shutdown flushing; publishes SAL eval background failures to diagnostic:event; writes local .memory-experiments sidecar anchors only when --sal-ab or NANOPENCIL_SAL_AB=1 is enabled; runtime no-op when --nosal is set
sal/terrain.ts: TerrainSnapshot/TerrainNode/TerrainEdge model, buildTerrainIndex(), checkDipCoverage(), isSnapshotStale(), moduleIdForPath(), parses P2 AGENT.md and P3 file headers
sal/anchors.ts: StructuralAnchor/AnchorResolution model, locateTask(), locateAction(), evidence-driven scoring with tunable SalWeights, CJK bigram tokenization
sal/weights.ts: SalWeights interface, SAL_DEFAULT_WEIGHTS, loadSalWeights() reads sal-config.json from workspace or .memory-experiments/sal/
sal/eval/index.ts: createEvalSink() factory + barrel re-exports; adapter selection via options.adapter or endpoint scheme inference (http(s)→insforge, file://|/|./|../→jsonl, missing→noop); ONLY entry point SAL imports from
sal/eval/types.ts: EvalSink interface, EvalEventEnvelope/EvalEventType (run_start/run_end/turn_anchor), EvalAdapterId ("insforge"|"jsonl"|"noop"), CreateEvalSinkOptions with optional onDiagnostic callback, createEvalEvent factory; zero-dependency type surface
sal/eval/noop-sink.ts: noopSink — silent EvalSink used when eval disabled or no adapter configured
sal/eval/insforge-sink.ts: InsForgeEvalSink — PostgREST adapter, routes run_start→eval_runs INSERT (merge-duplicates) with legacy-schema fallback, writes turn_anchor/tool_trace/memory_recalls/run_end only after parent run confirmation, tool_trace→eval_tool_traces with PGRST204 fallback, memory_recalls→eval_memory_recalls batch INSERT, run_end→eval_runs PATCH; allowSelfSigned TLS option logs only in development runtime, batching with default 2000ms interval
sal/eval/jsonl-sink.ts: JsonlEvalSink — append-only filesystem adapter, one JSON object per line, accepts file:// URLs or plain paths, auto-creates parent dir, batched writes
sal/README.md: SAL extension usage, sidecar output layout, weights override, pluggability contract
team/index.ts: AgentTeam extension entry, /team <task>, /team:spawn/:preset/:send/:status/:progress/:psyche/:dashboard/:task/:mail/:allow-path/:stop/:terminate/:approve/:mode commands, TEAM_MESSAGE_TYPE speaker-stream renderer, realtime status/dashboard updates
team/team-types.ts: TeammateRole/TeammateMode/TeammateStatus/TeamTask/HarnessState/PsycheWeights/TeamUtterance/Handoff/LeaderPlan/AgentLiveView/TeammateIdentity/PersistedTeammate/TeamSpawnSpec/TeamSendResult types
team/team-state-store.ts: TeamStateStore class - durable teammate persistence via JSON files in <agentDir>/teams/
team/team-parser.ts: Team command parser - parseTeamCommand/buildTeamHelp for /team:* subcommands
team/team-runtime.ts: TeamRuntime class - teammate registry, stable internal labels plus visible teammate names, per-teammate send queue, task/mailbox prompt context, lifecycle, realtime status/live events, durable tasks, mailbox + permission + transcript wiring
team/team-orchestrator.ts: Leader orchestration helpers - plan building, speaker utterance creation, @mention parsing, and handoff execution
team/team-task-store.ts: TeamTaskStore class - durable shared task list in <storageDir>/tasks.json
team/team-harness.ts: Harness protocol helpers - context files, phase instructions, checkpoint/revert, feature validation
team/team-presets.ts: Preset definitions and executor - solo/duo/squad spawning, model-assisted auto team selection, heuristic fallback
team/team-dashboard.ts: Text dashboard/status rendering - teammate workbench cards, current task, last utterance, progress bars, footer summary
team/team-psyche.ts: Psyche prompt layer - role/phase weighted Id/Ego/Superego prompt construction
team/team-permissions.ts: PermissionStore - pending permission request queue, approve/deny, path allowlists
team/team-mailbox.ts: TeamMailbox - typed JSONL-backed append-only message log for leader↔teammate and teammate↔teammate
team/team-transcript.ts: TeamTranscriptWriter - per-teammate JSONL transcripts
team/TESTING.md: Manual & smoke-test guide for Phase B AgentTeam

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
