/**
 * [WHO]: SecurityAudit extension - audit logging and dangerous pattern detection
 * [FROM]: Depends on core/extensions/types, ./engine/detector, ./engine/logger, ./interface
 * [TO]: Consumed by builtin-extensions.ts as default extension
 * [HERE]: extensions/defaults/security-audit/index.ts - security auditing for NanoPencil operations
 *
 * Features:
 * - Audit logging for all operations
 * - Dangerous pattern detection
 * - Optional interception for dangerous operations
 */


import { AuditLogger } from "./engine/logger.js";
import { DangerDetector } from "./engine/detector.js";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
} from "../../../core/extensions/types.js";
import type { AuditEventType } from "./interface.js";
import { DEFAULT_SECURITY_CONFIG } from "./interface.js";

// ============================================================
// Security Audit Extension
// ============================================================

const SECURITY_MESSAGE_TYPE = "security-audit";

// Security mode: "audit" (warn only), "strict" (block dangerous)
const SECURITY_MODE = process.env.SECURITY_MODE as string || "strict";
const detector = new DangerDetector({
	...DEFAULT_SECURITY_CONFIG,
	mode: SECURITY_MODE === "audit" || SECURITY_MODE === "confirm" || SECURITY_MODE === "strict"
		? SECURITY_MODE
		: "strict",
});

// Cache loggers per agent to support multi-agent
const loggers = new Map<string, AuditLogger>();

function getLogger(ctx: ExtensionContext): AuditLogger {
	const agentCtx = (ctx.sessionManager as any).getAgentCtx?.() || { id: "default", path: (ctx as any).agentDir };
	let logger = loggers.get(agentCtx.id);
	if (!logger) {
		logger = new AuditLogger(10000, agentCtx);
		loggers.set(agentCtx.id, logger);
	}
	return logger;
}

function sendSecurityNotice(api: ExtensionAPI, content: string): void {
	api.sendMessage(
		{
			customType: SECURITY_MESSAGE_TYPE,
			content,
			display: true,
		},
		{ triggerTurn: true },
	);
}

function auditAndGateToolCall(api: ExtensionAPI, event: ToolCallEvent, ctx: ExtensionContext): ToolCallEventResult | void {
	const logger = getLogger(ctx);
	const toolName = event.toolName;
	const args = event.input || {};

	if (toolName === "bash" || toolName === "Bash") {
		const command = (args as Record<string, unknown>).command as string | undefined;
		if (!command) return;

		const result = detector.checkCommand(command);
		const shouldBlock = result.level === "dangerous" && SECURITY_MODE === "strict";

		logger.log({
			type: "command",
			operation: "bash",
			target: command,
			cwd: ctx.cwd,
			level: result.level,
			status: shouldBlock ? "blocked" : result.level === "safe" ? "allowed" : "warning",
			reason: result.reason,
			pattern: result.pattern,
		});

		if (result.level !== "dangerous") return;

		if (shouldBlock) {
			const reason = `Security blocked bash command: ${result.reason}`;
			sendSecurityNotice(api, `${reason}\n\nCommand: \`${command}\``);
			return { block: true, reason };
		}

		sendSecurityNotice(
			api,
			`Security warning: ${result.reason}\n\nCommand: \`${command}\`\n\nThis will be logged to security audit.`,
		);
		return;
	}

	if (toolName === "write" || toolName === "Write" || toolName === "edit" || toolName === "Edit") {
		const input = args as Record<string, unknown>;
		const filePath = input.file_path || input.path || input.filePath;
		if (!filePath) return;

		const operation = toolName === "write" || toolName === "Write" ? "write" : "edit";
		const result = detector.checkFileOperation(operation, filePath as string);
		const shouldBlock = result.level === "dangerous";

		logger.log({
			type: `file_${operation}` as AuditEventType,
			operation,
			target: filePath as string,
			cwd: ctx.cwd,
			level: result.level,
			status: shouldBlock ? "blocked" : result.level === "safe" ? "allowed" : "warning",
			reason: result.reason,
		});

		if (!shouldBlock) return;

		const reason = `Security blocked ${operation}: ${result.reason}`;
		sendSecurityNotice(api, `${reason}\n\nPath: \`${filePath}\``);
		return { block: true, reason };
	}
}

