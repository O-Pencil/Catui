/**
 * [WHO]: InterceptorResult, Interceptor
 * [FROM]: Depends on ./detector.js, ./logger.js
 * [TO]: Consumed by extension entry point (./index.ts)
 * [HERE]: extensions/builtin/security-audit/engine/interceptor.ts -
 */


import type { SecurityCheckResult, SecurityConfig, AuditEvent, AuditEventType } from "../interface.js";
import { DangerDetector } from "./detector.js";
import { AuditLogger } from "./logger.js";

/**
 * Interceptor Result
 */
export interface InterceptorResult {
	/** Whether to proceed with the operation */
	proceed: boolean;
	/** The audit event */
	event?: AuditEvent;
	/** Message to display to user */
	message?: string;
}

/**
 * Interceptor class
 */
export class Interceptor {
	private detector: DangerDetector;
	private logger: AuditLogger;
	private config: SecurityConfig;

	constructor(
		detector: DangerDetector,
		logger: AuditLogger,
		config: SecurityConfig,
	) {
		this.detector = detector;
		this.logger = logger;
		this.config = config;
	}

	/**
	 * Intercept a bash command
	 */
	interceptCommand(command: string, cwd: string): InterceptorResult {
		// Always log the command
		const checkResult = this.detector.checkCommand(command);

		const event = this.logger.log({
			type: "command",
			operation: "bash",
			target: command,
			cwd,
			level: checkResult.level,
			status: "allowed",
			reason: checkResult.reason,
			pattern: checkResult.pattern,
		});

		// Check if interception is enabled
		if (!this.config.enableInterception) {
			// Just return the result, no blocking
			return {
				proceed: true,
				event,
			};
		}

		// Handle based on mode
		switch (this.config.mode) {
			case "audit":
				// Just log, don't block
				return {
					proceed: true,
					event,
				};

			case "confirm":
				// Block dangerous operations until confirmed
				if (checkResult.level === "dangerous" && checkResult.requiresConfirm) {
					return {
						proceed: false,
						event: { ...event, status: "warning" },
						message: this.formatWarningMessage(command, checkResult),
					};
				}
				return {
					proceed: true,
					event,
				};

			case "strict":
				// Block everything except whitelist
				if (checkResult.level === "dangerous") {
					return {
						proceed: false,
						event: { ...event, status: "blocked" },
						message: this.formatBlockedMessage(command, checkResult),
					};
				}
				return {
					proceed: true,
					event,
				};

			default:
				return {
					proceed: true,
					event,
				};
		}
	}

	/**
	 * Intercept a file operation
	 */
	interceptFile(
		operation: "read" | "write" | "edit",
		path: string,
		cwd: string,
	): InterceptorResult {
		// Always log the operation
		const checkResult = this.detector.checkFileOperation(operation, path);

		const event = this.logger.log({
			type: `file_${operation}` as AuditEventType,
			operation,
			target: path,
			cwd,
			level: checkResult.level,
			status: "allowed",
			reason: checkResult.reason,
		});

		// Check if interception is enabled
		if (!this.config.enableInterception) {
			return {
				proceed: true,
				event,
			};
		}

		// Handle based on mode
		switch (this.config.mode) {
			case "audit":
				return {
					proceed: true,
					event,
				};

			case "confirm":
				if (checkResult.level === "dangerous" && checkResult.requiresConfirm) {
					return {
						proceed: false,
						event: { ...event, status: "warning" },
						message: this.formatFileWarningMessage(operation, path, checkResult),
					};
				}
				return {
					proceed: true,
					event,
				};

			case "strict":
				if (checkResult.level !== "safe") {
					return {
						proceed: false,
						event: { ...event, status: "blocked" },
						message: this.formatFileBlockedMessage(operation, path, checkResult),
					};
				}
				return {
					proceed: true,
					event,
				};

			default:
				return {
					proceed: true,
					event,
				};
		}
	}

	/**
	 * Format warning message for command
	 */
	private formatWarningMessage(command: string, result: SecurityCheckResult): string {
		return `⚠️  Dangerous operation detected

Command: ${command}

Risk: ${result.reason || "Matches dangerous pattern"}

Operation will be logged to audit trail.`;
	}

	/**
	 * Format blocked message for command
	 */
	private formatBlockedMessage(command: string, result: SecurityCheckResult): string {
		return `🔴 Operation blocked

Command: ${command}

Reason: ${result.reason || "Security policy blocked"}

This operation requires admin privileges or removal from whitelist.`;
	}

	/**
	 * Format warning message for file operation
	 */
	private formatFileWarningMessage(
		operation: string,
		path: string,
		result: SecurityCheckResult,
	): string {
		return `⚠️  Sensitive file operation

Operation: ${operation}
Path: ${path}

Risk: ${result.reason || "File contains sensitive information"}

Operation will be logged to audit trail.`;
	}

	/**
	 * Format blocked message for file operation
	 */
	private formatFileBlockedMessage(
		operation: string,
		path: string,
		result: SecurityCheckResult,
	): string {
		return `🔴 Access denied

Operation: ${operation}
Path: ${path}

Reason: ${result.reason || "Security policy blocks access to this file"}

This file is protected by security policy.`;
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: SecurityConfig): void {
		this.config = config;
	}

	/**
	 * Update detector
	 */
	updateDetector(detector: DangerDetector): void {
		this.detector = detector;
	}
}
