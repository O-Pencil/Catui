/**
 * [WHO]: AuditLogger
 * [FROM]: Depends on node:fs, node:path, node:crypto, ../../../../config.js
 * [TO]: Consumed by extension entry point (./index.ts)
 * [HERE]: extensions/defaults/security-audit/engine/logger.ts -
 */


import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AuditEvent, LogQueryOptions, SecurityStats, AuditEventType, SecurityLevel, AuditEventStatus } from "../interface.js";
import { getAgentDir } from "../../../../config.js";

/**
 * Generate unique event ID
 */
function generateId(): string {
	return randomBytes(8).toString("hex");
}

/**
 * Audit Logger class
 */
export class AuditLogger {
	private logs: AuditEvent[] = [];
	private maxEntries: number;
	private agentDir: string;

	/**
	 * @param maxEntries Maximum number of entries to keep
	 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
	 */
	constructor(maxEntries: number = 10000, agentDir?: string) {
		this.maxEntries = maxEntries;
		this.agentDir = agentDir ?? getAgentDir();
		this.load();
	}

	/**
	 * Get audit log file path
	 */
	private getLogPath(): string {
		return join(this.agentDir, "security-audit.json");
	}

	/**
	 * Ensure log directory exists
	 */
	private ensureLogDir(): void {
		if (!existsSync(this.agentDir)) {
			mkdirSync(this.agentDir, { recursive: true });
		}
	}

	/**
	 * Load logs from disk
	 */
	load(): void {
		const logPath = this.getLogPath();
		try {
			if (existsSync(logPath)) {
				const content = readFileSync(logPath, "utf-8");
				const logs = JSON.parse(content);
				this.logs = Array.isArray(logs) ? logs : [];
			}
		} catch {
			// If error, return empty array
			this.logs = [];
		}
	}

	/**
	 * Save logs to file
	 */
	private saveLogs(): void {
		this.ensureLogDir();
		const logPath = this.getLogPath();
		writeFileSync(logPath, JSON.stringify(this.logs, null, 2), "utf-8");
	}

	/**
	 * Record an audit event
	 */
	log(event: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
		const auditEvent: AuditEvent = {
			...event,
			id: generateId(),
			timestamp: new Date().toISOString(),
		};

		// Add to in-memory logs
		this.logs.push(auditEvent);

		// Trim if exceeds max entries
		if (this.logs.length > this.maxEntries) {
			this.logs = this.logs.slice(-this.maxEntries);
		}

		// Persist to disk
		this.saveLogs();

		return auditEvent;
	}

	/**
	 * Query logs with filters
	 */
	query(options?: LogQueryOptions): AuditEvent[] {
		let filtered = [...this.logs];

		if (options) {
			// Filter by date range
			if (options.startDate) {
				filtered = filtered.filter((e) => new Date(e.timestamp) >= options.startDate!);
			}
			if (options.endDate) {
				filtered = filtered.filter((e) => new Date(e.timestamp) <= options.endDate!);
			}

			// Filter by types
			if (options.types && options.types.length > 0) {
				filtered = filtered.filter((e) => options.types!.includes(e.type));
			}

			// Filter by levels
			if (options.levels && options.levels.length > 0) {
				filtered = filtered.filter((e) => options.levels!.includes(e.level));
			}

			// Apply pagination
			if (options.offset) {
				filtered = filtered.slice(options.offset);
			}
			if (options.limit) {
				filtered = filtered.slice(0, options.limit);
			}
		}

		return filtered;
	}

