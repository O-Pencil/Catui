/**
 * [WHO]: ScheduledLoopTask, ParsedSchedulerCommand, LoopPayloadKind
 * [FROM]: No external dependencies
 * [TO]: Consumed by ./scheduler-controller.ts, ./scheduler-parser.ts, ./index.ts
 * [HERE]: extensions/builtin/loop/scheduler-types.ts - scheduled loop type definitions
 */

export type LoopPayloadKind = "prompt" | "command";

export interface ScheduledLoopTask {
	id: string;
	name?: string;
	input: string;
	kind: LoopPayloadKind;
	intervalMs: number;
	intervalLabel: string;
	createdAt: number;
	updatedAt: number;
	nextRunAt: number;
	lastRunAt?: number;
	runCount: number;
	maxRuns?: number;
	pending: boolean;
	paused: boolean;
	quiet: boolean;
	durable?: boolean;
	agentId?: string;
	lastError?: string;
	lastOutputSnippet?: string;
}

export interface LoopStartSpec {
	input: string;
	kind: LoopPayloadKind;
	intervalMs: number;
	intervalLabel: string;
	name?: string;
	maxRuns?: number;
	quiet?: boolean;
	durable?: boolean;
}

export type ParsedSchedulerCommand =
	| { type: "help"; reason?: "empty" | "interval" | "input" | "cancel" | "ref" | "max" }
	| { type: "list" }
	| { type: "status"; ref: string }
	| { type: "clear" }
	| { type: "cancel"; ref: string }
	| { type: "pause"; ref: string }
	| { type: "resume"; ref: string }
	| { type: "run"; ref: string }
	| ({ type: "start" } & LoopStartSpec);
