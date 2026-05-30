/**
 * [WHO]: DebugLogger class, debug logging system for AI provider troubleshooting
 * [FROM]: Depends on node:fs, node:path, ./config-path
 * [TO]: Consumed by ai package providers for logging
 * [HERE]: core/lib/ai/src/debug-logger.ts - debug logging for nanopencil AI providers
 */
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getDebugLogPath } from "./config-path.js";

export type DebugLogLevel = "error" | "warn" | "info" | "debug" | "trace";

interface DebugLoggerOptions {
	enabled?: boolean;
	level?: DebugLogLevel;
	maxFileSize?: number; // bytes, default 10MB
}

const LOG_LEVELS: Record<DebugLogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
	trace: 4,
};

class DebugLogger {
	private enabled: boolean;
	private level: number;
	private maxFileSize: number;
	private logPath: string;

	constructor(options: DebugLoggerOptions = {}) {
		this.enabled = options.enabled ?? this.detectEnabled();
		this.level = LOG_LEVELS[options.level ?? this.detectLevel()];
		this.maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024; // 10MB
		this.logPath = getDebugLogPath();
	}

	/**
	 * Detect if debug logging is enabled from environment
	 */
	private detectEnabled(): boolean {
		return (
			process.env.NANOPENCIL_DEBUG === "1" ||
			process.env.DEBUG?.includes("nanopencil") ||
			false
		);
	}

	/**
	 * Detect log level from environment
	 */
	private detectLevel(): DebugLogLevel {
		const level = process.env.NANOPENCIL_DEBUG_LEVEL;
		if (level && level in LOG_LEVELS) {
			return level as DebugLogLevel;
		}
		return "info";
	}

	/**
	 * Enable or disable logging at runtime
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	/**
	 * Set log level at runtime
	 */
	setLevel(level: DebugLogLevel): void {
		this.level = LOG_LEVELS[level];
	}

	/**
	 * Re-check environment variables (for when they change after initialization)
	 */
	refreshFromEnv(): void {
		this.enabled = this.detectEnabled();
		this.level = LOG_LEVELS[this.detectLevel()];
	}

	/**
	 * Check if a specific level is enabled
	 */
	private isLevelEnabled(level: DebugLogLevel): boolean {
		// Re-check environment on each log call to handle late-set env vars
		if (!this.enabled && process.env.NANOPENCIL_DEBUG === "1") {
			this.refreshFromEnv();
		}
		return this.enabled && LOG_LEVELS[level] <= this.level;
	}

	/**
	 * Write a log entry to file
	 */
	private writeLog(level: DebugLogLevel, category: string, message: string, data?: unknown): void {
		if (!this.isLevelEnabled(level)) return;

		const timestamp = new Date().toISOString();
		const levelStr = level.toUpperCase().padStart(5);
		let logLine = `[${timestamp}] [${levelStr}] [${category}] ${message}`;

		if (data !== undefined) {
			try {
				const dataStr = typeof data === "string" ? data : JSON.stringify(data, null, 2);
				logLine += `\n${dataStr}`;
			} catch {
				logLine += `\n[Unable to serialize data]`;
			}
		}

		logLine += "\n";

		try {
			// Ensure directory exists
			const dir = dirname(this.logPath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}

			// Check file size and rotate if needed
			this.rotateIfNeeded();

			appendFileSync(this.logPath, logLine);
		} catch {
			// Silently fail - debug logging should never break the app
		}
	}

	/**
	 * Rotate log file if it exceeds max size
	 */
	private rotateIfNeeded(): void {
		try {
			const { statSync, renameSync, existsSync } = require("fs");
			if (existsSync(this.logPath)) {
				const stats = statSync(this.logPath);
				if (stats.size > this.maxFileSize) {
					const backupPath = `${this.logPath}.old`;
					if (existsSync(backupPath)) {
						require("fs").unlinkSync(backupPath);
					}
					renameSync(this.logPath, backupPath);
				}
			}
		} catch {
			// Ignore rotation errors
		}
	}

	// Public logging methods
	error(category: string, message: string, data?: unknown): void {
		this.writeLog("error", category, message, data);
	}

	warn(category: string, message: string, data?: unknown): void {
		this.writeLog("warn", category, message, data);
	}

	info(category: string, message: string, data?: unknown): void {
		this.writeLog("info", category, message, data);
	}

	debug(category: string, message: string, data?: unknown): void {
		this.writeLog("debug", category, message, data);
	}

	trace(category: string, message: string, data?: unknown): void {
		this.writeLog("trace", category, message, data);
	}

	/**
	 * Log AI provider request
	 */
	logProviderRequest(provider: string, model: string, request: unknown): void {
		this.debug("AI", `Request to ${provider}/${model}`, request);
	}

	/**
	 * Log AI provider response chunk (for streaming)
	 */
	logProviderChunk(provider: string, model: string, chunk: unknown): void {
		this.trace("AI", `Chunk from ${provider}/${model}`, chunk);
	}

	/**
	 * Log AI provider response (non-streaming)
	 */
	logProviderResponse(provider: string, model: string, response: unknown): void {
		this.debug("AI", `Response from ${provider}/${model}`, response);
	}

	/**
	 * Log content parsing events
	 */
	logContentParse(operation: string, input: unknown, output?: unknown): void {
		this.trace("PARSE", operation, { input, output });
	}

	/**
	 * Log TUI rendering events
	 */
	logTUI(operation: string, details?: unknown): void {
		this.trace("TUI", operation, details);
	}

	/**
	 * Get the log file path
	 */
	getLogPath(): string {
		return this.logPath;
	}

	/**
	 * Clear the log file
	 */
	clear(): void {
		try {
			const { writeFileSync } = require("fs");
			writeFileSync(this.logPath, "");
		} catch {
			// Ignore clear errors
		}
	}
}

// Singleton instance
let globalLogger: DebugLogger | null = null;

export function getDebugLogger(): DebugLogger {
	if (!globalLogger) {
		globalLogger = new DebugLogger();
	}
	return globalLogger;
}

export function createDebugLogger(options: DebugLoggerOptions): DebugLogger {
	return new DebugLogger(options);
}

// Export singleton methods for convenience
export const debug = {
	error: (category: string, message: string, data?: unknown) => getDebugLogger().error(category, message, data),
	warn: (category: string, message: string, data?: unknown) => getDebugLogger().warn(category, message, data),
	info: (category: string, message: string, data?: unknown) => getDebugLogger().info(category, message, data),
	debug: (category: string, message: string, data?: unknown) => getDebugLogger().debug(category, message, data),
	trace: (category: string, message: string, data?: unknown) => getDebugLogger().trace(category, message, data),
	logProviderRequest: (provider: string, model: string, request: unknown) =>
		getDebugLogger().logProviderRequest(provider, model, request),
	logProviderChunk: (provider: string, model: string, chunk: unknown) =>
		getDebugLogger().logProviderChunk(provider, model, chunk),
	logProviderResponse: (provider: string, model: string, response: unknown) =>
		getDebugLogger().logProviderResponse(provider, model, response),
	logContentParse: (operation: string, input: unknown, output?: unknown) =>
		getDebugLogger().logContentParse(operation, input, output),
	getLogPath: () => getDebugLogger().getLogPath(),
	clear: () => getDebugLogger().clear(),
};