	/**
	 * Get statistics
	 */
	getStats(options?: LogQueryOptions): SecurityStats {
		const logs = this.query(options);

		const byType: Record<AuditEventType, number> = {
			command: 0,
			file_read: 0,
			file_write: 0,
			file_edit: 0,
			network: 0,
			extension: 0,
			session_start: 0,
			session_end: 0,
		};

		const byLevel: Record<SecurityLevel, number> = {
			safe: 0,
			warning: 0,
			dangerous: 0,
		};

		const byStatus: Record<AuditEventStatus, number> = {
			allowed: 0,
			blocked: 0,
			warning: 0,
			confirmed: 0,
		};

		const patternCounts = new Map<string, number>();

		for (const log of logs) {
			// Count by type
			if (log.type in byType) {
				byType[log.type]++;
			}

			// Count by level
			if (log.level in byLevel) {
				byLevel[log.level]++;
			}

			// Count by status
			if (log.status in byStatus) {
				byStatus[log.status]++;
			}

			// Count patterns
			if (log.pattern) {
				patternCounts.set(log.pattern, (patternCounts.get(log.pattern) || 0) + 1);
			}
		}

		// Sort patterns by count
		const dangerousPatterns = Array.from(patternCounts.entries())
			.map(([pattern, count]) => ({ pattern, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 10);

		const periodStart = logs.length > 0 ? logs[0].timestamp : new Date().toISOString();
		const periodEnd = logs.length > 0 ? logs[logs.length - 1].timestamp : new Date().toISOString();

		return {
			totalEvents: logs.length,
			byType,
			byLevel,
			byStatus,
			dangerousPatterns,
			periodStart,
			periodEnd,
		};
	}

	/**
	 * Clear all logs
	 */
	clear(): void {
		this.logs = [];
		this.saveLogs();
	}

	/**
	 * Export logs as JSON
	 */
	exportJson(): string {
		return JSON.stringify(this.logs, null, 2);
	}

	/**
	 * Export logs as HTML
	 */
	exportHtml(): string {
		const logs = this.logs.slice(-100); // Last 100 entries

		const rows = logs
			.map(
				(log) => `
		<tr>
			<td>${log.timestamp.split("T")[1].split(".")[0]}</td>
			<td>${log.type}</td>
			<td class="${log.level === "dangerous" ? "danger" : log.level === "warning" ? "warning" : "safe"}">${log.level}</td>
			<td><code>${log.target.substring(0, 50)}${log.target.length > 50 ? "..." : ""}</code></td>
			<td>${log.status}</td>
		</tr>`,
			)
			.join("\n");

		return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<title>Security Audit Log - NanoPencil</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; background: #1a1a2e; color: #eee; }
		h1 { color: #00d4ff; }
		table { width: 100%; border-collapse: collapse; margin-top: 20px; }
		th, td { padding: 10px; text-align: left; border-bottom: 1px solid #333; }
		th { background: #16213e; }
		tr:hover { background: #1f1f3a; }
		code { background: #2a2a4a; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
		.danger { color: #ff4757; }
		.warning { color: #ffa502; }
		.safe { color: #2ed573; }
		.summary { display: flex; gap: 20px; margin: 20px 0; }
		.stat { background: #16213e; padding: 15px 25px; border-radius: 8px; }
		.stat-value { font-size: 2em; font-weight: bold; color: #00d4ff; }
		.stat-label { color: #888; }
	</style>
</head>
<body>
	<h1>🔒 Security Audit Log</h1>
	<p>Generated: ${new Date().toISOString()}</p>

	<div class="summary">
		<div class="stat">
			<div class="stat-value">${logs.length}</div>
			<div class="stat-label">Events</div>
		</div>
		<div class="stat">
			<div class="stat-value">${logs.filter((l) => l.level === "dangerous").length}</div>
			<div class="stat-label">Dangerous</div>
		</div>
		<div class="stat">
			<div class="stat-value">${logs.filter((l) => l.status === "blocked").length}</div>
			<div class="stat-label">Blocked</div>
		</div>
	</div>

	<table>
		<thead>
			<tr>
				<th>Time</th>
				<th>Type</th>
				<th>Level</th>
				<th>Target</th>
				<th>Status</th>
			</tr>
		</thead>
		<tbody>
			${rows}
		</tbody>
	</table>
</body>
</html>`;
	}

	/**
	 * Get total log count
	 */
	getCount(): number {
		return this.logs.length;
	}
}