/**
 * [WHO]: Diagnostic data collectors for /debug command
 * [FROM]: Depends on core/extensions-host/types, node:os, node:child_process
 * [TO]: Consumed by extensions/builtin/debug/index.ts
 * [HERE]: extensions/builtin/debug/collectors.ts - structured system state snapshots
 */

import { execFile } from "node:child_process";
import * as os from "node:os";
import { promisify } from "node:util";
import type { ExtensionContext } from "../../../core/extensions-host/types.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 3_000;
const MAX_GIT_STATUS_LINES = 50;

// ============================================================================
// Result types
// ============================================================================

interface CollectorResult<T> {
	data: T | null;
	error: string | null;
}

export interface SystemInfo {
	platform: string;
	arch: string;
	release: string;
	nodeVersion: string;
	hostname: string;
	cpuCount: number;
	cpuModel: string;
	totalMemoryGB: number;
	freeMemoryGB: number;
	uptimeHours: number;
	shell: string;
	term: string;
}

export interface ModelInfo {
	modelId: string;
	modelName: string;
	provider: string;
	baseUrl: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
	contextUsagePercent: number | null;
	contextTokens: number | null;
}

export interface SessionInfo {
	sessionId: string;
	sessionFile: string;
	cwd: string;
	sessionName: string | undefined;
	entryCount: number;
	leafId: string | null;
}

export interface ConfigInfo {
	defaultProvider: string | undefined;
	defaultModel: string | undefined;
	thinkingLevel: string | undefined;
	theme: string | undefined;
	locale: string | undefined;
	transport: string | undefined;
	steeringMode: string | undefined;
	extensionCount: number;
	packageCount: number;
}

export interface GitInfo {
	isRepo: boolean;
	branch: string;
	lastCommit: string;
	statusSummary: string;
	remoteUrl: string;
}

export interface AgentState {
	isIdle: boolean;
	hasPendingMessages: boolean;
	systemPromptLength: number;
	soulEnabled: boolean;
}

export interface DiagnosticData {
	system: CollectorResult<SystemInfo>;
	model: CollectorResult<ModelInfo>;
	session: CollectorResult<SessionInfo>;
	config: CollectorResult<ConfigInfo>;
	git: CollectorResult<GitInfo>;
	agent: CollectorResult<AgentState>;
}

// ============================================================================
// Collectors
// ============================================================================

