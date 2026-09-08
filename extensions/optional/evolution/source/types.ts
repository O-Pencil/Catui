/**
 * [WHO]: Source evolution configuration, observation, job and state contracts
 * [FROM]: Node primitive types only
 * [TO]: Source evolution runtime and delivery adapters
 * [HERE]: extensions/optional/evolution/source/types.ts - feature-local contracts
 */
export interface SourceConfig {
	version: 1;
	enabled: boolean;
	repository: string;
	branch: string;
	packageName: string;
	agentDir: string;
	model: string;
	reviewModel?: string;
	repairScope?: "source" | "adaptive";
	timeZone: string;
	hour: number;
	autoMerge: boolean;
	autoPublish: boolean;
	autoUpdate: boolean;
	allowRemotePush: boolean;
	maxWorkerRunsPerDay: number;
	maxJobsPerDay: number;
	maxWorkerSeconds: number;
	maxTurns: number;
	maxAttempts: number;
	minimumFailures: number;
	measurementSamples: number;
	regressionMargin: number;
	requiredChecks: string[];
}
export interface Observation {
	id: string;
	run: string;
	session: string;
	workspace: string;
	time: string;
	version: string;
	model: string;
	kind: "task" | "tool" | "result" | "usage" | "quality";
	taskCategory?: string;
	inputBucket?: string;
	qualityCategory?: string;
	evidenceIds?: string[];
	tool?: string;
	failed: boolean;
	summary: string;
	durationMs?: number;
	inefficient?: boolean;
	tokens?: number;
	toolCalls?: number;
	turns?: number;
	fingerprint: string;
}
export type JobStage = "queued" | "prepared" | "verified" | "verified-local" | "submitted" | "merged" | "published" | "adopted" | "effective" | "regressed" | "rejected" | "failed";
export interface SourceJob {
	id: string;
	day: string;
	stage: JobStage;
	createdAt: string;
	evidence: Observation[];
	fingerprint: string;
	title: string;
	base?: string;
	head?: string;
	branch: string;
	checkout: string;
	testPath?: string;
	testHash?: string;
	holdout?: { checkout: string; regression: string; compatibility: string; regressionHash: string; compatibilityHash: string; model: string; passed?: boolean };
	baselineRuns?: RunSample[];
	observedRuns?: RunSample[];
	measurementLook?: number;
	measurementInterval?: [number, number];
	measurementTokensRatio?: number;
	measurementLatencyRatio?: number;
	version?: string;
	pr?: number;
	merge?: string;
	artifact?: string;
	integrity?: string;
	baselineRate?: number;
	baselineCount?: number;
	metric?: "failure" | "inefficiency" | "quality";
	adoptedAt?: string;
	previousVersion?: string;
	previousHead?: string;
	revisions?: number;
	measuredCount?: number;
	measuredRate?: number;
	attempts: number;
	retryAfter?: string;
	error?: string;
	lastResult?: string;
}
export interface SourceState {
	version: 1;
	observations: Observation[];
	jobs: SourceJob[];
	budgets: Record<string, { calls: number; jobs: number }>;
	seen: string[];
	dropped: number;
	heartbeat?: string;
	error?: string;
	paused?: boolean;
	audit?: { day?: string; runs: string[]; error?: string };
}
export interface RunSample {
	run: string;
	stratum: string;
	failed: boolean;
	tokens: number;
	durationMs: number;
	usageKnown?: boolean;
}
export interface InstalledVersion {
	version: string;
	cli: string;
	job: string;
	merge: string;
	previous?: InstalledVersion;
}
export interface CommandResult { code: number; stdout: string; stderr: string }
export type RunCommand = (command: string, args: string[], options: {
	cwd: string; timeoutMs?: number; input?: string; env?: NodeJS.ProcessEnv; log?: string;
}) => Promise<CommandResult>;
