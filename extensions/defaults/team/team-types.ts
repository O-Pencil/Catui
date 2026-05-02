/**
 * [WHO]: TeammateRole, TeammateMode, HarnessState, PsycheWeights, TeamUtterance, Handoff, LeaderPlan, AgentLiveView, PersistedTeammate, TeamSpawnSpec, TeamSendResult
 * [FROM]: No external deps
 * [TO]: Consumed by team-state-store.ts, team-runtime.ts, team-parser.ts, team-dashboard.ts, team-orchestrator.ts, index.ts
 * [HERE]: extensions/defaults/team/team-types.ts - shared type surface for team extension
 */

/**
 * Teammate role. Determines default mode and toolset.
 * - pm: planning and sequencing
 * - architect: system design and technical decomposition
 * - developer: implementation and code delivery
 * - designer: UX/UI and interaction review
 * - data-analyst: metrics, evidence, and verification framing
 * - researcher: read-only exploration
 * - reviewer: read-only review/audit
 * - implementer: legacy implementation role
 * - planner: legacy planning role
 * - verifier: legacy verification role
 * - generic: read-only by default, caller supplies mode
 */
export type TeammateRole =
	| "pm"
	| "architect"
	| "developer"
	| "designer"
	| "data-analyst"
	| "researcher"
	| "reviewer"
	| "implementer"
	| "planner"
	| "verifier"
	| "generic";

/**
 * Teammate operating mode. Controls the permission envelope.
 * - research: read-only exploration
 * - plan: read-only plan production; execute requires leader approval
 * - execute: sandboxed write in worktree
 * - review: read-only review
 */
export type TeammateMode = "research" | "plan" | "execute" | "review";

/**
 * Teammate lifecycle status.
 * - idle: spawned, no work in flight
 * - running: currently processing a message
 * - stopped: current turn aborted, teammate still alive
 * - terminated: fully disposed
 * - error: last turn failed
 */
export type TeammateStatus = "idle" | "running" | "stopped" | "terminated" | "error";

/** Shared task status for team coordination. */
export type TeamTaskStatus = "open" | "claimed" | "blocked" | "done" | "cancelled";

/** Harness phase for long-running teammate work. */
export type HarnessPhase = "init" | "coding" | "verify" | "fix" | "complete";

/** Three-layer psyche weights used by phase-aware prompts. */
export interface PsycheWeights {
  id: number;
  ego: number;
  superego: number;
}

/** Built-in team presets. */
export type PresetName = "solo" | "duo" | "squad";

/** Feature tracked by the harness protocol. */
export interface HarnessFeature {
  id: string;
  category: "functional" | "visual" | "performance" | "integration";
  description: string;
  steps: string[];
  passes: boolean;
  priority: number;
}

/** Durable harness state attached to a teammate. */
export interface HarnessState {
  enabled: boolean;
  phase: HarnessPhase;
  featureListPath: string;
  progressPath: string;
  initScriptPath: string;
  totalFeatures: number;
  passedFeatures: number;
  currentFeature: string | null;
  lastVerifyReport: string | null;
  cycleCount: number;
  featureSnapshot: Omit<HarnessFeature, "passes">[];
  /** Git commit that existed before the current harness turn began */
  preTurnCommit: string | null;
  /** Last commit created by the harness checkpoint flow */
  lastCheckpointCommit: string | null;
  /** Last commit created to revert a failed/violating turn */
  lastRevertCommit: string | null;
  lastEvent?: string;
}

/** Transient live view state used by the TUI dashboard while a teammate is running. */
export interface TeammateLiveState {
  phase: "starting" | "thinking" | "tool" | "finishing" | "done" | "error";
  preview: string;
  toolName: string | null;
  updatedAt: number;
}

/** High-level conversation role surfaced in the team TUI. */
export type TeamSpeakerRole = "leader" | TeammateRole;

/** Canonical message kind used by the team speaker stream. */
export type TeamMessageKind = "thought" | "work" | "handoff" | "result";

/** Parsed @mention used for agent-to-agent handoffs. */
export interface TeamMention {
  raw: string;
  targetId: string;
  targetName: string;
  targetLabel: string;
  task: string;
}

/** One utterance in the visible team chat stream. */
export interface TeamUtterance {
  id: string;
  speakerId: string;
  speakerLabel: string;
  role: TeamSpeakerRole;
  text: string;
  kind: TeamMessageKind;
  mentions: TeamMention[];
  timestamp: number;
}

