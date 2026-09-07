/**
 * [WHO]: Nonblocking live observation hooks and opt-in sidecar startup
 * [FROM]: Host extension API, configuration and local spool/process adapters
 * [TO]: Evolution extension entry
 * [HERE]: extensions/optional/evolution/source/runtime/bridge.ts - foreground bridge
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "../../../../../core/extensions-host/types.js";
import { VERSION } from "../../../../../config.js";
import { loadConfig, sourceRoot } from "./config.js";
import { digest, fingerprint, sanitize, spool } from "./observer.js";
import { startDaemon } from "./service.js";
import type { Observation } from "../types.js";

export function registerSourceEvolution(api: ExtensionAPI): void {
	if (process.env.CATUI_EVOLUTION_WORKER === "1") return;
	let root: string | undefined;
	let run = randomUUID();
	let pending = 0;
	let failureReported = false;
	const starts = new Map<string, number>();
	const inputs = new Map<string, number>();
	const repeated = new Set<string>();
	const emit = (event: Omit<Observation, "id" | "time" | "run" | "fingerprint">) => {
		if (!root || pending >= 32) return;
		pending++;
		void spool(root, { ...event, id: randomUUID(), time: new Date().toISOString(), run, fingerprint: fingerprint(`${event.version}:${event.tool ?? event.kind}`, event.summary) })
			.catch(() => {
				if (!failureReported) { failureReported = true; api.sendMessage({ customType: "evolution", content: "Source evolution observation is unavailable; inspect catui evolve status.", display: true }); }
			}).finally(() => pending--);
	};
	api.on("session_start", (_event, ctx) => {
		root = undefined;
		try {
			const candidate = sourceRoot(ctx.agentDir);
			if (!loadConfig(candidate)?.enabled) return;
			root = candidate;
			void startDaemon(root).catch(() => {});
		} catch { root = undefined; }
	});
	api.on("before_agent_start", (event, ctx) => {
		if (!root) return;
		run = randomUUID(); starts.clear(); inputs.clear(); repeated.clear();
		const correction = /(?:that(?:'s| is) wrong|incorrect|still broken|didn.t fix|不对|没完成|没有解决|还是报错)/i.test(event.prompt);
		emit({ kind: "task", session: ctx.sessionManager.getSessionId(), workspace: digest(ctx.cwd), version: VERSION, model: ctx.model?.id ?? "unknown", failed: correction, summary: sanitize(event.prompt) });
	});
	api.on("tool_execution_start", event => {
		if (!root) return;
		starts.set(event.toolCallId, Date.now());
		const key = digest(`${event.toolName}:${JSON.stringify(event.args)}`);
		const count = (inputs.get(key) ?? 0) + 1; inputs.set(key, count);
		if (count >= 3) repeated.add(event.toolCallId);
	});
	api.on("tool_execution_end", (event, ctx) => {
		if (!root) return;
		const result = event.result as { content?: { type: string; text?: string }[] } | undefined;
		const durationMs = Date.now() - (starts.get(event.toolCallId) ?? Date.now());
		const inefficient = repeated.has(event.toolCallId) || durationMs > 120000;
		const text = event.isError ? (result?.content ?? []).filter(p => p.type === "text").map(p => p.text ?? "").join("\n") : repeated.has(event.toolCallId) ? "Repeated identical tool request" : durationMs > 120000 ? "Tool took over two minutes" : "Tool completed";
		emit({ kind: "tool", tool: event.toolName, session: ctx.sessionManager.getSessionId(), workspace: digest(ctx.cwd), version: VERSION, model: ctx.model?.id ?? "unknown", failed: event.isError, inefficient, summary: sanitize(text), durationMs });
		starts.delete(event.toolCallId);
		repeated.delete(event.toolCallId);
	});
	api.on("turn_end", (event, ctx) => {
		if (!root) return;
		if (event.message.role !== "assistant") return;
		emit({ kind: "usage", session: ctx.sessionManager.getSessionId(), workspace: digest(ctx.cwd), version: VERSION, model: ctx.model?.id ?? "unknown", failed: false, summary: "Assistant turn usage", tokens: event.message.usage.totalTokens });
	});
	api.on("agent_result", (event, ctx) => {
		if (!root) return;
		emit({ kind: "result", session: ctx.sessionManager.getSessionId(), workspace: digest(ctx.cwd), version: VERSION, model: ctx.model?.id ?? "unknown", failed: Boolean(event.errorMessage), summary: sanitize(event.errorMessage ?? event.stopReason ?? "Completed"), durationMs: event.durationMs });
	});
	api.on("session_shutdown", () => { root = undefined; starts.clear(); });
}