export default function securityAuditExtension(api: ExtensionAPI) {
	// /security - Show security dashboard
	api.registerCommand("security", {
		description: "Show security audit dashboard and logs",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const logger = getLogger(ctx);
			const stats = logger.getStats();
			const logs = logger.query({ limit: 20 });

			let content = `# 🔒 Security Audit\n\n`;
			content += `## Statistics\n`;
			content += `- Total Events: ${stats.totalEvents}\n`;
			content += `- Dangerous: ${stats.byLevel.dangerous}\n`;
			content += `- Warnings: ${stats.byLevel.warning}\n`;
			content += `- Blocked: ${stats.byStatus.blocked}\n\n`;

			if (stats.dangerousPatterns.length > 0) {
				content += `## Dangerous Patterns\n`;
				for (const p of stats.dangerousPatterns.slice(0, 5)) {
					content += `- \`${p.pattern}\`: ${p.count}\n`;
				}
				content += `\n`;
			}

			content += `## Recent Events\n`;
			content += `| Time | Type | Level | Target |\n`;
			content += `|------|------|-------|--------|\n`;
			for (const log of logs) {
				const time = log.timestamp.split("T")[1].split(".")[0];
				content += `| ${time} | ${log.type} | ${log.level} | \`${log.target.slice(0, 30)}...\` |\n`;
			}

			api.sendMessage(
				{
					customType: SECURITY_MESSAGE_TYPE,
					content,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	// /security-logs - Show detailed logs
	api.registerCommand("security-logs", {
		description: "Show detailed security audit logs",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const logger = getLogger(ctx);
			const limit = parseInt(args) || 50;
			const logs = logger.query({ limit });

			let content = `# Security Audit Logs (${logs.length} entries)\n\n`;

			for (const log of logs) {
				const icon = log.status === "blocked" ? "🔴" : log.level === "dangerous" ? "⚠️" : "✅";
				content += `${icon} [${log.timestamp}] ${log.type}: ${log.operation}\n`;
				content += `   Target: ${log.target}\n`;
				content += `   Level: ${log.level}, Status: ${log.status}\n`;
				if (log.reason) {
					content += `   Reason: ${log.reason}\n`;
				}
				content += "\n";
			}

			api.sendMessage(
				{
					customType: SECURITY_MESSAGE_TYPE,
					content,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	// /security-stats - Show statistics
	api.registerCommand("security-stats", {
		description: "Show security audit statistics",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const logger = getLogger(ctx);
			const stats = logger.getStats();

			let content = `# Security Statistics\n\n`;
			content += `## Overview\n`;
			content += `- Period: ${stats.periodStart.split("T")[0]} ~ ${stats.periodEnd.split("T")[0]}\n`;
			content += `- Total Events: ${stats.totalEvents}\n\n`;

			content += `## By Level\n`;
			content += `- Safe: ${stats.byLevel.safe}\n`;
			content += `- Warning: ${stats.byLevel.warning}\n`;
			content += `- Dangerous: ${stats.byLevel.dangerous}\n\n`;

			content += `## By Status\n`;
			content += `- Allowed: ${stats.byStatus.allowed}\n`;
			content += `- Blocked: ${stats.byStatus.blocked}\n`;
			content += `- Confirmed: ${stats.byStatus.confirmed}\n\n`;

			if (stats.dangerousPatterns.length > 0) {
				content += `## Dangerous Patterns\n`;
				for (const p of stats.dangerousPatterns) {
					content += `- \`${p.pattern}\`: ${p.count}\n`;
				}
			}

			api.sendMessage(
				{
					customType: SECURITY_MESSAGE_TYPE,
					content,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	// /security-clear - Clear logs
	api.registerCommand("security-clear", {
		description: "Clear security audit logs",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const logger = getLogger(ctx);
			logger.clear();
			api.sendMessage(
				{
					customType: SECURITY_MESSAGE_TYPE,
					content: "✅ Security audit logs cleared.",
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});

	// Tool call is the authoritative pre-execution boundary. Returning
	// `{ block: true }` here prevents the wrapped tool from running.
	api.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext): ToolCallEventResult | void => auditAndGateToolCall(api, event, ctx));
}