/** Leader-visible handoff edge between two agents. */
export interface Handoff {
  id: string;
  from: string;
  to: string;
  task: string;
  status: "pending" | "accepted" | "done" | "blocked";
  timestamp: number;
}

/** Compact per-agent state shown in the workbench/dashboard. */
export interface AgentLiveView {
  name: string;
  label: string;
  role: TeammateRole;
  currentTask?: string;
  lastUtterance?: string;
  blockedOn?: string;
  progress?: string;
}

/** One leader-owned subtask in the orchestration plan. */
export interface LeaderSubtask {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerLabel: string;
  ownerRole: TeammateRole;
  title: string;
  task: string;
  dependsOn: string[];
  status: "pending" | "in_progress" | "done" | "blocked";
}

/** Session-scoped leader plan used by the orchestrator. */
export interface LeaderPlan {
  userGoal: string;
  phase: "plan" | "assign" | "watch" | "rebalance" | "summarize" | "done";
  subtasks: LeaderSubtask[];
  owners: Record<string, string>;
  dependencies: Record<string, string[]>;
  completionState: "pending" | "running" | "completed" | "blocked";
}

/** Stable identity for a teammate, assigned at spawn time. */
export interface TeammateIdentity {
  /** Unique id (uuid) */
  id: string;
  /** Stable short label used in the TUI and mention protocol (A/B/C/...) */
  label: string;
  /** Human-friendly name (user-supplied or auto-generated) */
  name: string;
  /** Role determines default tools and mode */
  role: TeammateRole;
  /** Creation timestamp (ms) */
  createdAt: number;
}

/** One conversation turn persisted with the teammate. */
export interface TeammateMessage {
  /** Turn id (uuid) */
  id: string;
  /** Timestamp (ms) */
  timestamp: number;
  /** Who spoke */
  direction: "leader" | "teammate";
  /** Plain text body */
  content: string;
  /** Whether the turn was aborted mid-flight */
  aborted?: boolean;
  /** Whether the turn errored */
  error?: string;
}

/**
 * Durable teammate state. Only plain JSON fields — no runtime handles.
 * This is the on-disk shape managed by TeamStateStore.
 */
export interface PersistedTeammate {
  identity: TeammateIdentity;
  mode: TeammateMode;
  status: TeammateStatus;
  /** Working directory for the teammate (main cwd or worktree path) */
  cwd: string;
  /** Worktree path if the teammate owns one, otherwise undefined */
  worktreePath?: string;
  /** Git branch name for worktree teammates */
  worktreeBranch?: string;
  /** Conversation history */
  messages: TeammateMessage[];
  /** Last activity timestamp */
  lastActiveAt: number;
  /** Last error message if status = error */
  lastError?: string;
  /** Optional long-running task harness state */
  harness?: HarnessState;
  /** Last computed psyche weights for status/UI rendering */
  psyche?: PsycheWeights;
  /** Optional static psyche tuning from presets or spawn configuration */
  psycheOverrides?: Partial<PsycheWeights>;
  /** Runtime-only TUI live state; cleared before persistence after each run */
  live?: TeammateLiveState;
  /** Structured workbench state shown by the team dashboard */
  liveView?: AgentLiveView;
}

/** Input for spawning a new teammate. */
export interface TeamSpawnSpec {
  /** Desired name; if taken or empty, runtime generates one */
  name?: string;
  /** Role selection */
  role: TeammateRole;
  /** Optional explicit mode override (defaults to role's natural mode) */
  mode?: TeammateMode;
  /** Base cwd for the teammate (usually the main session cwd) */
  baseCwd: string;
  /** Enable Anthropic-style long-running harness protocol for this teammate */
  harnessEnabled?: boolean;
  /** Optional static psyche tuning for this teammate */
  psycheOverrides?: Partial<PsycheWeights>;
}

/** Result of a /team:send call. */
export interface TeamSendResult {
  teammateId: string;
  teammateName: string;
  success: boolean;
  response: string;
  aborted?: boolean;
  error?: string;
  durationMs: number;
  utterance?: TeamUtterance;
  mentions?: TeamMention[];
}

/** Durable task record shared by the team. */
export interface TeamTask {
  id: string;
  title: string;
  description?: string;
  status: TeamTaskStatus;
  ownerId?: string;
  ownerName?: string;
  dependsOn: string[];
  artifactPaths: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}
