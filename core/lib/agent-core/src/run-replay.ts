/**
 * [WHO]: replayRunTrace, ReplayDivergence, and semantic lifecycle reconstruction
 * [FROM]: Depends on validated V1 run traces
 * [TO]: Consumed by harness eval and offline trace diagnostics
 * [HERE]: core/lib/agent-core/src/run-replay.ts - pure deterministic replay validator
 */
import { validateRunTrace, type RunTraceEventV1, type RunTraceKindV1 } from "./run-trace.js";

export interface ReplayDivergence {
	sequence: number;
	kind?: RunTraceKindV1;
	fieldPath: string;
	expected?: unknown;
	actual?: unknown;
	message: string;
}

export interface ReplaySummary {
	runId: string;
	stopReason: string;
	turnCount: number;
	toolCallCount: number;
	checkpointCount: number;
}

export type ReplayResult =
	| { ok: true; summary: ReplaySummary }
	| { ok: false; divergence: ReplayDivergence };

function divergence(
	sequence: number,
	fieldPath: string,
	expected: unknown,
	actual: unknown,
	kind?: RunTraceKindV1,
): ReplayResult {
	return {
		ok: false,
		divergence: {
			sequence,
			...(kind === undefined ? {} : { kind }),
			fieldPath,
			expected,
			actual,
			message: `Replay diverged at sequence ${sequence} (${fieldPath})`,
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstValueDifference(expected: unknown, actual: unknown, path: string): { path: string; expected: unknown; actual: unknown } | undefined {
	if (Object.is(expected, actual)) return undefined;
	if (Array.isArray(expected) && Array.isArray(actual)) {
		const length = Math.max(expected.length, actual.length);
		for (let index = 0; index < length; index += 1) {
			const found = firstValueDifference(expected[index], actual[index], `${path}[${index}]`);
			if (found) return found;
		}
		return undefined;
	}
	if (isRecord(expected) && isRecord(actual)) {
		const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
		for (const key of keys) {
			const found = firstValueDifference(expected[key], actual[key], path.length === 0 ? key : `${path}.${key}`);
			if (found) return found;
		}
		return undefined;
	}
	return { path, expected, actual };
}

function semanticEvent(event: RunTraceEventV1): Record<string, unknown> {
	return {
		kind: event.kind,
		payload: event.payload,
		parentEventId: event.parentEventId,
		turnId: event.turnId,
	};
}

function compareTraces(expected: RunTraceEventV1[], actual: RunTraceEventV1[]): ReplayResult | undefined {
	const length = Math.max(expected.length, actual.length);
	for (let index = 0; index < length; index += 1) {
		const expectedEvent = expected[index];
		const actualEvent = actual[index];
		const sequence = index + 1;
		if (!expectedEvent || !actualEvent) {
			return divergence(sequence, "$event", expectedEvent, actualEvent, expectedEvent?.kind ?? actualEvent?.kind);
		}
		const found = firstValueDifference(semanticEvent(expectedEvent), semanticEvent(actualEvent), "");
		if (found) return divergence(sequence, found.path, found.expected, found.actual, expectedEvent.kind);
	}
	return undefined;
}

function semanticReplay(events: RunTraceEventV1[]): ReplayResult {
	const first = events[0];
	if (first.kind !== "run.started") return divergence(1, "kind", "run.started", first.kind, first.kind);
	const openTurns = new Set<number>();
	const requestedModels = new Set<number>();
	const openTools = new Map<string, "requested" | "started">();
	let checkpointCount = 0;
	let completedToolCount = 0;

	for (const event of events) {
		switch (event.kind) {
			case "turn.started":
				if (openTurns.has(event.payload.turn)) return divergence(event.sequence, `turn.${event.payload.turn}`, "closed", "already open", event.kind);
				openTurns.add(event.payload.turn);
				break;
			case "turn.completed":
				if (!openTurns.delete(event.payload.turn)) return divergence(event.sequence, `turn.${event.payload.turn}`, "open", "missing", event.kind);
				break;
			case "model.requested":
				requestedModels.add(event.payload.turn);
				break;
			case "model.responded":
			case "model.failed":
				if (!requestedModels.delete(event.payload.turn)) return divergence(event.sequence, `model.${event.payload.turn}`, "requested", "missing", event.kind);
				break;
			case "tool.requested":
				if (openTools.has(event.payload.toolCallId)) return divergence(event.sequence, `tool.${event.payload.toolCallId}`, "new", "duplicate", event.kind);
				openTools.set(event.payload.toolCallId, "requested");
				break;
			case "tool.started":
				if (openTools.get(event.payload.toolCallId) !== "requested") return divergence(event.sequence, `tool.${event.payload.toolCallId}`, "requested", openTools.get(event.payload.toolCallId), event.kind);
				openTools.set(event.payload.toolCallId, "started");
				break;
			case "tool.completed":
				if (!openTools.delete(event.payload.toolCallId)) return divergence(event.sequence, `tool.${event.payload.toolCallId}`, "requested", "missing", event.kind);
				completedToolCount += 1;
				break;
			case "checkpoint.created":
				checkpointCount += 1;
				break;
		}
		if (event.kind === "run.completed") {
			const unpairedTool = openTools.keys().next().value as string | undefined;
			if (unpairedTool) return divergence(event.sequence, `tool.${unpairedTool}`, "completed", openTools.get(unpairedTool), event.kind);
			if (openTurns.size > 0) return divergence(event.sequence, `turn.${openTurns.values().next().value as number}`, "completed", "open", event.kind);
			if (requestedModels.size > 0) return divergence(event.sequence, `model.${requestedModels.values().next().value as number}`, "responded", "requested", event.kind);
			if (event.payload.toolCallCount !== completedToolCount) return divergence(event.sequence, "payload.toolCallCount", event.payload.toolCallCount, completedToolCount, event.kind);
			return {
				ok: true,
				summary: {
					runId: event.runId,
					stopReason: event.payload.stopReason,
					turnCount: event.payload.turnCount,
					toolCallCount: event.payload.toolCallCount,
					checkpointCount,
				},
			};
		}
	}
	return divergence(events.length + 1, "kind", "run.completed", undefined);
}

export function replayRunTrace(recorded: readonly unknown[], observed?: readonly unknown[]): ReplayResult {
	let expected: RunTraceEventV1[];
	let actual: RunTraceEventV1[] | undefined;
	try {
		expected = validateRunTrace(recorded);
		actual = observed === undefined ? undefined : validateRunTrace(observed);
	} catch (error: unknown) {
		return divergence(1, "$trace", "valid trace", error instanceof Error ? error.message : String(error));
	}
	if (actual) {
		const comparison = compareTraces(expected, actual);
		if (comparison) return comparison;
	}
	return semanticReplay(expected);
}