export async function collectSystemInfo(): Promise<CollectorResult<SystemInfo>> {
	try {
		const cpus = os.cpus();
		return {
			data: {
				platform: os.platform(),
				arch: os.arch(),
				release: os.release(),
				nodeVersion: process.version,
				hostname: os.hostname(),
				cpuCount: cpus.length,
				cpuModel: cpus[0]?.model ?? "unknown",
				totalMemoryGB: Number((os.totalmem() / 1073741824).toFixed(1)),
				freeMemoryGB: Number((os.freemem() / 1073741824).toFixed(1)),
				uptimeHours: Number((os.uptime() / 3600).toFixed(1)),
				shell: process.env.SHELL ?? "unknown",
				term: process.env.TERM ?? "unknown",
			},
			error: null,
		};
	} catch (e) {
		return { data: null, error: `System info collection failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

export async function collectModelInfo(ctx: ExtensionContext): Promise<CollectorResult<ModelInfo>> {
	try {
		const model = ctx.model;
		if (!model) {
			return { data: null, error: "No model configured" };
		}
		const usage = ctx.getContextUsage();
		return {
			data: {
				modelId: model.id,
				modelName: model.name,
				provider: model.provider,
				baseUrl: model.baseUrl,
				reasoning: model.reasoning,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				contextUsagePercent: usage?.percent ?? null,
				contextTokens: usage?.tokens ?? null,
			},
			error: null,
		};
	} catch (e) {
		return { data: null, error: `Model info collection failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

export async function collectSessionInfo(ctx: ExtensionContext): Promise<CollectorResult<SessionInfo>> {
	try {
		const sm = ctx.sessionManager;
		return {
			data: {
				sessionId: sm.getSessionId(),
				sessionFile: sm.getSessionFile() ?? "(none)",
				cwd: sm.getCwd(),
				sessionName: sm.getSessionName(),
				entryCount: sm.getEntries().length,
				leafId: sm.getLeafId(),
			},
			error: null,
		};
	} catch (e) {
		return { data: null, error: `Session info collection failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

export async function collectConfigInfo(ctx: ExtensionContext): Promise<CollectorResult<ConfigInfo>> {
	try {
		const settings = ctx.getSettings();
		return {
			data: {
				defaultProvider: settings.defaultProvider,
				defaultModel: settings.defaultModel,
				thinkingLevel: settings.defaultThinkingLevel,
				theme: settings.theme,
				locale: settings.locale,
				transport: settings.transport,
				steeringMode: settings.steeringMode,
				extensionCount: settings.extensions?.length ?? 0,
				packageCount: settings.packages?.length ?? 0,
			},
			error: null,
		};
	} catch (e) {
		return { data: null, error: `Config info collection failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

export async function collectGitInfo(cwd: string): Promise<CollectorResult<GitInfo>> {
	try {
		const gitOpts = { cwd, timeout: GIT_TIMEOUT_MS };

		const [branchResult, logResult, statusResult, remoteResult] = await Promise.allSettled([
			execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], gitOpts),
			execFileAsync("git", ["log", "-1", "--oneline"], gitOpts),
			execFileAsync("git", ["status", "--short"], gitOpts),
			execFileAsync("git", ["remote", "get-url", "origin"], gitOpts),
		]);

		const branch = branchResult.status === "fulfilled" ? branchResult.value.stdout.trim() : "(unknown)";
		const lastCommit = logResult.status === "fulfilled" ? logResult.value.stdout.trim() : "(none)";
		const rawStatus = statusResult.status === "fulfilled" ? statusResult.value.stdout.trim() : "";
		const statusLines = rawStatus ? rawStatus.split("\n") : [];
		const statusSummary =
			statusLines.length > MAX_GIT_STATUS_LINES
				? `${statusLines.slice(0, MAX_GIT_STATUS_LINES).join("\n")}\n... (${statusLines.length - MAX_GIT_STATUS_LINES} more files)`
				: rawStatus || "(clean)";
		const remoteUrl = remoteResult.status === "fulfilled" ? remoteResult.value.stdout.trim() : "(no remote)";

		return {
			data: {
				isRepo: true,
				branch,
				lastCommit,
				statusSummary,
				remoteUrl: sanitizeRemoteUrl(remoteUrl),
			},
			error: null,
		};
	} catch {
		return { data: { isRepo: false, branch: "-", lastCommit: "-", statusSummary: "-", remoteUrl: "-" }, error: "Not a git repository or git not available" };
	}
}

export async function collectAgentState(ctx: ExtensionContext): Promise<CollectorResult<AgentState>> {
	try {
		return {
			data: {
				isIdle: ctx.isIdle(),
				hasPendingMessages: ctx.hasPendingMessages(),
				systemPromptLength: ctx.getSystemPrompt().length,
				soulEnabled: ctx.getSoulManager() !== undefined,
			},
			error: null,
		};
	} catch (e) {
		return { data: null, error: `Agent state collection failed: ${e instanceof Error ? e.message : String(e)}` };
	}
}

// ============================================================================
// Sanitization
// ============================================================================

const SENSITIVE_KEY_PATTERNS = /(?:api[_-]?key|token|secret|password|credential|auth)/i;

function sanitizeRemoteUrl(url: string): string {
	// Strip user:password@ from URLs
	return url.replace(/:\/\/[^@]+@/, "://***@");
}

export function sanitizeForLLM(data: DiagnosticData): DiagnosticData {
	const sanitize = (obj: unknown): unknown => {
		if (obj === null || obj === undefined) return obj;
		if (typeof obj === "string") return obj;
		if (Array.isArray(obj)) return obj.map(sanitize);
		if (typeof obj === "object") {
			const result: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
				if (SENSITIVE_KEY_PATTERNS.test(key) && typeof value === "string") {
					result[key] = "***REDACTED***";
				} else {
					result[key] = sanitize(value);
				}
			}
			return result;
		}
		return obj;
	};

	return {
		system: data.system.error ? data.system : { data: sanitize(data.system.data) as SystemInfo | null, error: null },
		model: data.model.error ? data.model : { data: sanitize(data.model.data) as ModelInfo | null, error: null },
		session: data.session.error ? data.session : { data: sanitize(data.session.data) as SessionInfo | null, error: null },
		config: data.config.error ? data.config : { data: sanitize(data.config.data) as ConfigInfo | null, error: null },
		git: data.git.error ? data.git : { data: sanitize(data.git.data) as GitInfo | null, error: null },
		agent: data.agent.error ? data.agent : { data: sanitize(data.agent.data) as AgentState | null, error: null },
	};
}

// ============================================================================
// Formatting
// ============================================================================

function formatAsTable(title: string, data: object): string {
	const lines: string[] = [`| ${title} | |`, "|---|---|"];
	for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
		const displayValue = value === undefined ? "(default)" : value === null ? "(null)" : String(value);
		lines.push(`| ${key} | ${displayValue} |`);
	}
	return lines.join("\n");
}

function formatError(category: string, error: string): string {
	return `> **${category}**: Collection failed: ${error}`;
}

export function formatDiagnosticData(data: DiagnosticData): string {
	const parts: string[] = [];

	if (data.system.data) {
		parts.push(formatAsTable("System", data.system.data));
	} else if (data.system.error) {
		parts.push(formatError("System", data.system.error));
	}

	if (data.model.data) {
		parts.push(formatAsTable("Model", data.model.data));
	} else if (data.model.error) {
		parts.push(formatError("Model", data.model.error));
	}

	if (data.session.data) {
		parts.push(formatAsTable("Session", data.session.data));
	} else if (data.session.error) {
		parts.push(formatError("Session", data.session.error));
	}

	if (data.config.data) {
		parts.push(formatAsTable("Config", data.config.data));
	} else if (data.config.error) {
		parts.push(formatError("Config", data.config.error));
	}

	if (data.git.data) {
		parts.push(formatAsTable("Git", data.git.data));
	} else if (data.git.error) {
		parts.push(formatError("Git", data.git.error));
	}

	if (data.agent.data) {
		parts.push(formatAsTable("Agent", data.agent.data));
	} else if (data.agent.error) {
		parts.push(formatError("Agent", data.agent.error));
	}

	return parts.join("\n\n");
}

// ============================================================================
// Preferences Info
// ============================================================================

export interface PreferencesInfo {
	locale: string;
	localeSource: "memory" | "settings" | "system";
	memoryDir: string;
	languagePreference: {
		found: boolean;
		name?: string;
		summary?: string;
	}[];
}

export async function collectPreferencesInfo(ctx: ExtensionContext): Promise<CollectorResult<PreferencesInfo>> {
	try {
		const os = await import("node:os");
		const fs = await import("node:fs");
		const path = await import("node:path");

		// Check memory directory for language preferences
		const memoryDir = process.env.NANOMEM_MEMORY_DIR || path.join(os.homedir(), ".nanopencil", "agent", "memory");
		let locale: string = "en";
		let localeSource: "memory" | "settings" | "system" = "system";
		const languagePreference: PreferencesInfo["languagePreference"] = [];

		// Try to read from preferences.json
		const prefsPath = path.join(memoryDir, "preferences.json");
		if (fs.existsSync(prefsPath)) {
			try {
				const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
				// Find language-related preferences
				const langPrefs = prefs.filter((p: Record<string, unknown>) => {
					const text = ((p.name as string) || "") + ((p.summary as string) || "") + ((p.detail as string) || "");
					return /中文|chinese|语言|locale|zh/i.test(text);
				});
				if (langPrefs.length > 0) {
					locale = "zh";
					localeSource = "memory";
					for (const p of langPrefs.slice(0, 3)) {
						languagePreference.push({
							found: true,
							name: p.name as string,
							summary: (p.summary as string || "").slice(0, 80),
						});
					}
				}
			} catch {
				// Ignore read errors
			}
		}

		// Check settings.json for locale
		const settingsPath = path.join(os.homedir(), ".nanopencil", "agent", "settings.json");
		if (localeSource === "system" && fs.existsSync(settingsPath)) {
			try {
				const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
				if (settings.locale) {
					locale = settings.locale;
					localeSource = "settings";
				}
			} catch {
				// Ignore read errors
			}
		}

		return {
			data: {
				locale,
				localeSource,
				memoryDir,
				languagePreference,
			},
			error: null,
		};
	} catch (error) {
		return {
			data: null,
			error: String(error),
		};
	}
}
