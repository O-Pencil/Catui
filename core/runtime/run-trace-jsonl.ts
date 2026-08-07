/**
 * [WHO]: JsonlRunTraceSink, readRunTraceJsonl, secure file permissions, and byte limits
 * [FROM]: Depends on Node filesystem APIs and the agent-core trace contract
 * [TO]: Exported through the public runtime subpath for host persistence
 * [HERE]: core/runtime/run-trace-jsonl.ts - secure host-owned trace storage
 */
import { chmod, open, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import {
	parseRunTraceEvent,
	validateRunTrace,
	type RunTraceEventV1,
	type RunTraceSink,
} from "@catui/agent-core";

export interface RunTraceJsonlLimits {
	maxFileBytes?: number;
	maxLineBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

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
