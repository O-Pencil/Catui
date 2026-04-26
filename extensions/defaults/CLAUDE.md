# extensions/defaults/

> P2 | Parent: ../CLAUDE.md

Member List
link-world/index.ts: Internet access extension, provides internet-search Skill after setup
mcp/index.ts: MCP protocol integration extension, MCP guidance resources
presence/index.ts: AI-driven opening + idle presence lines, uses NanoMemEngine episodes/preferences/lessons + git/cwd snapshot, injects latest line into agent systemPrompt every turn for main-conversation perception, 30s debounce + idle in-flight lock, configurable via settings.presence.enabled, PRESENCE_MESSAGE_TYPE renderer
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
grub/index.ts: Grub extension entry - long-running autonomous harness, locale-aware dual-phase system prompts (initializer/coding), /grub command (start/status/resume/stop) + grub renderer, session_start auto-adopt, git harness commit, pruneStale cleanup
grub/grub-controller.ts: GrubController - state machine for /grub iterations, locale-persisted prompt generation, durable persistState on every transition, adoptResumedTask for cross-session resume, validateCompletion downgrades premature complete when feature-list still has pending entries
grub/grub-parser.ts: Grub command parsing - parseGrubCommand/buildGrubHelp with localized help, resume subcommand, status --json, --max-iter/--max-fail flags
grub/grub-types.ts: Grub types - GrubStatus/GrubDecisionStatus/GrubDecision/GrubPhase/GrubLocale/GrubTaskState/GrubTaskSnapshot/ParsedGrubCommand + FeatureItem/FeatureList (version 1 schema) + PersistedGrubState envelope
grub/grub-i18n.ts: Grub localization helper - detectGrubLocale(), grubText(), languageName(), English/Chinese TUI strings
grub/grub-feature-list.ts: feature-list.json IO - readFeatureList/writeFeatureList atomic write, validateFeatureListDiff enforces passes/evidence-only mutations, createInitialFeatureList placeholder, migrateChecklistToFeatureList legacy converter, countPassing/allPassing/firstPending helpers
grub/grub-persistence.ts: Cross-session persistence - persistState atomic JSON write to .grub/<id>/state.json, loadState shape-validated read, discoverActiveTasks scans .grub/ for running records, pruneStale removes terminal harnesses older than 30 days by default
grub/README.md: Grub extension documentation - long-running harness contract, feature-list.json schema, completion guard, cross-session resume, legacy migration
loop/index.ts: Loop extension entry - session-scoped recurring prompt/command scheduler with pause/resume/run-now/max-runs/quiet, /loop command + LOOP_MESSAGE_TYPE renderer
loop/scheduler-controller.ts: SchedulerController - in-memory recurring task store with pause/resume/run-now/max-runs, MAX_SCHEDULED_TASKS=50
loop/scheduler-parser.ts: Loop command parsing with flags/subcommands, parseSchedulerCommand/parseDurationSpec/buildSchedulerHelp, --name/--max/--quiet
loop/scheduler-types.ts: Scheduled loop types, LoopPayloadKind/ScheduledLoopTask/LoopStartSpec/ParsedSchedulerCommand
loop/README.md: Loop extension documentation - recurring scheduler usage and flags
btw/index.ts: BTW extension entry - /btw command for quick side questions without interrupting main task, uses completeSimple() for lightweight response, BTW_MESSAGE_TYPE renderer
debug/index.ts: Debug extension entry - /debug command dispatches diagnostics through full agent loop (sendUserMessage + before_agent_start hook), three-layer analysis (Phenomenon/Essence/Philosophy), supports /debug env|session|model quick subcommands, DEBUG_MESSAGE_TYPE renderer
debug/collectors.ts: Diagnostic data collectors for /debug command, collectSystemInfo/collectModelInfo/collectSessionInfo/collectConfigInfo/collectGitInfo/collectAgentState, sanitizeForLLM, formatDiagnosticData
plan/index.ts: Plan Mode extension entry - registers /plan command, EnterPlanMode/ExitPlanMode tools, permission gating, workflow prompt injection
plan/types.ts: PlanModeState, PlanModeAttachment types, PlanModeConfig, PlanApprovalRequest/Response
plan/plan-file-manager.ts: PlanFileManager - plan file path management and I/O, slug generation, plans directory
plan/plan-permissions.ts: shouldAllowToolCall() - tool call permission gating for plan mode (read-only + plan file write)
plan/plan-workflow-prompt.ts: getPlanModeInstructions(), getPlanModeExitInstructions(), getPlanModeReentryInstructions() - workflow prompt generation
plan/enter-plan-mode-tool.ts: createEnterPlanModeTool() - EnterPlanMode tool for model-initiated plan mode entry
plan/exit-plan-mode-tool.ts: createExitPlanModeTool() - ExitPlanMode tool with plan validation and teammate approval flow
plan/plan-agents.ts: Explore/Plan subagent definitions with read-only tools for plan mode workflow
plan/plan-validation.ts: validatePlan() - validates plan has required sections (Context, Approach, Files, Verification)
plan/teammate-approval.ts: isInTeammateContext(), submitPlanToLeader(), formatPlanSubmittedMessage() - teammate plan approval integration
sal/index.ts: SAL extension entry, enabled by default, registers --nosal/--sal-rebuild-terrain flags, /sal:coverage /sal:status /sal:setup commands, before_agent_start/tool_execution_start/tool_execution_end/agent_end hooks; /sal:setup writes ~/.memory-experiments/credentials.json with adapter inference (insforge/jsonl/noop); publishes structuralAnchor via core/runtime/turn-context (no SAL-specific globals); emits run_start/turn_anchor/memory_recalls/tool_trace/run_end eval events through pluggable EvalSink; reads memoryRecallSnapshot from turn-context bus in agent_end; runtime no-op when --nosal is set; auto-injects pencil_version from build-meta.json into run_start; emergency flush on beforeExit/SIGHUP/SIGTERM; stale run cleanup is opt-in via NANOPENCIL_EVAL_CLEANUP_STALE_RUNS / credentials cleanup_stale_runs; tool_trace is a bounded per-turn summary and includes no-tool turns
sal/terrain.ts: TerrainSnapshot/TerrainNode/TerrainEdge model, async buildTerrainIndex()/isSnapshotStale() (fs/promises + periodic yields so TUI can flush under block terminals like Warp), checkDipCoverage(), moduleIdForPath(), parses P2 CLAUDE.md and P3 file headers
sal/anchors.ts: StructuralAnchor/AnchorResolution model, locateTask(), locateAction(), evidence-driven scoring with tunable SalWeights, CJK bigram tokenization
sal/weights.ts: SalWeights interface, SAL_DEFAULT_WEIGHTS, loadSalWeights() reads sal-config.json from workspace or .memory-experiments/sal/
sal/eval/index.ts: createEvalSink() factory + barrel re-exports; adapter selection via options.adapter or endpoint scheme inference (http(s)→insforge, file://|/|./|../→jsonl, missing→noop); ONLY entry point SAL imports from
sal/eval/types.ts: EvalSink interface, EvalEventEnvelope/EvalEventType (run_start/run_end/turn_anchor/memory_recalls/tool_trace), EvalAdapterId ("insforge"|"jsonl"|"noop"), CreateEvalSinkOptions, createEvalEvent factory; zero-dependency type surface
sal/eval/noop-sink.ts: noopSink — silent EvalSink used when eval disabled or no adapter configured
sal/eval/insforge-sink.ts: InsForgeEvalSink — PostgREST adapter, routes run_start→eval_runs INSERT (merge-duplicates), turn_anchor→eval_turns + eval_sal_anchors×2, tool_trace→eval_tool_traces bounded per-turn summaries (including no-tool turns and truncation counters), memory_recalls→eval_memory_recalls batch INSERT, run_end→eval_runs PATCH; allowSelfSigned TLS option, batching with default 2000ms interval
sal/eval/jsonl-sink.ts: JsonlEvalSink — append-only filesystem adapter, one JSON object per line, accepts file:// URLs or plain paths, auto-creates parent dir, batched writes
sal/README.md: SAL extension usage, sidecar output layout, weights override, pluggability contract
team/index.ts: AgentTeam extension entry, /team:/team:spawn/:send/:status/:stop/:terminate/:approve/:mode commands, TEAM_MESSAGE_TYPE renderer
team/team-types.ts: TeammateRole/TeammateMode/TeammateStatus/TeammateIdentity/TeammateMessage/PersistedTeammate/TeamSpawnSpec/TeamSendResult types
team/team-state-store.ts: TeamStateStore class - durable teammate persistence via JSON files in <agentDir>/teams/
team/team-parser.ts: Team command parser - parseTeamCommand/buildTeamHelp for /team:* subcommands
team/team-runtime.ts: TeamRuntime class - teammate registry, lifecycle, mailbox + permission + transcript wiring
team/team-permissions.ts: PermissionStore - pending permission request queue, approve/deny, path allowlists
team/team-mailbox.ts: TeamMailbox - typed append-only message log for leader↔teammate
team/team-transcript.ts: TeamTranscriptWriter - per-teammate JSONL transcripts
team/TESTING.md: Manual & smoke-test guide for Phase B AgentTeam

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent CLAUDE.md
