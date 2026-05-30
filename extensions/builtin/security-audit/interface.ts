/**
 * [WHO]: SecurityCheckResult, AuditEvent, LogQueryOptions, SecurityStats, SecurityEngine
 * [FROM]: No external dependencies
 * [TO]: Consumed by extension entry point (./index.ts)
 * [HERE]: extensions/builtin/security-audit/interface.ts -
 */


/**
 * Security check result levels
 */
export type SecurityLevel = "safe" | "warning" | "dangerous";

/**
 * Security check result
 */
export interface SecurityCheckResult {
	/** Whether the operation is allowed */
	allowed: boolean;
	/** Security level of the operation */
	level: SecurityLevel;
	/** Reason for the result */
	reason?: string;
	/** Whether user confirmation is required */
	requiresConfirm?: boolean;
	/** Matched pattern if any */
	pattern?: string;
}

/**
 * Audit event types
 */
export type AuditEventType =
	| "command"
	| "file_read"
	| "file_write"
	| "file_edit"
	| "network"
	| "extension"
	| "session_start"
	| "session_end";

/**
 * Audit event status
 */
export type AuditEventStatus = "allowed" | "blocked" | "warning" | "confirmed";

/**
 * Audit event record
 */
export interface AuditEvent {
	/** Unique event ID */
	id: string;
	/** Event timestamp */
	timestamp: string;
	/** Event type */
	type: AuditEventType;
	/** Operation performed */
	operation: string;
	/** Target path or command */
	target: string;
	/** Working directory */
	cwd: string;
	/** Security level */
	level: SecurityLevel;
	/** Event status */
	status: AuditEventStatus;
	/** Reason if blocked/warning */
	reason?: string;
	/** Pattern matched */
	pattern?: string;
	/** Whether user confirmed */
	userConfirmed?: boolean;
	/** Duration in milliseconds */
	duration?: number;
}

/**
 * Query options for retrieving audit logs
 */
export interface LogQueryOptions {
	/** Start date */
	startDate?: Date;
	/** End date */
	endDate?: Date;
	/** Event types to include */
	types?: AuditEventType[];
	/** Security levels to include */
	levels?: SecurityLevel[];
	/** Maximum results */
	limit?: number;
	/** Offset for pagination */
	offset?: number;
}

/**
 * Security statistics
 */
export interface SecurityStats {
	/** Total events in period */
	totalEvents: number;
	/** Events by type */
	byType: Record<AuditEventType, number>;
	/** Events by level */
	byLevel: Record<SecurityLevel, number>;
	/** Events by status */
	byStatus: Record<AuditEventStatus, number>;
	/** Most common dangerous patterns */
	dangerousPatterns: Array<{ pattern: string; count: number }>;
	/** Period start */
	periodStart: string;
	/** Period end */
	periodEnd: string;
}

/**
 * Standardized security engine interface
 * This interface can be implemented by different security levels:
 * - Light Audit: Just logging
 * - Med Secure: Detection + warning
 * - Heavy Guard: Full interception
 */
export interface SecurityEngine {
	/**
	 * Check if a command is safe to execute
	 */
	checkCommand(command: string, cwd: string): SecurityCheckResult;

	/**
	 * Check if a file operation is allowed
	 */
	checkFileOperation(
		operation: "read" | "write" | "edit",
		path: string,
	): SecurityCheckResult;

	/**
	 * Record an audit event
	 */
	log(event: Omit<AuditEvent, "id" | "timestamp">): AuditEvent;

	/**
	 * Query audit logs
	 */
	queryLogs(options?: LogQueryOptions): AuditEvent[];

	/**
	 * Get security statistics
	 */
	getStats(options?: LogQueryOptions): SecurityStats;

	/**
	 * Clear audit logs
	 */
	clearLogs(): void;

	/**
	 * Export logs to JSON
	 */
	exportLogs(format?: "json" | "html"): string;
}

/**
 * Security configuration
 */
export interface SecurityConfig {
	/** Whether security audit is enabled */
	enabled: boolean;
	/** Security mode */
	mode: "audit" | "confirm" | "strict";
	/** Enable logging */
	enableLogging: boolean;
	/** Enable danger detection */
	enableDetection: boolean;
	/** Enable interception (requires user confirm) */
	enableInterception: boolean;
	/** Enable whitelist */
	enableWhitelist: boolean;
	/** Dangerous command patterns */
	dangerousPatterns: string[];
	/** Sensitive file paths */
	sensitivePaths: string[];
	/** Whitelisted commands */
	whitelist: string[];
	/** Maximum log entries to keep */
	maxLogEntries: number;
}

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
	enabled: true,
	mode: "audit",
	enableLogging: true,
	enableDetection: true,
	enableInterception: false,
	enableWhitelist: false,
	dangerousPatterns: [
		// Recursive deletion
		"rm\\s+-rf",
		"rmdir\\s+/s",
		"del\\s+/s",
		"rmdir\\s+/s",
		// System modification
		"sudo\\s+",
		"chmod\\s+777",
		"chown\\s+",
		// Process control
		"kill\\s+-9",
		"pkill\\s+-9",
		"killall\\s+",
		// Network download (can be dangerous)
		"curl\\s+.*\\|\\s*sh",
		"wget\\s+.*\\|\\s*sh",
		"Invoke-Expression.*WebRequest",
		// Git dangerous operations
		"git\\s+push\\s+--force",
		"git\\s+push\\s+-f",
		// Container/system
		"docker\\s+rm\\s+-f",
		"docker\\s+run\\s+--rm",
		"systemctl\\s+stop",
		"systemctl\\s+restart",
	],
	sensitivePaths: [
		// SSH keys
		"~/.ssh/",
		"/.ssh/",
		// Credentials
		"~/.aws/",
		"~/.azure/",
		"~/.gcloud/",
		// Environment
		".env",
		".env.local",
		".env.production",
		// System
		"/etc/passwd",
		"/etc/shadow",
		"/etc/sudoers",
		// Git
		".git/config",
	],
	whitelist: [
		"git status",
		"git diff",
		"git log",
		"git branch",
		"npm install",
		"npm run",
		"pnpm install",
		"pnpm run",
		"yarn",
		"ls",
		"cat",
		"grep",
	],
	maxLogEntries: 10000,
};
