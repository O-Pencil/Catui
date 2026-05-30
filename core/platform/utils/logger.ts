/**
 * [WHO]: AgentLogger, createLogger(), structured logging for agent sessions
 * [FROM]: No external dependencies
 * [TO]: Consumed by core/runtime/agent-session.ts, core/extensions-host/runner.ts, core/tools/*
 * [HERE]: core/platform/utils/logger.ts - structured JSON logging with session/turn/span tracing
 */

/** Log levels in priority order */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured log entry */
export interface LogEntry {
	/** Timestamp in ISO 8601 */
	timestamp: string;
	/** Log level */
	level: LogLevel;
	/** Human-readable message */
	message: string;
	/** Session ID for correlation */
	sessionId?: string;
	/** Turn index within session */
	turnId?: number;
	/** Tool call ID for tool execution tracing */
	toolCallId?: string;
	/** Component/module source */
	component?: string;
	/** Duration in milliseconds (for spans) */
	durationMs?: number;
	/** Additional structured data */
	data?: Record<string, unknown>;
}

/** Logger configuration */
export interface LoggerConfig {
	/** Minimum log level (default: "info") */
	level?: LogLevel;
	/** Session ID (set once per session) */
	sessionId?: string;
	/** Component name prefix */
	component?: string;
	/** Custom output handler (default: console.error for warn/error, console.log for info/debug) */
	handler?: (entry: LogEntry) => void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

/** Format a LogEntry as a single-line JSON string */
export function formatLogEntry(entry: LogEntry): string {
	return JSON.stringify(entry);
}

/** Default handler: writes to console with structured format */
function defaultHandler(entry: LogEntry): void {
	const line = formatLogEntry(entry);
	if (entry.level === "error" || entry.level === "warn") {
		console.error(line);
	} else {
		console.log(line);
	}
}

/**
 * AgentLogger — structured logger with session/turn/span tracing.
 *
 * Usage:
 * ```typescript
 * const logger = createLogger({ sessionId: "abc123", component: "compaction" });
 * logger.info("Compaction started", { turnId: 5 });
 * logger.warn("Slow tool execution", { toolCallId: "call_123", durationMs: 5000 });
 * ```
 */
export interface AgentLogger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
	/** Create a child logger with additional context */
	child(extra: { component?: string; turnId?: number; toolCallId?: string }): AgentLogger;
	/** Measure duration of an async operation */
	measure<T>(label: string, fn: () => Promise<T>, data?: Record<string, unknown>): Promise<T>;
}

class LoggerImpl implements AgentLogger {
	private _config: Required<Pick<LoggerConfig, "level">> & Omit<LoggerConfig, "level">;
	private _extra: { turnId?: number; toolCallId?: string } = {};

	constructor(config: LoggerConfig = {}) {
		this._config = {
			level: config.level ?? "info",
			sessionId: config.sessionId,
			component: config.component,
			handler: config.handler,
		};
	}

	debug(message: string, data?: Record<string, unknown>): void {
		this._log("debug", message, data);
	}

	info(message: string, data?: Record<string, unknown>): void {
		this._log("info", message, data);
	}

	warn(message: string, data?: Record<string, unknown>): void {
		this._log("warn", message, data);
	}

	error(message: string, data?: Record<string, unknown>): void {
		this._log("error", message, data);
	}

	child(extra: { component?: string; turnId?: number; toolCallId?: string }): AgentLogger {
		return new LoggerImpl({
			level: this._config.level,
			sessionId: this._config.sessionId,
			component: extra.component ?? this._config.component,
			handler: this._config.handler,
		})._withExtra(extra);
	}

	async measure<T>(label: string, fn: () => Promise<T>, data?: Record<string, unknown>): Promise<T> {
		const start = performance.now();
		try {
			const result = await fn();
			const durationMs = Math.round(performance.now() - start);
			this._log("info", `${label} completed`, { ...data, durationMs });
			return result;
		} catch (err) {
			const durationMs = Math.round(performance.now() - start);
			this._log("error", `${label} failed`, {
				...data,
				durationMs,
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	}

	private _withExtra(extra: { turnId?: number; toolCallId?: string }): LoggerImpl {
		this._extra = extra;
		return this;
	}

	private _log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
		if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this._config.level]) return;

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			sessionId: this._config.sessionId,
			component: this._config.component,
			...this._extra,
			...(data ?? {}),
		};

		// Remove undefined fields
		for (const key of Object.keys(entry) as (keyof LogEntry)[]) {
			if (entry[key] === undefined) {
				delete entry[key];
			}
		}

		const handler = this._config.handler ?? defaultHandler;
		handler(entry);
	}
}

/**
 * Create a new AgentLogger instance.
 */
export function createLogger(config?: LoggerConfig): AgentLogger {
	return new LoggerImpl(config);
}

/**
 * No-op logger that discards all output.
 * Useful for tests or when logging is disabled.
 */
export const noopLogger: AgentLogger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	child: () => noopLogger,
	measure: (label, fn) => fn(),
};
