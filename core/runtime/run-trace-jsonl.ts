/**
 * [WHO]: JsonlRunTraceSink, persistWorkspaceRunTrace(), redactWorkspaceRunTraceEvent(), secure file permissions, byte limits, and retention
 * [FROM]: Depends on Node filesystem APIs, proper-lockfile, the agent-core trace contract, and the workspace write guard
 * [TO]: Exported through the public runtime subpath for host persistence
 * [HERE]: core/runtime/run-trace-jsonl.ts - secure host-owned and workspace-exported trace storage
 */
import { randomUUID } from "node:crypto";
import { chmod, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import lockfile from "proper-lockfile";
import {
	parseRunTraceEvent,
	validateRunTrace,
	type RunTraceEventV1,
	type RunTraceRedactor,
	type RunTraceSink,
} from "@catui/agent-core";
import { createWorkspaceWriteGuard } from "../tools/write-guard.js";

export interface RunTraceJsonlLimits {
	maxFileBytes?: number;
	maxLineBytes?: number;
}

export interface WorkspaceRunTraceResult {
	runId: string;
	runPath: string;
	latestPath: string;
}

export interface WorkspaceRunTraceOptions {
	maxRunFiles?: number;
}

const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_MAX_RUN_FILES = 100;
const REDACTED = "[REDACTED_SECRET]";
const traceDirectoryTails = new Map<string, Promise<void>>();
const SENSITIVE_KEYS = new Set([
	"apikey", "authorization", "clientsecret", "connectionstring", "cookie", "credential", "credentials",
	"databaseurl", "dsn", "password", "passwd", "privatekey", "refreshtoken", "secret", "setcookie", "token", "accesstoken",
]);
const SENSITIVE_KEY_SUFFIXES = [
	"accesskey", "apikey", "authorization", "clientsecret", "connectionstring", "cookie", "credential", "credentials",
	"databaseurl", "dsn", "idtoken", "password", "passwd", "privatekey", "refreshtoken", "secret", "sessiontoken", "token",
];

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEYS.has(key) || SENSITIVE_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

function redactSecretText(value: string): string {
	return value
		.replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/gi, REDACTED)
		.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED}`)
		.replace(/\b(Authorization\s*:\s*Basic)\s+[A-Za-z0-9+/=_-]+/gi, `$1 ${REDACTED}`)
		.replace(/\b((?:Set-)?Cookie\s*:)\s*[^"'\r\n&|]+/gi, `$1 ${REDACTED}`)
		.replace(/\b(?:[A-Za-z0-9_]*(?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credential|credentials|password|passwd|secret|token)|database[_-]?url|connection[_-]?string|dsn)\s*[:=]\s*(?:["'][^"'\n]+["']|[^\s,;]+)/gi, (match) => {
			const separator = match.includes(":") ? ":" : "=";
			return `${match.slice(0, match.indexOf(separator) + 1)}${REDACTED}`;
		})
		.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, `$1${REDACTED}:${REDACTED}@`)
		.replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, REDACTED);
}

function redactTraceValue(value: unknown, depth = 0): unknown {
	if (depth > 20) return "[REDACTED_DEPTH_LIMIT]";
	if (typeof value === "string") return redactSecretText(value);
	if (Array.isArray(value)) return value.map((item) => redactTraceValue(item, depth + 1));
	if (!value || typeof value !== "object") return value;
	const output: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const normalizedKey = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
		output[key] = isSensitiveKey(normalizedKey) ? REDACTED : redactTraceValue(child, depth + 1);
	}
	return output;
}

export const redactWorkspaceRunTraceEvent: RunTraceRedactor = (event) => {
	if (event.kind !== "tool.requested" || event.payload.input === undefined) return event;
	return {
		...event,
		payload: {
			...event.payload,
			input: redactTraceValue(event.payload.input),
		},
	};
};

function limits(options: RunTraceJsonlLimits): Required<RunTraceJsonlLimits> {
	const resolved = {
		maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
		maxLineBytes: options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
	};
	if (!Number.isInteger(resolved.maxFileBytes) || resolved.maxFileBytes < 1) throw new Error("Trace maxFileBytes must be a positive integer");
	if (!Number.isInteger(resolved.maxLineBytes) || resolved.maxLineBytes < 1) throw new Error("Trace maxLineBytes must be a positive integer");
	return resolved;
}

async function fileSize(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch (error: unknown) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0;
		throw error;
	}
}

export class JsonlRunTraceSink implements RunTraceSink {
	readonly #path: string;
	readonly #limits: Required<RunTraceJsonlLimits>;
	#tail: Promise<void> = Promise.resolve();

	constructor(path: string, options: RunTraceJsonlLimits = {}) {
		if (path.length === 0) throw new Error("Trace path must not be empty");
		this.#path = path;
		this.#limits = limits(options);
	}

	append(event: RunTraceEventV1): Promise<void> {
		const validated = parseRunTraceEvent(event);
		const line = `${JSON.stringify(validated)}\n`;
		const bytes = Buffer.byteLength(line);
		const operation = this.#tail.then(async () => {
			if (bytes > this.#limits.maxLineBytes) throw new Error(`Run trace line exceeds ${this.#limits.maxLineBytes} bytes`);
			const currentSize = await fileSize(this.#path);
			if (currentSize + bytes > this.#limits.maxFileBytes) throw new Error(`Run trace file exceeds ${this.#limits.maxFileBytes} bytes`);
			await mkdir(dirname(this.#path), { recursive: true });
			const handle = await open(this.#path, "a", 0o600);
			try {
				await handle.writeFile(line, "utf8");
			} finally {
				await handle.close();
			}
			await chmod(this.#path, 0o600);
		});
		this.#tail = operation.catch(() => undefined);
		return operation;
	}
}

export async function readRunTraceJsonl(
	path: string,
	options: RunTraceJsonlLimits = {},
): Promise<RunTraceEventV1[]> {
	const resolved = limits(options);
	const size = await fileSize(path);
	if (size > resolved.maxFileBytes) throw new Error(`Run trace file exceeds ${resolved.maxFileBytes} bytes`);
	const content = await readFile(path, "utf8");
	const rawLines = content.split("\n");
	if (rawLines.at(-1) === "") rawLines.pop();
	const events: unknown[] = [];
	for (let index = 0; index < rawLines.length; index += 1) {
		const line = rawLines[index];
		if (Buffer.byteLength(line) > resolved.maxLineBytes) throw new Error(`Run trace line ${index + 1} exceeds ${resolved.maxLineBytes} bytes`);
		if (line.trim().length === 0) throw new Error(`Run trace line ${index + 1} is empty`);
		try {
			events.push(JSON.parse(line) as unknown);
		} catch (error: unknown) {
			throw new Error(`Invalid JSON on run trace line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return validateRunTrace(events);
}

function safeTraceFileStem(runId: string): string {
	const safe = runId.replace(/[^A-Za-z0-9._-]/g, "_");
	return safe.length > 0 ? safe : `run-${randomUUID()}`;
}

async function writeAtomicOwnerOnly(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(tmpPath, content, { encoding: "utf8", mode: 0o600 });
	await chmod(tmpPath, 0o600);
	await rename(tmpPath, path);
	await chmod(path, 0o600);
}

async function serializeTraceDirectoryWrite<T>(traceDir: string, operation: () => Promise<T>): Promise<T> {
	const previous = traceDirectoryTails.get(traceDir) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.catch(() => undefined).then(() => current);
	traceDirectoryTails.set(traceDir, tail);
	await previous.catch(() => undefined);
	try {
		return await operation();
	} finally {
		release();
		if (traceDirectoryTails.get(traceDir) === tail) traceDirectoryTails.delete(traceDir);
	}
}

async function pruneWorkspaceRunTraces(traceDir: string, maxRunFiles: number): Promise<void> {
	if (!Number.isInteger(maxRunFiles) || maxRunFiles < 1) {
		throw new Error("Workspace trace maxRunFiles must be a positive integer");
	}
	const entries = await readdir(traceDir, { withFileTypes: true });
	const candidates = await Promise.all(entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl") && entry.name !== "latest.jsonl")
		.map(async (entry) => {
			const path = join(traceDir, entry.name);
			return { path, name: entry.name, modifiedAt: (await stat(path)).mtimeMs };
		}));
	if (candidates.length <= maxRunFiles) return;
	candidates.sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name));
	await Promise.all(candidates.slice(maxRunFiles).map((candidate) => unlink(candidate.path)));
}

export async function persistWorkspaceRunTrace(
	cwd: string,
	events: readonly unknown[],
	options: WorkspaceRunTraceOptions = {},
): Promise<WorkspaceRunTraceResult> {
	if (cwd.length === 0) throw new Error("Workspace trace cwd must not be empty");
	const validated = validateRunTrace(events);
	const redacted = await Promise.all(validated.map((event) => redactWorkspaceRunTraceEvent(event)));
	const runId = redacted[0].runId;
	const traceDir = join(cwd, ".catui", "traces");
	const runPath = join(traceDir, `${safeTraceFileStem(runId)}.jsonl`);
	const latestPath = join(traceDir, "latest.jsonl");
	const content = `${redacted.map((event) => JSON.stringify(event)).join("\n")}\n`;
	const guardWorkspaceWrite = createWorkspaceWriteGuard(cwd);
	return serializeTraceDirectoryWrite(traceDir, async () => {
		await guardWorkspaceWrite(traceDir);
		await mkdir(traceDir, { recursive: true });
		await guardWorkspaceWrite(traceDir);
		const lockPath = join(traceDir, ".persist.lock");
		await guardWorkspaceWrite(lockPath);
		const release = await lockfile.lock(traceDir, {
			lockfilePath: lockPath,
			realpath: true,
			stale: 30000,
			retries: { retries: 10, factor: 2, minTimeout: 10, maxTimeout: 1000, randomize: true },
		});
		try {
			await guardWorkspaceWrite(traceDir);
			await guardWorkspaceWrite(runPath);
			await guardWorkspaceWrite(latestPath);
			await writeAtomicOwnerOnly(runPath, content);
			await writeAtomicOwnerOnly(latestPath, content);
			await guardWorkspaceWrite(traceDir);
			await pruneWorkspaceRunTraces(traceDir, options.maxRunFiles ?? DEFAULT_MAX_RUN_FILES);
			return { runId, runPath, latestPath };
		} finally {
			await release();
		}
	});
}
