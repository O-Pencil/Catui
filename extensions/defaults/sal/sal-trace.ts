/**
 * [WHO]: Provides SAL tool-path extraction, task intent inference, and bounded tool_trace payload construction
 * [FROM]: Depends on node path helpers and terrain path normalization
 * [TO]: Consumed by extensions/defaults/sal/index.ts and SAL tool trace tests
 * [HERE]: extensions/defaults/sal/sal-trace.ts - per-turn tool and loop-outcome analytics boundary for Structural Anchor Localization
 */

import { isAbsolute, join, relative } from "node:path";
import { toPosixPath } from "./terrain.js";
import type { TurnState } from "./sal-runtime.js";

const MAX_TOOL_SEQUENCE = 32;
const MAX_TOOL_SUMMARY_TOOLS = 16;

interface ToolTraceSummary {
	tool: string;
	count: number;
	errors: number;
	avg_ms: number | null;
	completed_calls: number;
}

export type TaskIntent = "fix" | "feat" | "refactor" | "explain" | "explore" | "unknown";

function workspaceRelativePath(workspaceRoot: string, candidate: string): string | undefined {
	if (!candidate) return undefined;
	const abs = isAbsolute(candidate) ? candidate : join(workspaceRoot, candidate);
	const rel = relative(workspaceRoot, abs);
	if (rel.startsWith("..") || rel === "") return undefined;
	return toPosixPath(rel);
}

export function extractToolFilePaths(toolName: string, args: unknown, workspaceRoot: string): string[] {
	if (!args || typeof args !== "object") return [];
	const a = args as Record<string, unknown>;
	const out: string[] = [];
	const candidates: string[] = [];
	if (typeof a.file_path === "string") candidates.push(a.file_path);
	if (typeof a.path === "string") candidates.push(a.path);
	if (Array.isArray(a.paths)) {
		for (const p of a.paths) if (typeof p === "string") candidates.push(p);
	}
	for (const c of candidates) {
		const rel = workspaceRelativePath(workspaceRoot, c);
		if (rel) out.push(rel);
	}
	if (toolName === "bash" && typeof a.command === "string") {
		const found = a.command.match(/[\w./-]+\.(?:ts|tsx|js|jsx|md|json)/g) ?? [];
		for (const f of found) {
			const rel = workspaceRelativePath(workspaceRoot, f);
			if (rel) out.push(rel);
		}
	}
	return out;
}

const INTENT_PATTERNS: Array<[TaskIntent, RegExp[]]> = [
	["fix", [
		/\b(fix|bug|error|issue|broken|crash|fail|wrong|debug|patch|repair)\b/i,
		/(修复|报错|问题|异常|崩溃|失败|错误)/,
	]],
	["refactor", [
		/\b(refactor|rename|extract|move|split|merge|clean\s?up|restructure)\b/i,
		/(重构|整理|拆分|重命名|抽取)/,
	]],
	["explain", [
		/\b(explain|how does|what is|why does|understand|read|review|audit|tell me|describe)\b/i,
		/(解释|为什么|怎么|什么|看一下|看下|评审|核审|说明)/,
	]],
	["feat", [
		/\b(add|implement|create|build|new|feature|support|enable|integrate)\b/i,
		/(增加|新增|实现|添加|功能|支持|接入)/,
	]],
	["explore", [
		/\b(find|search|look for|where|locate|explore|check|investigate|list)\b/i,
		/(查找|找|搜|在哪|检查|排查)/,
	]],
];

export function inferIntent(prompt: string): TaskIntent {
	if (!prompt || prompt.length < 4) return "unknown";
	for (const [intent, patterns] of INTENT_PATTERNS) {
		for (const pattern of patterns) {
			if (pattern.test(prompt)) return intent;
		}
	}
	return "unknown";
}

export function buildToolTracePayload(turn: TurnState, turnDuration: number): Record<string, unknown> {
	const toolSummary = new Map<string, { count: number; errors: number; totalMs: number; completed: number }>();
	let totalErrors = 0;

	for (const tc of turn.toolCalls) {
		const entry = toolSummary.get(tc.tool) ?? { count: 0, errors: 0, totalMs: 0, completed: 0 };
		entry.count += 1;
		if (tc.isError) {
			entry.errors += 1;
			totalErrors += 1;
		}
		if (tc.endMs != null) {
			entry.totalMs += tc.endMs - tc.startMs;
			entry.completed += 1;
		}
		toolSummary.set(tc.tool, entry);
	}

	const summarizedTools = Array.from(toolSummary.entries())
		.sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
		.slice(0, MAX_TOOL_SUMMARY_TOOLS)
		.map(([tool, stats]): ToolTraceSummary => ({
			tool,
			count: stats.count,
			errors: stats.errors,
			avg_ms: stats.completed > 0 ? Math.round(stats.totalMs / stats.completed) : null,
			completed_calls: stats.completed,
		}));

	const sequence = turn.toolCalls.slice(0, MAX_TOOL_SEQUENCE).map((tc) => tc.tool);
	const completedToolCalls = turn.toolCalls.filter((tc) => tc.endMs != null).length;

	const payload: Record<string, unknown> = {
		turn_id: turn.turnId,
		tool_calls: summarizedTools,
		tool_sequence: sequence,
		task_signals: {
			prompt_length: (turn.prompt ?? "").length,
			has_error_trace: /\b(error|exception|stack\s?trace|traceback|panic)\b/i.test(turn.prompt ?? ""),
			has_file_reference: /[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|md|json)/.test(turn.prompt ?? ""),
			intent: inferIntent(turn.prompt ?? ""),
		},
		has_tool_usage: turn.toolCalls.length > 0,
		total_tool_calls: turn.toolCalls.length,
		total_errors: totalErrors,
		completed_tool_calls: completedToolCalls,
		truncated_tool_calls: Math.max(0, turn.toolCalls.length - sequence.length),
		truncated_tool_summary: Math.max(0, toolSummary.size - summarizedTools.length),
		duration_ms: turnDuration,
	};

	if (turn.agentResult) {
		payload.agent_loop = {
			stop_reason: turn.agentResult.stopReason,
			turn_count: turn.agentResult.turnCount,
			tool_call_count: turn.agentResult.toolCallCount,
			duration_ms: turn.agentResult.durationMs,
			permission_denial_count: turn.agentResult.permissionDenialCount ?? 0,
			last_transition_reason: turn.agentResult.lastTransition?.reason,
		};
	}

	return payload;
}
